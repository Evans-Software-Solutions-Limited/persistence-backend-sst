# GTM Expansion — Design Generation Tasks

Companion to `BRIEF.md` §8 row 10. This is the dedicated design workstream:
each task below is a self-contained prompt to hand to a design-generation
session (the `frontend-design` skill for mobile surfaces, or Figma generation
for the web dashboard). Run the relevant task BEFORE the corresponding mobile
PR is built, and attach the output (screens/tokens/interaction notes) to that
milestone's FRONTEND_BRIEF.

**Standing context to prepend to EVERY prompt below:**

> Persistence is a premium iOS gym/fitness app (React Native/Expo). Design
> system: dark-first, premium gym-app aesthetic — NOT generic mobile UI
> (see memory `feedback_design_quality`). The design-source prototype and
> shipped screens are the first source of truth for tokens, spacing, cards,
> and typography (`feedback_prototype_first_source_of_truth`); new surfaces
> must read as native siblings of the existing Train/Fuel/Home tabs. These
> are NET-NEW surfaces (no legacy-port fidelity constraint), but reuse
> shipped primitives: Card (with glow), bottom sheets (root-mounted, overlay
> the tab bar), FeatureGatePrompt, the AI draft-confirm card pattern from
> Snap AI (`AiDraftConfirmPresenter`), segmented controls, quick-action rows.
> All copy in UK English. Every screen: light+dark, small (SE) and large
> (Pro Max) phones, Dynamic Type tolerant.

---

## D1 — Equipment scan sheet + detected-equipment draft (M19-P1)

**Prompt:**
Design the "Scan your gym" flow as a root-mounted bottom sheet, mirroring the
Snap AI meal-photo flow's rhythm: (1) entry state — camera/gallery CTA with a
one-line promise ("Point it at the gym — we'll build around what's there");
(2) processing state — photo thumbnail + shimmer; (3) draft-confirm state —
the photo at top, below it a chip-grid of detected equipment (each chip
toggleable on/off, confidence subtly encoded, unknown items shown as dimmed
"unrecognised" chips), an "Add equipment" affordance opening a searchable
picklist of the full equipment catalog, and a primary CTA "Use this equipment"
plus a secondary "Save as my gym". Include the error states: unreadable photo
(422), daily-limit reached (429 — friendly, shows when it resets), free-taster
exhausted (402 — this one is a conversion surface: show remaining=0 and the
premium upsell inline, not a dead end). Deliverable: all states, both themes,
component inventory mapped to existing primitives.

## D2 — Generate Workout flow, both entry points (M19-P2)

**Prompt:**
Design "Generate workout": (A) from the Train tab — a composer screen with a
free-text prompt field (placeholder teaching by example: "Chest and triceps —
I've only got a cable machine and dumbbells"), an equipment context row
(chips from D1's selection / "My gym" / presets: Full gym, Hotel gym,
Dumbbells only, Bodyweight, Bands), optional quick-hints (duration, focus,
difficulty) as compact selectors, and a prominent Generate CTA; (B) from
Quick Start — a slim inline variant reachable mid-session. The RESULT is a
draft workout review screen: workout name (editable), exercise list with
sets×reps/rest per row, per-row swap/remove, drag-reorder, "Regenerate" (shows
remaining daily allowance), and TWO primary paths: "Save workout" and
"Start now" (Generate & Go). Show the generating state (skeleton exercise
rows, not a spinner). Free-tier: a persistent but unobtrusive "2 free
generations left" chip. Deliverable: both entry points, result screen, all
states, both themes.

## D3 — Taster/paywall touchpoints + tier picker with Premium+ (M19-P0)

**Prompt:**
Three surfaces: (1) the free-taster meter treatment used across D1/D2 (chip +
its exhausted → upgrade state); (2) the upgraded subscription-selection screen
now presenting free / Premium / Premium+ / trainer tiers from the catalog —
Premium+ needs a differentiated "everything in Premium plus…" presentation
(higher AI allowances, programme import) without cluttering the existing
purchase flow (the picker is catalog-driven; design must tolerate tiers
appearing/disappearing); (3) the onboarding paywall moment — where a brand-new
user meets the taster ("3 free AI workouts — no card") so day-0 trial intent
is captured without hard-gating the aha moment. Deliverable: the three
surfaces, upgrade-path copy, both themes.

## D4 — Share cards, two variants (M20-P2)

**Prompt:**
Design two 9:16 branded share-card templates rendered in-app and exported as
images to the native share sheet (TikTok/Reels/Stories sized, safe margins):
(1) Session card — headline stat block (volume, duration, PRs), subtle
Persistence branding, dark premium look; (2) Scan-to-workout card — the user's
gym photo as the canvas, detected-equipment chips overlaid, the generated
workout as a compact list, and a "built by Persistence AI" mark. Both need a
small App Store attribution/QR zone, must strip location/EXIF context, and
must stay legible when Instagram compresses them. Also design the one-tap
share entry points on the session-summary and post-generation screens.
Deliverable: both templates + entry-point placements, export-safe specs.

## D5 — B2B org admin dashboard (M21, web `packages/web`)

**Prompt:**
Design a corporate wellbeing-buyer dashboard (desktop-first web, matching the
web app's existing theme system incl. dark mode): overview page with seats
purchased vs activated, weekly active members, workouts completed, and an
engagement trend line over the pilot period; a seats page (invite-code
display/regenerate, seat count, join states); an export/report affordance
(the buyer forwards this to their board). HARD CONSTRAINT to reflect in the
design: aggregate-only — no individual member names, no per-person metrics,
and metrics suppress below a minimum cohort with an explanatory empty state
("shown once 5+ members are active — individual data is never displayed").
That privacy stance is a selling point: make it visible, not buried.
Deliverable: overview + seats pages, empty/loading/suppressed states, both
themes.

## D6 — Smart swap picker upgrade (M19-P3)

**Prompt:**
Redesign the in-session `SwapExercisePopover`: today it's a same-muscle-group
filtered list. New: a ranked "Best matches" section (equipment-compatible,
same muscles — each row shows WHY: "Same muscles · uses your equipment"),
a divider, then the full filtered library beneath. When session equipment
context exists, incompatible exercises are visually de-emphasised but not
hidden. Keep the interaction one-tap-to-swap with the existing substituted-row
treatment in the session view. Deliverable: popover states with/without
equipment context, both themes.

---

**Process notes for the design agent:** produce interactive HTML mocks or
Figma frames per surface; review with Brad before the corresponding build PR;
final visual QA on device via the visual-verify loop. Copy decisions
(taster wording, upgrade prompts, share-card tagline) are Brad-reversible —
flag them in the review, don't block on them.
