/// <reference types="vite/client" />

// Not part of the SST-generated `sst-env.d.ts` (build-time-only, no infra
// binding): Meta Pixel id + Cloudflare Turnstile site key for spec-30 WS3.
// Both are optional — unset in any stage means the corresponding feature
// (pixel / Turnstile widget) no-ops cleanly.
//
// `VITE_MARKETING_EDGE_URL` (spec-30 R3.3) is the WAF-fronted CloudFront origin
// the anonymous /leads + /store-click POSTs are routed through. Optional: empty
// on dev stages, where the marketing calls fall back to VITE_CORE_API_URL.
// `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` (FOUNDING-OFFER): the public
// Supabase project URL + anon key, used ONLY by the internal /admin sign-in
// (magic link via GoTrue REST). Unset → /admin/login shows "not configured".
interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
  readonly VITE_META_PIXEL_ID?: string;
  readonly VITE_TURNSTILE_SITE_KEY?: string;
  readonly VITE_MARKETING_EDGE_URL?: string;
}
