# 14 — Navigation: Manual Smoke Test

> Reviewer's step-by-step e2e walkthrough for the navigation acceptance gate
> (`tasks.md` T-14.9.4 + T-14.6.4 + T-14.8.3). Run against `bun run dev` on a
> dev build (the `(dev)` primitive-review routes were removed; sense-check on
> the running app). Each step maps to an acceptance criterion.
>
> The cross-cutting flow is also covered automatically by
> `packages/mobile/app/__tests__/navigation-flow.test.tsx` (mode-driven IA +
> drawer slice + mode-switch eligibility). This document covers the on-device
> visual + gesture behaviour the jsdom tests can't assert (animation, blur,
> safe-area float, real Linking).

## Setup

- A trainer-tier account (so coach mode is eligible) and, ideally, a free/
  premium account (so the mode-switch card is hidden).

## Athlete flow

1. Launch the app → land on **Home** (athlete). _(STORY-001, index branch)_
2. Tab bar shows exactly four tabs: **Home · Train · Fuel · You**, cyan
   accent on the active tab, no COACH dot. _(STORY-001 AC 1.1–1.6, STORY-008)_
3. Tap **Train** → eyebrow `TRAIN`, title `Workouts`, a `<Segmented>` with
   `Workouts | Exercises`, and a search action top-right. _(STORY-005)_
4. Switch the segment to **Exercises** → title becomes `Exercises`, the
   top-right action becomes a **Create** button, the exercises list shows.
   _(STORY-005 AC 5.3–5.6)_
5. Kill + relaunch the app → Train opens on **Exercises** (the last segment
   persisted). _(STORY-005 AC 5.2)_
6. Tap **Fuel** → `ComingSoon` placeholder. _(STORY-006)_
7. Tap **You** → the You placeholder (06 ships real content). _(STORY-001 1.2)_
8. Confirm the tab bar floats clear of the home indicator on a device that has
   one (e.g. iPhone 14) and sits naturally on one that doesn't (iPhone SE /
   Android). _(STORY-008 AC 8.1, 8.3 — T-14.8.3)_

## Drawer + mode switch (trainer account)

9. From any screen, tap the **avatar** in the header → the ProfileDrawer
   slides up over the tab tree with a backdrop blur. _(STORY-004 AC 4.2–4.4)_
10. Tap the backdrop → the drawer slides down and closes. Relaunch the app →
    the drawer is closed (not persisted). _(STORY-004 AC 4.5)_
11. Open the drawer → tap **Switch to Coach** → the drawer closes, the tab-bar
    accent animates **cyan → violet over ~200ms**, the tab spec swaps, the
    COACH dot appears, and you land on a tab that exists in coach mode (the
    equivalent of where you were; Train→Clients, Fuel→Programs, else Home).
    No flash of the wrong tabs. _(STORY-003 AC 3.7 — T-14.6.4)_
12. Coach tab bar shows exactly: **Home · Clients · Programs · You** (no Fuel).
    Clients / Programs render `ComingSoon` (M8). _(STORY-002)_
13. Open the drawer → **Switch to Athlete** → accent animates violet → cyan,
    tabs swap back to Home · Train · Fuel · You.
14. (Optional) Enable the OS **Reduce Motion** setting and repeat 11/13 → the
    accent jumps to the target colour with no transition (still correct).

## Non-eligible account

15. Sign in with a free/premium (non-trainer) account → open the drawer → the
    mode-switch card is **not** shown (08 composes the card; eligibility is
    `useUserMode().isTrainerEligible`). The tab bar stays athlete-only.
    _(STORY-003 AC 3.3)_

## Eligibility downgrade (watchdog)

16. While in coach mode, simulate a subscription downgrade out of trainer tier
    (or use a test account that loses eligibility) → on next foreground the
    app force-falls-back to **athlete** mode. _(STORY-003 AC 3.5)_

## Out of scope for this gate

- Legacy `persistence://` deep-link redirects — **deferred** (Phase 14.7; no
  released users). See `tasks.md` Phase 14.7 note. When picked up, add the
  redirect steps here.
- ProfileDrawer body content (identity / subscription / preferences) — owned
  by `08-profile-settings`; this gate only checks the drawer opens/closes.
