import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@": path.resolve(path.dirname(fileURLToPath(import.meta.url)), "./src") } },
  server: {
    host: "127.0.0.1", port: 5173, strictPort: true,
    allowedHosts: ["localhost", "127.0.0.1"],
    proxy: {
      "/api": { target: process.env.VITE_API_TARGET || "http://127.0.0.1:8787", changeOrigin: false },
      "/ready.json": { target: process.env.VITE_API_TARGET || "http://127.0.0.1:8787", changeOrigin: false }
    },
    watch: { ignored: ["**/release/**", "**/dist/**", "**/data/**", "**/output/**", "**/.runtime/**", "**/knowledge-sources/**", "**/models/**"] }
  }
});