import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import pkg from "./package.json" with { type: "json" };
import { contentSecurityPolicyPlugin } from "./vite.csp.ts";

/**
 * vite.mobile.config.ts – used by the `build:mobile` script.
 *
 * Key differences from the desktop (Electron) build:
 *   - NO vite-plugin-electron – we ship a plain web bundle.
 *   - Outputs to `dist/` just like the normal web build so `cap sync` picks it up.
 *   - Injects VITE_MOBILE=true so the app can call initMobileBridge() at startup.
 */
export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    // Tells the app it is running inside Capacitor / native Android
    "import.meta.env.VITE_MOBILE": JSON.stringify("true"),
  },
  plugins: [react(), tailwindcss(), contentSecurityPolicyPlugin()],
  clearScreen: false,
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
      // Redirect Electron-only preload type import to a stub so the renderer
      // builds cleanly (the actual types are still used at runtime from the
      // mobileBridge shim installed on window.linerElectron).
      "../electron/preload": path.resolve(
        import.meta.dirname,
        "./src/shared/mobile/electronPreloadStub.ts",
      ),
      "next/navigation": path.resolve(
        import.meta.dirname,
        "./src/lib/navigation.tsx",
      ),
      "next/link": path.resolve(
        import.meta.dirname,
        "./src/lib/navigation.tsx",
      ),
      "next/image": path.resolve(
        import.meta.dirname,
        "./src/components/ui/AppImage.tsx",
      ),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    chunkSizeWarningLimit: 2048,
    // Target modern Android WebView (Chromium 110+)
    target: ["chrome110", "safari16"],
    rollupOptions: {
      // Exclude Electron-only packages from the mobile bundle
      external: (id) => {
        const electronOnlyPackages = [
          "electron",
          "node:crypto",
          "node:path",
          "node:fs",
          "node:os",
          "node:events",
          "node:buffer",
          "node:stream",
          "node:util",
          "node:net",
          "node:http",
          "node:https",
          "node:child_process",
        ];
        return electronOnlyPackages.some(
          (pkg) => id === pkg || id.startsWith(pkg + "/"),
        );
      },
    },
  },
});
