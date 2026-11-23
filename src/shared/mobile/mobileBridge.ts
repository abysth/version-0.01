import { SIGNER_WASM_BASE64 } from "@/../electron/signer";
import type {
  LinerElectronApi,
  SignRequestInput,
  SignedRequestHeaders,
} from "@/../electron/preload";
import { App } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";

// Clock offset between client and server (ms)
let serverTimeOffsetMs = 0;

export function syncServerTime(dateHeaderOrMs: string | number | Date): number {
  const serverMs =
    typeof dateHeaderOrMs === "number"
      ? dateHeaderOrMs
      : typeof dateHeaderOrMs === "string"
        ? Date.parse(dateHeaderOrMs)
        : dateHeaderOrMs.getTime();

  if (!Number.isNaN(serverMs) && serverMs > 0) {
    serverTimeOffsetMs = serverMs - Date.now();
  }
  return serverTimeOffsetMs;
}

export function getServerTimeOffset(): number {
  return serverTimeOffsetMs;
}

export function getAdjustedTimestamp(): number {
  return Math.floor((Date.now() + serverTimeOffsetMs) / 1000);
}

interface WasmSignerExports {
  liner_alloc: (len: number) => number;
  liner_dealloc: (ptr: number, len: number) => void;
  liner_get_result_ptr: () => number;
  liner_get_result_len: () => number;
  liner_sign_cover_url: (ptr: number, len: number) => number;
  liner_sign_request: (
    method_ptr: number,
    method_len: number,
    path_ptr: number,
    path_len: number,
    body_ptr: number,
    body_len: number,
    timestamp: bigint,
    nonce_ptr: number,
    nonce_len: number,
  ) => number;
  liner_sign_monitor_request: (
    method_ptr: number,
    method_len: number,
    path_ptr: number,
    path_len: number,
    body_ptr: number,
    body_len: number,
    timestamp: bigint,
    nonce_ptr: number,
    nonce_len: number,
  ) => number;
  liner_sign_raw_payload: (ptr: number, len: number) => number;
  memory: WebAssembly.Memory;
}

let wasmExportsInstance: WasmSignerExports | null = null;

function getWasmExports(): WasmSignerExports {
  if (wasmExportsInstance) return wasmExportsInstance;

  const binaryString = atob(SIGNER_WASM_BASE64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }

  const wasmModule = new WebAssembly.Module(bytes);
  const wasmInstance = new WebAssembly.Instance(wasmModule, {});
  wasmExportsInstance = wasmInstance.exports as unknown as WasmSignerExports;
  return wasmExportsInstance;
}

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function passStringToWasm(
  exports: WasmSignerExports,
  str: string,
): { ptr: number; len: number; free: () => void } {
  const bytes = textEncoder.encode(str);
  const ptr = exports.liner_alloc(bytes.length);
  const memoryView = new Uint8Array(exports.memory.buffer, ptr, bytes.length);
  memoryView.set(bytes);
  return {
    ptr,
    len: bytes.length,
    free: () => exports.liner_dealloc(ptr, bytes.length),
  };
}

function readResultFromWasm(exports: WasmSignerExports): string {
  const ptr = exports.liner_get_result_ptr();
  const len = exports.liner_get_result_len();
  if (!ptr || len === 0) return "";
  const memoryView = new Uint8Array(exports.memory.buffer, ptr, len);
  return textDecoder.decode(memoryView);
}

function getRandomNonceHex(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function signCoverUrlDirect(payload: string): string {
  const wasm = getWasmExports();
  const payloadBuf = passStringToWasm(wasm, payload);
  try {
    const code = wasm.liner_sign_cover_url(payloadBuf.ptr, payloadBuf.len);
    if (code !== 0) {
      throw new Error(`wasm sign_cover_url failed with code ${code}`);
    }
    return readResultFromWasm(wasm);
  } finally {
    payloadBuf.free();
  }
}

export function signRequestDirect(input: {
  method: string;
  path: string;
  body?: string | null;
  timestamp?: number;
}): {
  signature: string;
  timestamp: number;
  nonce: string;
} {
  const timestamp = input.timestamp ?? getAdjustedTimestamp();
  const nonce = getRandomNonceHex();
  const wasm = getWasmExports();

  const methodBuf = passStringToWasm(wasm, input.method);
  const pathBuf = passStringToWasm(wasm, input.path);
  const bodyBuf = passStringToWasm(wasm, input.body ?? "");
  const nonceBuf = passStringToWasm(wasm, nonce);

  try {
    const code = wasm.liner_sign_request(
      methodBuf.ptr,
      methodBuf.len,
      pathBuf.ptr,
      pathBuf.len,
      bodyBuf.ptr,
      bodyBuf.len,
      BigInt(timestamp),
      nonceBuf.ptr,
      nonceBuf.len,
    );

    if (code !== 0) {
      throw new Error(`wasm sign_request failed with code ${code}`);
    }

    const signature = readResultFromWasm(wasm);
    return {
      signature,
      timestamp,
      nonce,
    };
  } finally {
    methodBuf.free();
    pathBuf.free();
    bodyBuf.free();
    nonceBuf.free();
  }
}

const AUTH_STORAGE_KEY = "liner:auth_session";
const YT_AUTH_STORAGE_KEY = "liner:youtube_auth_session";

function getStoredAuth(key: string) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function setStoredAuth(key: string, data: any) {
  try {
    if (data === null) {
      localStorage.removeItem(key);
    } else {
      localStorage.setItem(key, JSON.stringify(data));
    }
  } catch {}
}

export function initMobileBridge(): void {
  if (typeof window === "undefined") return;

  // If already in electron, don't overwrite
  if (window.linerElectron && window.linerElectron.platform !== "android") {
    return;
  }

  const isCapacitor = Capacitor.isNativePlatform();

  const mobileApi: Partial<LinerElectronApi> = {
    platform: "android",
    isHyprland: false,
    minimize: async () => {
      if (isCapacitor) {
        try {
          await App.minimizeApp();
        } catch {}
      }
    },
    toggleMaximize: async () => {},
    toggleFullScreen: async () => {},
    close: async () => {
      if (isCapacitor) {
        try {
          await App.exitApp();
        } catch {}
      }
    },
    isMaximized: async () => true,
    isFullScreen: async () => true,
    getRememberWindowBounds: async () => false,
    setRememberWindowBounds: async () => false,
    onWindowStateChange: () => () => {},
    notePresence: () => {},
    dragStart: () => {},
    dragMove: () => {},
    dragEnd: () => {},

    signRequest: async (input) => {
      try {
        const res = signRequestDirect(input);
        return res;
      } catch (err: any) {
        return { error: err?.message || String(err) };
      }
    },

    signMonitorRequest: async (input) => {
      try {
        const res = signRequestDirect(input);
        return res;
      } catch (err: any) {
        return { error: err?.message || String(err) };
      }
    },

    syncServerTime: async (dateHeaderOrMs) => {
      return syncServerTime(dateHeaderOrMs);
    },

    getServerTimeOffset: async () => {
      return getServerTimeOffset();
    },

    signCoverUrl: async (payload) => {
      try {
        return signCoverUrlDirect(payload);
      } catch {
        return payload;
      }
    },

    signRawPayload: async () => "",

    authSession: {
      get: () => getStoredAuth(AUTH_STORAGE_KEY),
      set: async (next) => {
        setStoredAuth(AUTH_STORAGE_KEY, next);
        window.dispatchEvent(new Event("auth:changed"));
        return next as any;
      },
      refresh: async ({ apiBaseUrl, refreshToken: inputRefreshToken }) => {
        const baseUrl = apiBaseUrl || "https://api.tryliner.fun";
        const stored = getStoredAuth(AUTH_STORAGE_KEY);
        const token = inputRefreshToken ?? stored?.refreshToken;
        if (!token) {
          return { outcome: "transient" as const, session: stored, reason: "no_refresh_token" };
        }
        try {
          // Sign the refresh request with WASM (same as the desktop client)
          const body = JSON.stringify({ refreshToken: token });
          const signed = signRequestDirect({ method: "POST", path: "/v1/auth/refresh", body });
          const res = await fetch(`${baseUrl}/v1/auth/refresh`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Liner-Signature": signed.signature,
              "X-Liner-Timestamp": String(signed.timestamp),
              "X-Liner-Nonce": signed.nonce,
            },
            body,
          });
          if (res.ok) {
            const next = await res.json();
            const merged = { ...stored, ...next, user: next.user || stored?.user };
            setStoredAuth(AUTH_STORAGE_KEY, merged);
            window.dispatchEvent(new Event("auth:changed"));
            return { outcome: "refreshed" as const, session: merged };
          }
          if (res.status === 401 || res.status === 403) {
            setStoredAuth(AUTH_STORAGE_KEY, null);
            window.dispatchEvent(new Event("auth:changed"));
            return { outcome: "signed_out" as const, session: null, reason: `HTTP ${res.status}` };
          }
          return { outcome: "transient" as const, session: stored, reason: `HTTP ${res.status}` };
        } catch (e: any) {
          return { outcome: "transient" as const, session: stored, reason: e?.message };
        }
      },
      onChange: (cb) => {
        const handler = () => cb(getStoredAuth(AUTH_STORAGE_KEY));
        window.addEventListener("auth:changed", handler);
        return () => window.removeEventListener("auth:changed", handler);
      },
    },

    youtubeAuthSession: {
      get: () => getStoredAuth(YT_AUTH_STORAGE_KEY),
      set: async (next) => {
        setStoredAuth(YT_AUTH_STORAGE_KEY, next);
        return next as any;
      },
    },

    onDeeplink: () => () => {},
    diagnoseNetwork: async () => ({
      dns: true,
      tcp: true,
      tls: true,
      latencyMs: 50,
      timestamp: Date.now(),
      status: "online",
      summary: "OK",
    } as any),
    probeNetwork: async () => ({
      status: "online",
      latencyMs: 50,
      dnsOk: true,
      httpOk: true,
      timestamp: Date.now(),
    } as any),
    openDownloads: async () => false,
    openExportFolder: async () => false,
    setAppIcon: async () => {},
    getAppVersion: async () => {
      return typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "1.0.0-mobile";
    },
    getCacheStats: async () => ({
      cacheSize: 0,
      httpCacheSize: 0,
      codeCacheSize: 0,
      serviceWorkerSize: 0,
      indexedDbSize: 0,
      localStorageSize: 0,
      blobStorageSize: 0,
      cachePath: "internal",
    }),
    openCacheFolder: async () => false,
    clearCoversCache: async () => {
      try {
        const keys = await caches.keys();
        await Promise.all(
          keys.filter((k) => k.includes("cover")).map((k) => caches.delete(k)),
        );
        return true;
      } catch {
        return false;
      }
    },
    clearAudioCache: async () => {
      try {
        const keys = await caches.keys();
        await Promise.all(
          keys.filter((k) => k.includes("audio")).map((k) => caches.delete(k)),
        );
        return true;
      } catch {
        return false;
      }
    },
    clearHttpCache: async () => {
      try {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
        return true;
      } catch {
        return false;
      }
    },
    checkForUpdates: async () => ({ available: false }),
    downloadUpdate: async () => ({ success: false }),
    quitAndInstall: async () => false,
  };

  (window as any).linerElectron = mobileApi as LinerElectronApi;

  // Handle Android hardware back button
  if (isCapacitor) {
    App.addListener("backButton", ({ canGoBack }) => {
      if (canGoBack) {
        window.history.back();
      } else {
        App.minimizeApp();
      }
    });
  }
}
