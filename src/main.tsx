import React from "react";
import ReactDOM from "react-dom/client";
import { initGlobalErrorHandlers } from "@/shared/utils/globalErrorHandlers";
import { hydrateScreenCache } from "@/shared/cache/screenCache";
import { applyStoredTheme } from "@/shared/utils/storedTheme";

// On mobile/Capacitor (import.meta.env.VITE_MOBILE is injected by vite.mobile.config.ts)
// or when running in a plain browser (no window.linerElectron), install the mobile bridge
// SYNCHRONOUSLY before React mounts to avoid the EnvironmentWarning race condition.
import { initMobileBridge as _initMobileBridge } from "@/shared/mobile/mobileBridge";
if (import.meta.env.VITE_MOBILE === "true" || !("linerElectron" in window)) {
  _initMobileBridge();
}

initGlobalErrorHandlers();

const isOverlay = window.location.hash.startsWith("#/overlay");

if (!isOverlay) applyStoredTheme();

async function loadRoot(): Promise<React.ReactElement> {
  if (isOverlay) {
    const { default: OverlayApp } = await import("./app/OverlayApp");
    return <OverlayApp />;
  }
  const [
    { initMainWindowServices },
    { default: App },
    { default: RootErrorBoundary },
  ] = await Promise.all([
    import("./app/mainWindowServices"),
    import("./app/App"),
    import("@/shared/ui/RootErrorBoundary"),
    hydrateScreenCache(),
  ]);
  initMainWindowServices();
  return (
    <RootErrorBoundary>
      <App />
    </RootErrorBoundary>
  );
}

const rootElement = document.getElementById("root");

if (rootElement) {
  void loadRoot().then((root) => {
    ReactDOM.createRoot(rootElement).render(
      <React.StrictMode>{root}</React.StrictMode>,
    );
  });
}
