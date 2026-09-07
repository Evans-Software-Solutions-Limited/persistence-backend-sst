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
// `VITE_STORE_OFFER_IOS_URL` / `VITE_STORE_OFFER_ANDROID_URL`
// (MARKETING-PLANS): the App Store / Play offer-code redemption URLs for the
// founders' rate. Public values — they are what an ad links to. Unset in a
// stage means no offer CTA renders there, which is the correct state until a
// code has been redeemed end to end and confirmed server-side.
interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
  readonly VITE_META_PIXEL_ID?: string;
  readonly VITE_TURNSTILE_SITE_KEY?: string;
  readonly VITE_MARKETING_EDGE_URL?: string;
  readonly VITE_STORE_OFFER_IOS_URL?: string;
  readonly VITE_STORE_OFFER_ANDROID_URL?: string;
}
