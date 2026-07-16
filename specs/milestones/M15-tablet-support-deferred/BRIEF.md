# M15 Tablet Support — DEFERRED, post-MVP

> **Status: PARKED, not scoped.** This is a placeholder capturing the decision and rationale, not
> a ready-to-trigger brief. Do NOT dispatch an agent against this file as-is — it needs a real
> requirements/design pass first (per the repo's Kiro spec discipline: net-new feature scope needs
> requirements.md + design.md + tasks.md, not just a milestone brief, before code).

## Why this exists

During the M14 responsive-hardening audit (2026-07-01), it was found that `packages/mobile/
app.json` sets `supportsTablet: true` with **zero tablet-aware layout logic anywhere in the
codebase** — the entire UI is designed and built as an iPhone-portrait layout. Today this means an
iPad user gets an unadapted phone UI (blown-up phone layout, not a real tablet layout).

Brad's call (2026-07-01): **coaches specifically are likely to use a tablet rather than a phone**
— this is a real product motivation for tablet support, not a nice-to-have, but it's explicitly
**post-MVP**. Also explicitly relevant to the **Android release**, not just iOS/iPadOS — since
this is an Expo/React Native codebase, "tablet support" here means large-Android-tablet layouts
too, not only iPad. Whatever gets scoped should be written as a cross-platform large-screen
requirement, not an "iPad" ticket.

## What to do in the meantime (covered by M14, not this milestone)

M14 does **not** add tablet layout logic. The interim stop-gap decision on `supportsTablet: true`
(ship an unadapted phone UI on iPad vs. disable tablet builds until real support lands) was
**not** made as part of this audit — flag to Brad as an open question before M14 ships, since it's
a one-line config call he may want to make explicitly rather than have it default either way.

## Scope sketch (needs a real spec before this is actionable)

Not a commitment — starting points for whoever writes the actual spec:

- Which surfaces matter most for a coach-on-tablet use case first? Likely candidates: Clients
  list/detail (M8 coach mode), Coach Home, session review/feedback screens — i.e. the
  coach-facing surfaces, not necessarily a full-app tablet pass on day one.
  See [[project_current_state]] for where coach-mode screens currently stand.
- Large-screen layout strategy: React Native size-class / `useWindowDimensions`-driven breakpoints
  (e.g. a two-pane master-detail layout on tablet-width screens for lists like Clients), reusing
  the existing flex-based layout patterns already in place per M14's audit findings — this is NOT
  a "start over" project, the existing flex/percentage-driven layout is a reasonable foundation to
  extend with breakpoints, not replace.
- Needs its own design pass (`/frontend-design` or a design-system spec addendum) before
  implementation — per repo discipline, no UI work starts without requirements + design docs.
- Should explicitly cover both iPadOS and large-format Android tablets, given the note above about
  Android release relevance.

## Explicitly not decided yet

- Timeline / which milestone number this actually becomes when unparked.
- Whether this is "make the existing screens tablet-adaptive" or "build tablet-specific coach
  screens" — that's a design decision, not something to infer from this stub.
- Whether Android tablet and iPad support ship together or staged.

**Next step when this gets picked up**: write `specs/NN-tablet-support/requirements.md` +
`design.md` + `tasks.md` per the repo's spec discipline, then a proper milestone brief once that
spec exists. This file is context to hand that process, not a substitute for it.
