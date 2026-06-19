import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: {
    port: 5173,
    host: true,
    proxy: {
      // forward broker calls to the local Capital.com proxy (avoids CORS)
      "/api/capital": {
        target: "http://localhost:8787",
        changeOrigin: true,
      },
    },
  },
});
