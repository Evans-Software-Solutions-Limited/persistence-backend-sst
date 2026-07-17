# BRIEF-4 — Persistence marketing website (static pages)

_Lane 1. Independent — start any time. Goal: ship the public landing site + the App-Store-required Support URL, with **no waitlist/discount**. Build into the existing `packages/web`._

## Current state (verified 2026-07-17)

- `packages/web` is the deployed **public site** (Vite + React 19 + TS + Tailwind v4 + shadcn/ui + react-router v7), wired in `infra/web.ts` to `persistence.evans-software-solutions.com` (prod) / `staging.persistence…` (staging). **This is the URL App Store Connect uses for `/privacy` + `/terms`.**
- Routes today (`src/App.tsx`): `/`, `/login`, `/privacy`, `/terms`.
  - `/privacy` (`src/pages/Privacy.tsx`) and `/terms` (`src/pages/Terms.tsx`) are **real, complete, un-gated** — reuse as-is.
  - `/` (`src/pages/Home.tsx`) is a **placeholder** (`ComponentExample`) — this is what you replace.
  - `/login` is a template stub — out of scope (leave or hide).
- `index.html` is still template-branded (`<title>web</title>`) — fix.

## Scope (build)

1. **Landing `/`** per **`specs/milestones/PERSISTENCE-WEB-DESIGN-BRIEF.md`** Part 1 (hero → three pillars Train/Fuel/Progress → coach-mode section → App Store badge + feature list → footer). Copy is in that brief; pricing/feature copy in **`marketing/WEBSITE_PRICING_SPEC.md`**.
2. **Support page** — new `/support` route (App Store _requires_ a Support URL; none exists today). Minimal: contact email + a short FAQ/links. Alternatively point the App Store Support URL at a `/` contact section — **decide (see below)**.
3. `index.html` title/description/OG + favicon → Persistence branding.

## Hard exclusions (Brad, 2026-07-17)

- **NO** waitlist form, "Join waitlist" / "founding access" CTA, founding/early-bird discount banner, or discounted pricing anywhere on the site. (The founding-trainer motion stays a GTM outreach play — see `marketing/LAUNCH_PLAYBOOK.md` §4 — it must not surface on the website.) The design brief itself contains no waitlist section; just don't add one. Discount integration is a later decision Brad wants to review.

## Decisions needed before/at build

- **Support URL:** dedicated `/support` page (recommended) vs `mailto`/`/`-anchor.
- **Palette:** design brief specifies indigo `#6366f1` on `#0d0f16`; current `packages/web` token is orange `#ef5e41`. Pick one and make tokens consistent.
- **Contact email:** live legal pages use `admin@evans-software-solutions.com`; brief says `hello@…`. Pick one across site + App Store metadata.
- **`/pricing` route:** the brief assigns none (pricing is not a page); copy exists if wanted. Default: no dedicated pricing page for launch.

## Notes

- The older brief says to create a _new_ `packages/persistence-web` package — **stale**; build into `packages/web` (domain + legal pages already live there).
- Static SPA, no auth on marketing pages. Keep `/privacy` + `/terms` paths stable (App Store points at them).

## Gates

`bun run typecheck` · `lint` · `prettier:check` · `build`. Verify locally via the preview/dev server; screenshot the landing (light + dark) before done. Inspector-Brad on the diff before PR.
