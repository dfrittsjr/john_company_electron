import { defineConfig } from "astro/config";
import react from "@astrojs/react";

// Old Macs may be stuck on Safari 14 or Firefox 115 ESR, so keep the shipped
// JavaScript and CSS at syntax those browsers understand.
const legacyBrowserTargets = ["chrome87", "edge88", "firefox78", "safari14"];

export default defineConfig({
  output: "static",
  integrations: [react()],
  server: {
    host: "127.0.0.1",
    port: 4321,
  },
  vite: {
    build: {
      target: legacyBrowserTargets,
      cssTarget: legacyBrowserTargets,
    },
  },
});
