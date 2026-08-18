# Agent brief — `GET /g/:slug` device-aware redirect

Repo: `persistence-backend-sst`. Written 17 Aug 2026, after campaign attribution was wired
to the landing routes (see `packages/web/src/marketing/campaign.ts`).

**Task:** make `https://persistence.evans-software-solutions.com/g/<slug>` send an iPhone
straight to the App Store with correct attribution, and everyone else to the campaign
landing page.

---

## ⛔ Read this before designing anything

**There is no server.** `packages/web` is deployed as `sst.aws.StaticSite` (`infra/web.ts`)
— S3 behind CloudFront. There is no Express/Elysia/Lambda handler serving the marketing
domain, so `GET /g/:slug` cannot be "a route". It has to run at the CDN edge.

**There is no CloudFront Function in this repo yet.** `grep -rn "cloudfront.Function" infra/`
returns nothing. You are adding the first one.

**`infra/` has no typecheck and no tests.** Stated explicitly in `infra/monitoring.ts` and
`infra/web-edge.ts`. A shape mistake surfaces as a _deploy failure_, not a red check. This
drives the testing strategy below — push every decision into a pure, unit-tested module and
keep the infra glue as thin as you can make it.

---

## Required behaviour

| Viewer                                      | Destination                                                                      |
| ------------------------------------------- | -------------------------------------------------------------------------------- |
| iPhone / iPad / iPod                        | `https://apps.apple.com/app/apple-store/id6755091280?pt=128225445&ct=<ct>&mt=8`  |
| Android                                     | **the landing page** — `https://persistence.evans-software-solutions.com/<slug>` |
| Everything else (desktop, bots, unknown UA) | the landing page, same as Android                                                |
| Unknown / unrecognised slug                 | the landing page at `/` — **never a 404**                                        |

### Two of those rows are the ones that bite

**Android must NOT go to Google Play.** Play is still in review — `playStore.available` is
`false` and `playStore.url` is `null` in `packages/web/src/marketing/config.ts`. A redirect to
a Play URL today is a dead link on a printed leaflet. Gate the Android branch on
`playStore.available` so it lights up automatically when Android ships, and send Android to
the landing page until then. Do not hardcode a Play URL "ready for later".

**Fall back to the landing page, not the bare homepage.** `/<slug>` is now a real campaign
route that decorates every store CTA with `ct`/`pt`/`mt` _and_ fires the Meta pixel. `/` does
neither. Redirecting a non-iOS scan to `/` would silently drop attribution for every Android
and desktop scan.

---

## Design

### A dedicated ordered cache behaviour for `/g/*`

**A CloudFront behaviour can have at most one viewer-request function association.** SST's
`StaticSite` already attaches its own CloudFront Function to the default behaviour for SPA
URL rewriting — that is exactly what the warning in `infra/web.ts` about not replacing
`defaultCacheBehavior` with a partial object is protecting. Do not try to merge your logic
into SST's function.

Add an **ordered cache behaviour** with path pattern `/g/*`, pointed at the same S3 origin as
the default behaviour, carrying your own viewer-request function. Extend the existing
`transform.cdn` callback in `infra/web.ts` (keep the callback form — same shallow-merge reason
already documented there).

The function always returns a response, so the origin is never reached; it still has to be a
valid origin because a behaviour requires one. **Handle every path under the pattern**,
including `/g` and `/g/` with no slug — if the function falls through, S3 answers with a 404
and the printed QR is dead.

### Response shape

Return `statusCode: 302`, `statusDescription: "Found"`, a `location` header, and
`cache-control: no-store`. The response varies by User-Agent, so it must not be cached
anywhere — CloudFront does not cache viewer-request-generated responses, but browsers and
corporate proxies will happily cache a 302 without this.

### Device detection: parse `user-agent` yourself

The `CloudFront-Is-Mobile-Viewer` / `CloudFront-Is-Android-Viewer` headers are **not available
in a viewer-request function** — CloudFront adds them later, on the origin request, and only
when the origin request policy asks for them. Read `request.headers['user-agent'].value` and
match on it. Header names are lowercased in the function event.

Treat iPhone, iPad and iPod as iOS. Treat macOS as desktop — Apple Silicon Macs can run iOS
apps, but a Mac visitor is far better served by the landing page.

### One source of truth for campaign tokens

The `ct` a QR scan produces **must** equal the `ct` the web CTA produces for the same slug, or
App Analytics splits one campaign across two tokens. `CAMPAIGNS` and `APPLE_PROVIDER_TOKEN` in
`packages/web/src/marketing/config.ts` are the source of truth. `infra/` already imports from
`packages/` (`infra/web-edge.ts` imports from `../packages/api-utils/src/domains`), so this is
precedented.

CloudFront Functions run a restricted JS runtime (`cloudfront-js-2.0`): no ES modules, no
`require`, no network, 10 KB max source, ~1 ms CPU. So you cannot import at runtime — generate
the function source at synth time, serialising the campaign table into the body as a literal.
Do not retype the slugs by hand in the function.

### Rejected alternatives — don't rediscover these

- **Lambda@Edge** — works, but must live in `us-east-1`, costs per-invocation, and adds cold
  starts to a QR scan on conference wifi. CloudFront Functions are sub-millisecond and free at
  this volume.
- **S3 website routing rules** — cannot branch on User-Agent at all.
- **A client-side React route** (`/qr/:slug` style) — this is the thing the print brief
  explicitly rules out: a scanner on bad wifi downloads the whole JS bundle and waits for
  hydration before anything happens.

---

## Testing

`infra/` has no test harness, so structure the work so the logic is testable outside it:

1. Put the pure decision in a plain module — something like
   `packages/web/src/marketing/edgeRedirect.ts` exporting
   `resolveRedirect(pathname, userAgent) → { status, location }`. This sits under `packages/web`,
   which **does** have vitest.
2. Unit-test that function directly: real iPhone / iPad / Android / Chrome-desktop /
   Googlebot / empty / malformed UA strings; every slug in `CAMPAIGNS`; an unknown slug;
   `/g` and `/g/` with no slug. Assert the iOS URL parses to `ct=<slug>`, `pt=128225445`,
   `mt=8`.
3. Add a guard test that Android does not resolve to a Play URL while
   `playStore.available === false`, and that it _does_ once flipped.
4. Have the infra glue generate the function source from that same module.

Note the lesson from the bug this follows: `appStoreUrl()` had 11 green tests while production
served four undecorated links, because nothing tested that anything _called_ it. Test the
resolved output, not just the helper.

### Before it can carry a printed QR

- Deploy to **staging** first (`staging.persistence.evans-software-solutions.com`).
- Scan the real QR with a **real iPhone** and a **real Android handset** — not a simulator,
  not curl. `curl -A "<iphone UA>" -I` is a useful smoke test but is not the acceptance test.
- Confirm the 302 `location` in the response headers, and that the App Store app opens on the
  Persistence listing rather than a web page.
- Only then production, and only then hand out leaflets.

---

## Acceptance criteria

- [ ] `/g/flyer` on staging 302s an iPhone to the App Store URL with `pt=128225445&ct=flyer&mt=8`
- [ ] `/g/flyer` 302s Android and desktop to `/flyer`
- [ ] `/g/<unknown>` 302s to `/` — never 404, never a blank page
- [ ] `/g` and `/g/` are handled
- [ ] Android reaches no Play URL while `playStore.available` is `false`
- [ ] `ct` values are read from `CAMPAIGNS`, not retyped
- [ ] Existing routes are untouched: `/`, `/pricing`, `/privacy`, `/terms`, `/uon`, `/flyer`,
      `/social`, `/tt`, `/ig`, `/li`, `/qr/:slug` all behave exactly as before
- [ ] `bun run test:unit` green in `packages/web`
- [ ] Verified on a real iPhone against staging

## Do not change

- `APPLE_PROVIDER_TOKEN` (`128225445`), the App Store URL, or `mt=8` — all verified against
  App Store Connect, and a previous error here nearly reached 5,000 leaflets.
- The App Store URL must stay storefront-agnostic — no `/gb/`. There is a shipped-config test
  guarding this.
- `securityHeaders` / the CSP in `infra/web.ts`, beyond attaching the existing response-headers
  policy to the new behaviour if appropriate.
- The `invalidation: { paths: "all", wait: true }` block, and do not reintroduce a precaching
  service worker.
- `infra/web-edge.ts` — that is the WAF-fronted POST edge for `/leads` + `/store-click`, a
  different distribution serving a different purpose. Not related to this work.

## Out of scope

- Anything in the mobile app
- Placing the print order, or editing artwork
- Google Play launch work
