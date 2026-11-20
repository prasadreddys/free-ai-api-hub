import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    // In local dev, proxy API calls to a local wrangler dev server.
    proxy: {
      "/v1": "http://127.0.0.1:8787",
      "/api": "http://127.0.0.1:8787",
    },
  },
});
