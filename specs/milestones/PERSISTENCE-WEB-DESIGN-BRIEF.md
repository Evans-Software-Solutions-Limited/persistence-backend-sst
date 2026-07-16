# Persistence Web Presence — Design & Build Brief

**Deliverable:** A new standalone static site at `persistence.evans-software-solutions.com` that serves as (a) the App Store-required privacy/terms URL, and (b) the first public promotional presence for the Persistence app. Alongside this, a design modernisation pass on the main ESS site at `evans-software-solutions.com`.

**Why now:** Apple requires a public `https://` privacy policy URL in App Store Connect metadata before the app can be submitted. This site provides that URL and doubles as launch marketing.

**Decisions locked:**

- Subdomain: `persistence.evans-software-solutions.com` (no new domain to buy)
- Stack: standalone Vite + React static site, deployed via SST StaticSite resource pointing at the subdomain (matches your existing toolchain)
- Dark theme matching the app — not the ESS light-section style
- Privacy/terms pages live here (not in `packages/web`)

---

## Part 1 — Persistence Landing Site (new, `persistence.evans-software-solutions.com`)

### Purpose and pages

Three pages total:

| Route      | Purpose                                               |
| ---------- | ----------------------------------------------------- |
| `/`        | App landing page — the promotional face of the app    |
| `/privacy` | Privacy policy — this URL goes into App Store Connect |
| `/terms`   | Terms of service                                      |

### Visual brand direction

The app runs a premium dark UI — midnight backgrounds, indigo/purple primary accent, clean sans-serif type. The landing site should match that energy: something that looks like the app's own marketing rather than a consultancy page.

**Palette:**

- Background: `#0d0f16` (matches app bg)
- Surface: `#131620`
- Border: `#242840`
- Primary accent: `#6366f1` (indigo)
- Accent glow: `rgba(99,102,241,0.15)`
- Text: `#e4e8f5`
- Muted: `#636a8a`
- Done/success: `#22c55e`

**Typography:** A modern geometric sans — Inter or Geist. Large, bold, tight letter-spacing for headlines. No serif.

**Visual language:** Subtle radial gradients, fine dot-grid or line-grid backgrounds, glass-card surfaces with `backdrop-filter: blur`. Think Linear, Vercel, or Raycast landing pages — dark, premium, restrained.

---

### `/` — App landing page

**Section 1 — Hero**

Full-viewport hero. Large headline, brief subhead, two CTAs, and a visual.

```
Headline: "Train smarter. Fuel better. Track everything."
Subhead:  "Persistence is the workout and nutrition companion for
           athletes who take it seriously — and coaches who
           need visibility into their clients."
CTA 1: "Download on the App Store" → links to App Store (placeholder until live)
CTA 2: "For coaches →" → smooth-scroll to Coach section
```

Right side / below on mobile: a stylised phone frame mockup with a screenshot placeholder (dark phone outline, app icon centred, or a gradient fill — no real screenshots yet). Keep it abstract; we don't have final screenshots.

**Section 2 — Three pillars (feature highlights)**

Three horizontal cards, icon + title + one-line description:

| Icon | Title    | Description                                                                                         |
| ---- | -------- | --------------------------------------------------------------------------------------------------- |
| 🏋️   | Train    | Log every set, track every rep. Offline-first with smart rest timers and automatic PR detection.    |
| 🥗   | Fuel     | Barcode scanner, macro ring, 146k foods. Nutrition tracking that doesn't get in the way.            |
| 📈   | Progress | Streaks, volume trends, body composition, achievements. See the compound effect of consistent work. |

**Section 3 — Coach mode**

Slightly different treatment — darker card, coach-specific copy.

```
Label: FOR PERSONAL TRAINERS
Headline: "Your clients. Your programmes. One place."
Body: "Persistence includes a full coach mode — client roster,
       invite flow, programme assignment, and progress visibility.
       Designed for PTs who want to move beyond WhatsApp and spreadsheets."
CTA: "Learn more about coach mode →" (no page yet — scroll to email capture or link to contact)
```

**Section 4 — App Store badge + brief feature list**

```
"Available on iPhone"
[App Store badge — use official SVG, grey/outline style]
"Coming to Android"
```

Below: a simple inline list of features (8–10 bullet points in two columns, light grey text):

- Offline-first with SQLite sync
- Barcode food scanner (146k UK foods)
- HealthKit integration (iOS)
- Automatic personal record detection
- Rest timer with haptic feedback
- AI nutrition logging (coming soon)
- Coach mode with client management
- Subscription management via App Store

**Section 5 — Footer**

Minimal. Logo, copyright, links to Privacy and Terms, link back to `evans-software-solutions.com`.

```
Persistence · A product by Evans Software Solutions
© 2026 Evans Software Solutions Ltd · Privacy · Terms
```

---

### `/privacy` — Privacy policy

Clean, readable prose page. Dark background, comfortable reading width (680px max), good heading hierarchy. No fluff — cover what Apple reviewers and users actually care about:

1. **What we collect:** account info (email, name), workout data, nutrition logs, body measurements, health metrics (HealthKit — steps, weight, active calories), device tokens for push notifications
2. **Why we collect it:** to provide the app's core features; we don't sell it, don't use it for ads
3. **Third-party services:** Supabase (auth + realtime), AWS (infrastructure), RevenueCat (subscription management), Stripe (web/Android payments), Expo (push notifications)
4. **Your rights:** access, export, deletion (in-app account deletion available in Settings → Account)
5. **Data retention:** deleted on account deletion; backups purged within 30 days
6. **Contact:** hello@evans-software-solutions.com (or a dedicated persistence@ alias if you prefer)
7. **Last updated:** June 2026

Keep it honest and plain-English. No legal boilerplate walls of text — Apple reviewers and users should be able to read it in under 2 minutes.

---

### `/terms` — Terms of service

Same visual treatment as privacy. Cover:

1. Acceptance
2. What the service is (personal fitness tracking tool; not medical advice)
3. Account responsibility
4. Acceptable use (personal use; no scraping, no automated abuse)
5. Subscription terms (auto-renews; cancel any time via App Store or Settings)
6. Disclaimer (no warranty; not a substitute for medical or professional advice)
7. Governing law: England and Wales
8. Contact: hello@evans-software-solutions.com

---

## Part 2 — ESS Site modernisation (`evans-software-solutions.com`)

### What the current site looks like

- Dark navy hero section (good), but the rest of the page switches to a pale grey/white background. The contrast between sections feels disconnected rather than intentional.
- Feature cards (01/02/03 Founder-led / Stack / Outcomes) are plain white boxes with tiny grey numbers. Minimal visual interest.
- "What I do" services section uses a serif headline that clashes with the modern sans-serif body. The mixed serif/sans pattern repeats throughout.
- "What I'm building" product cards are basic equal-width boxes — Gym & Personal Training is already listed here as "IN DEVELOPMENT" — once Persistence launches it should link out to `persistence.evans-software-solutions.com` and show the app icon/badge.
- The overall impression is "first portfolio site" rather than "senior independent product engineer who charges serious day rates."

### Design direction for the modernisation

**Single theme, no mid-page colour flips.** Either go full dark (recommended — it matches your product suite) or go full light with strong typography. The current alternating works against the brand.

**If going dark throughout:**

- Background: `#0a0c14` with very subtle noise texture (5% opacity SVG noise)
- Surface/card: `#11141f` with `1px solid rgba(255,255,255,0.06)` border
- Glassmorphic nav: `backdrop-filter: blur(12px)` on scroll, `background: rgba(10,12,20,0.8)`
- Accent: keep the current blue (`#2563eb`) but add a subtle indigo-to-blue gradient for highlights
- Text: `#f0f2fa` with `#6b7494` muted

**Typography — drop the serif:**

- Single typeface throughout: Inter or Geist (already popular in the dev/tech space)
- Hero: `clamp(48px, 6vw, 80px)` bold, tight tracking (`-0.03em`)
- Section headers: 36–40px, medium weight
- No serif decorative headlines — the current "What I do" / "What I'm building" serif titles look dated

**Product cards ("What I'm building"):**

- Add a coloured left border or icon block per product (Axel = orange, Persistence = indigo, LettingsOps = green, etc.)
- Axel is LIVE — add a live badge and a link
- Persistence: update to "Coming to App Store" with the badge + link to `persistence.evans-software-solutions.com`
- Give cards a subtle hover state: `border-color` shift + `box-shadow` lift

**Hero section — add more context:**

- Current: generic "full-stack engineer, founder-led" copy
- Better: call out the stack and the fact you ship products yourself, not just client work — "I've shipped [X] products in production. I'll ship yours."
- Consider a subtle animated gradient or particle grid in the background instead of the flat dark blue

**Services section — tighten the cards:**

- Four services currently listed. Add a tech stack badge row to each (TypeScript, React, AWS, etc.)
- The "Learn more →" links should go somewhere — even an anchor section with more detail on each service

**Social proof:**

- The site has no testimonials, no client names, no case studies, no GitHub activity. Even one or two testimonials would dramatically increase conversion.
- If you can't get testimonials yet, add a "Built with" / "Deployed on" row of technology logos (AWS, Supabase, SST, Expo, etc.) — it signals credibility to technical buyers.

**CTA section at the bottom:**

- Current: "Tell me about your project" with a Get in touch link. Very plain.
- Better: A styled CTA block with a brief restatement of value, input field for email/project description, or at minimum a prominent Calendly/contact link.

---

## Technical implementation

### Persistence site (new)

```
New repo (or monorepo package): packages/persistence-web
Stack: Vite + React + TypeScript
Routing: React Router v6 (three routes: /, /privacy, /terms)
Styling: Tailwind CSS (utility-first, no design system needed for a 3-page site)
Deploy: SST StaticSite resource in infra/
Subdomain: persistence.evans-software-solutions.com → configured in Route 53 CNAME or A record
Build output: /dist → S3 + CloudFront via SST
```

**SST resource to add in `infra/`:**

```typescript
new sst.aws.StaticSite("PersistenceWeb", {
  path: "packages/persistence-web",
  build: {
    command: "bun run build",
    output: "dist",
  },
  domain: {
    name: "persistence.evans-software-solutions.com",
    // hostedZone must already exist in Route 53 for evans-software-solutions.com
  },
});
```

**Checklist for persistence site:**

```
[ ] / hero, pillars, coach section, App Store section, footer
[ ] /privacy — full policy content, publicly readable without auth
[ ] /terms — full terms content, publicly readable without auth
[ ] No auth gate on any page
[ ] Mobile responsive (320px → 1440px)
[ ] meta description, og:image, og:title on all three pages
[ ] canonical URL set correctly
[ ] App Store badge SVG included (official Apple badge)
[ ] Footer links to both /privacy and /terms
[ ] SST deploy verified on persistence.evans-software-solutions.com
[ ] URL smoke-test: curl -I https://persistence.evans-software-solutions.com/privacy returns 200
```

### ESS site modernisation

This requires access to the ESS website repo — the `evans-software-solutions.com` codebase is separate from `persistence-backend-sst`. Before starting this part:

1. Add the ESS site repo to the Claude Code session (or open it in a new session)
2. Check what stack it's on — likely Vite/React or Next.js based on the meta tags
3. The agent should read the existing component structure before touching anything

**Scope for the modernisation PR:**

- Unify to dark theme throughout (no mid-page white sections)
- Replace serif section headers with consistent sans-serif
- Upgrade product cards (coloured accents, hover states, Persistence → link to subdomain)
- Glassmorphic sticky nav
- Hero background: subtle animated gradient or static noise-gradient
- CTA section: improve copy + add email input

**What NOT to change yet:**

- Nav links and page structure
- Core copy / services listed
- Contact form / CTA destination

---

## Content to provide before build starts

The build agent can use placeholder content for anything not provided, but having these ready speeds things up:

- [ ] App icon (1024×1024 PNG or SVG) for the landing page hero and og:image
- [ ] Any real app screenshot or screen recording (even rough) for hero mockup
- [ ] Preferred contact email for privacy/terms pages (hello@evans-software-solutions.com or a persistence@ alias)
- [ ] App Store URL (once live — placeholder until then)
- [ ] Company registration number for ESS Ltd (to include in Terms if desired)
