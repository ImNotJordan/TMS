import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import { VitePWA } from "vite-plugin-pwa";
import path from "node:path";

// Standalone Vite SPA (no TanStack Start/SSR) so it can deploy as a static
// build to its own AWS Amplify app, independent of the dispatcher console.
export default defineConfig({
  plugins: [
    tanstackRouter({ target: "react", autoCodeSplitting: true }),
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["logo.png", "ai.png", "pwa-180.png", "pwa-192.png", "pwa-512.png"],
      manifest: {
        id: "/",
        name: "Titan Freight Driver",
        short_name: "Titan Driver",
        description:
          "Accept loads, update status, share location, upload documents, and talk to dispatch.",
        theme_color: "#0B1220",
        background_color: "#0B1220",
        display: "standalone",
        display_override: ["standalone", "browser"],
        orientation: "portrait-primary",
        scope: "/",
        start_url: "/",
        lang: "en",
        categories: ["business", "productivity", "navigation"],
        icons: [
          {
            src: "/pwa-192.png",
            sizes: "192x192",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "/pwa-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "/pwa-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        navigateFallback: "/index.html",
        globPatterns: ["**/*.{js,css,html,ico,png,svg,woff2}"],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: "CacheFirst",
            options: {
              cacheName: "google-fonts-stylesheets",
              expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 },
            },
          },
          {
            urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
            handler: "CacheFirst",
            options: {
              cacheName: "google-fonts-webfonts",
              expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 365 },
            },
          },
        ],
      },
      devOptions: {
        enabled: true,
        type: "module",
      },
    }),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@titan/aws-client": path.resolve(__dirname, "../../packages/aws-client/src"),
    },
  },
  // Share Cognito / Dynamo table env from the monorepo root `.env`.
  envDir: path.resolve(__dirname, "../.."),
  server: {
    port: 5174,
    /**
     * This app has no server of its own — it is a static SPA. The `/api/*`
     * routes it calls live on the dispatcher console's Worker, so in dev they
     * are proxied there.
     *
     * In production the two deploy to different origins, and the portal reaches
     * the API through `VITE_API_BASE_URL` instead. See `src/lib/api-base.ts`.
     */
    proxy: {
      "/api": {
        target: process.env.VITE_DEV_API_ORIGIN || "http://localhost:8080",
        changeOrigin: true,
      },
    },
  },
});
