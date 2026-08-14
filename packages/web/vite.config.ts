import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    // ⚠ SELF-DESTROYING on purpose — this is a MARKETING/LEGAL site, not an app.
    //
    // The previous config precached `**/*.{js,css,html,…}` with a Workbox
    // service worker (registerType: "autoUpdate"). Nothing in the site consumes
    // the PWA (no offline UX, no install-prompt handling — the "Offline-first"
    // copy is about the MOBILE app), so the SW added no value and one serious
    // bug: it answers navigations cache-first, BEFORE the network, so a new
    // deploy showed only stale content until a hard refresh — and it silently
    // defeated the CloudFront edge invalidation in infra/web.ts (the SW never
    // asks the CDN). Freshness matters here: stale pricing, App Store links, or
    // the cookie-consent banner is a launch + compliance risk.
    //
    // `selfDestroying: true` ships a SW that unregisters itself and clears the
    // old precache. Returning visitors' existing SW picks this up on their next
    // navigation (the SW script bypasses the HTTP cache), self-destructs, and
    // reloads to live content; new visitors register a SW that immediately
    // unregisters — i.e. effectively no SW. After this has been live long
    // enough for the fleet to clean up, delete vite-plugin-pwa entirely
    // (tracked as a follow-up). Do NOT reintroduce a precaching SW here.
    // `manifest: false` is REQUIRED: without it the plugin generates and injects
    // its own /manifest.webmanifest (name "@persistence/web", wrong theme) as a
    // SECOND <link rel="manifest">, overriding the hand-authored /site.webmanifest.
    VitePWA({ selfDestroying: true, manifest: false }),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    chunkSizeWarningLimit: 800,
  },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./src/test-setup.ts"],
    coverage: {
      provider: "v8",
      // Target 90% - increase as tests are added. Set to 0 for template to pass CI.
      thresholds: {
        lines: 0,
        functions: 0,
        branches: 0,
        statements: 0,
      },
      exclude: [
        "node_modules",
        "**/*.test.{ts,tsx}",
        "**/*.config.{ts,js}",
        "**/components/ui/**",
      ],
    },
  },
});
