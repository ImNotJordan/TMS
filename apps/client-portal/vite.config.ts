import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import path from "node:path";

// Standalone Vite SPA. Deploys independently of the operations console;
// in dev, `/api` is proxied to the console Worker.
export default defineConfig({
  plugins: [tanstackRouter({ target: "react", autoCodeSplitting: true }), react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@titan/aws-client": path.resolve(__dirname, "../../packages/aws-client/src"),
    },
  },
  envDir: path.resolve(__dirname, "../.."),
  server: {
    port: 5175,
    proxy: {
      "/api": {
        target: process.env.VITE_DEV_API_ORIGIN || "http://localhost:8080",
        changeOrigin: true,
      },
    },
  },
});
