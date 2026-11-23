import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.hkamori.liner",
  appName: "Liner",
  webDir: "dist",
  server: {
    androidScheme: "https",
  },
  android: {
    // Allow media/audio playback in background
    backgroundColor: "#000000",
  },
  plugins: {
    StatusBar: {
      style: "Dark",
      backgroundColor: "#000000",
      overlaysWebView: true,
    },
  },
};

export default config;

