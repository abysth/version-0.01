/**
 * electronPreloadStub.ts
 *
 * Zero-implementation stub used only during the mobile/Capacitor Vite build.
 * The real preload.ts (electron/preload.ts) requires the "electron" package
 * and node: builtins which are not available inside the Android WebView.
 *
 * The window.linerElectron API is provided at runtime by mobileBridge.ts
 * instead of by the Electron context-bridge.
 */

// Re-export only the types that the renderer uses so TypeScript stays happy.
export type {
  LinerElectronApi,
  DiscordStatus,
  DeeplinkTarget,
  ElectronCacheStats,
  UpdateInfo,
  UpdateDownloadProgress,
  WindowState,
} from "../../electron/preload";
