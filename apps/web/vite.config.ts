import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  define: {
    "import.meta.env.VITE_PUBLIC_DEMO": JSON.stringify(
      mode === "public-demo" ? "true" : "false",
    ),
  },
  server: {
    proxy: {
      "/api": "http://127.0.0.1:8000",
      "/health": "http://127.0.0.1:8000",
    },
  },
  build: {
    outDir: mode === "public-demo" ? "dist-demo" : "dist",
    sourcemap: false,
    chunkSizeWarningLimit: 650,
  },
}));
