import { describe, it, expect, beforeEach } from "vitest";
import {
  initMobileBridge,
  signCoverUrlDirect,
  signRequestDirect,
  syncServerTime,
  getServerTimeOffset,
} from "./mobileBridge";

describe("Mobile Bridge & Signer", () => {
  beforeEach(() => {
    delete (window as any).linerElectron;
  });

  it("initializes window.linerElectron on mobile/browser", () => {
    initMobileBridge();
    expect(window.linerElectron).toBeDefined();
    expect(window.linerElectron?.platform).toBe("android");
  });

  it("computes identical HMAC cover signature in WebAssembly", () => {
    const sig1 = signCoverUrlDirect("test-payload");
    expect(sig1).toBe("9LSBe7mxc1bBjekVK62_YFbxUAxOvphtfgZZK1Wp_FY");

    const payload2 =
      "eyJ1IjoiaHR0cHM6Ly9saDMuZ29vZ2xldXNlcmNvbnRlbnQuY29tL2FiYyIsInMiOjUxMn0";
    const sig2 = signCoverUrlDirect(payload2);
    expect(sig2).toBe("36qoWwMzCP9TrkhwvUpv5qoid77_hPbeno1y58nn_7E");
  });

  it("signs API request through window.linerElectron.signRequest", async () => {
    initMobileBridge();
    const res = await window.linerElectron!.signRequest({
      method: "GET",
      path: "/v1/search?query=test",
    });

    expect(res.signature).toBeDefined();
    expect(res.signature!.length).toBeGreaterThan(0);
    expect(res.timestamp).toBeGreaterThan(0);
    expect(res.nonce).toMatch(/^[0-9a-f]{16}$/);
  });

  it("handles server time synchronization", async () => {
    initMobileBridge();
    const future = Date.now() + 60000;
    const offset = await window.linerElectron!.syncServerTime(future);
    expect(offset).toBeGreaterThanOrEqual(59000);
    expect(await window.linerElectron!.getServerTimeOffset()).toBe(offset);
  });
});
