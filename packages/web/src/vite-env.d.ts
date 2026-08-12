/// <reference types="vite/client" />

// Not part of the SST-generated `sst-env.d.ts` (build-time-only, no infra
// binding): Meta Pixel id + Cloudflare Turnstile site key for spec-30 WS3.
// Both are optional — unset in any stage means the corresponding feature
// (pixel / Turnstile widget) no-ops cleanly.
interface ImportMetaEnv {
  readonly VITE_META_PIXEL_ID?: string;
  readonly VITE_TURNSTILE_SITE_KEY?: string;
}
