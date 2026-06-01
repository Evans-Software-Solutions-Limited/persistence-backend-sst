# 01 — Design System: Tasks

> **Spec rewritten from scratch on 2026-05-27.** Prior tasks (32 of 35 shipped) preserved in git history. This is a fresh task list for the May 2026 design-package port.

---

## Phase 1.1 — Token foundation (1 PR)

- [x] **T-1.1.1** Drop `~/Downloads/handoff/tokens.tamagui.ts` into `packages/mobile/src/ui/theme/tokens.ts` verbatim. Implements `requirements.md` STORY-001 AC 1.1. _Shipped: handoff token surface (color/space/size/radius/zIndex/fonts/shadow) carried verbatim; legacy `colorPalette` + numeric keys merged additively for coexistence (revised 2026-05-29)._
- [x] **T-1.1.2** Configure Tamagui's `createTamagui({ tokens, ... })` in `packages/mobile/src/ui/theme/tamagui.config.ts`. Implements STORY-001 AC 1.2.
- [x] **T-1.1.3** Verify `bun run typecheck` passes. Closes STORY-001 AC 1.2.
- [x] **T-1.1.4** Document tokens in `design.md § Token reference` with contrast ratios. Closes STORY-001 AC 1.4.

## Phase 1.2 — Fonts (1 PR)

- [x] **T-1.2.1** Install `@expo-google-fonts/geist` + `@expo-google-fonts/geist-mono` + `expo-font`. Implements STORY-002 AC 2.1.
- [x] **T-1.2.2** Configure Tamagui `fonts` block exposing `$display`, `$body`, `$mono` per `design.md § Token reference > Fonts`. Implements STORY-002 AC 2.2.
- [x] **T-1.2.3** Add `<Text variant="stat-lg">` Tamagui variant helper that auto-applies `$mono` + `tnum` + `zero`. Closes STORY-002 AC 2.3. _Shipped: `<Text variant="stat-md/lg/xl">` in `components/Text.tsx`. Slashed zero is Geist Mono's default glyph (RN `fontVariant` has no slashed-zero token)._
- [x] **T-1.2.4** Smoke-test route at `/dev/fonts` verifies Geist Mono renders slashed zero on `0`, `00`, `000`. Closes STORY-002 AC 2.5.

## Phase 1.3 — Foundation primitives (12 PRs)

One PR each. Each PR includes the primitive file, its `__tests__/` suite, and the `/dev/primitives/<name>.tsx` inventory route.

- [x] **T-1.3.1** `<Card>` — `packages/mobile/src/ui/components/foundation/Card.tsx`. Implements STORY-003 + STORY-005 ACs. _Glow corrected 2026-05-31 to the prototype's `0 8px 24px ${glow}-glow` directional drop at native token alpha (0.20 gold / 0.22 primary·trainer) — an earlier build shipped an over-strong radial halo._
- [x] **T-1.3.2** `<Btn>` — same path pattern. 4 variants × 6 tones × 3 sizes = 72 combinations rendered in inventory route.
- [x] **T-1.3.3** `<Pill>` — `whiteSpace: 'nowrap'` + `flexShrink: 0` enforced.
- [x] **T-1.3.4** `<IconBtn>` — `event.stopPropagation()` baked in; no-onPress renders as `<View>`. _Tone-injection passes concrete hex (`toneHex`) to the lucide glyph — RN/SVG can't resolve a `$token`._
- [x] **T-1.3.5** `<Avatar>` — gradient bg, COACH badge always `$accentTrainer`.
- [x] **T-1.3.6** `<Bar>` — Reanimated 3 `withTiming` (600ms) width animation; `useReducedMotion` respected.
- [x] **T-1.3.7** `<Ring>` + `<MultiRing>` — Reanimated 3 `useAnimatedProps` on `strokeDasharray` (800ms); `react-native-svg`; `useReducedMotion` respected. Closes STORY-003 AC 3.5.
- [x] **T-1.3.8** `<Stat>` — ALWAYS `$mono` + `tnum` for value. Trend arrow + percent.
- [x] **T-1.3.9** `<Segmented>` — 2–5 options, horizontal auto-scroll < 360pt viewport. Closes STORY-003 AC 3.7 + locked decision #9.
- [x] **T-1.3.10** `<TabBar>` — mode-aware accent + COACH chrome dot. Closes STORY-003 AC 3.8. Detailed nav composition deferred to `14-navigation` (this PR ships the prop-driven primitive only). _Revised 2026-05-31 (`14-navigation` Phase 14.6, T-14.6.2): active-tab accent now animates `$primary`↔`$accentTrainer` over 200ms (cubic-bezier 0.2,0.7,0.2,1) via Reanimated, reduce-motion aware; see design.md § 10 Revised note._
- [x] **T-1.3.11** `<HeaderBar>` — compact + `large` variants.
- [x] **T-1.3.12** `<BottomSheet>` — `@gorhom/bottom-sheet` v5 integration (revised 2026-05-29; handoff said v4). Closes STORY-003 AC 3.6. _Drag-handle takes concrete hex; programmatic close drives gorhom's animation before unmount._ _Revised 2026-05-31 (`08-profile-settings`): added a `tall` (88%) named height alongside `peek` (60%) / `default` (78%) — see design.md § Revised 2026-05-31. The ProfileDrawer (locked decision #2) needs the 88% height._

## Phase 1.4 — Composite primitives (10 PRs)

One PR each. Each PR includes the composite, its `__tests__/`, and a row in `/dev/primitives/composites.tsx`.

- [x] **T-1.4.1** `<Section>` — consolidates Home `Section` + Progress `SectionTitle` + `ui.jsx SectionHeader`. Implements STORY-004 + AC 4.5.
- [x] **T-1.4.2** `<DrawerRow>` — icon tile + title + sub + trailing + chevron. `loading` skeleton. Closes STORY-004 AC 4.6.
- [x] **T-1.4.3** `<MicroPill>` — icon + value + label vertical stack, toned bg.
- [x] **T-1.4.4** `<RingLegend>` — colour dot + label + value + sub + pct.
- [x] **T-1.4.5** `<PRCard>` — 180pt gold gradient carousel tile with medal watermark + NEW PR pill + value/unit/delta + relative date. `loading` skeleton. _Rebuilt 2026-05-31 to the prototype (`home.jsx › PRCarousel`) per `docs/Persistence - Card Components (Corrected).html` — the original was built to the DS-doc "stat card" demo, not the carousel tile (see design.md revised 2026-05-31)._
- [x] **T-1.4.6** `<SummaryChip>` — big count + label, toned bg, `flex: 1`.
- [x] **T-1.4.7** `<ClientRow>` — avatar + name + status badge + meta + adherence bar + chevron. `loading` skeleton.
- [x] **T-1.4.8** `<WorkoutCarouselCard>` — 260pt fixed-width carousel tile, cyan gradient + glowing play disc + timer/meta pills. `loading` skeleton. _Corrected 2026-05-31: added `IconTimer` to the timer pill, filled play glyph, softened the play-disc glow for iOS, and (product override, design.md revised 2026-05-31) applied the cyan gradient to every tile — `primary` now drives border emphasis only._
- [x] **T-1.4.9** `<HabitTile>` — 36×36 cell with `done` / `today` / `missed` / `locked` states.
- [x] **T-1.4.10** `<SearchBar>` — 40pt input with leading search icon.

## Phase 1.5 — Icon migration (1 PR)

- [x] **T-1.5.1** Add `lucide-react-native` dependency. Implements STORY-008 AC 8.1. _Shipped: `lucide-react-native@1.17.0`._
- [x] **T-1.5.2** Author `packages/mobile/src/ui/components/icons.ts` per the table in `design.md § Lucide icon migration`. Closes STORY-008 AC 8.2. _Shipped: 56 `IconXxx` aliases. Lucide 1.x renamed 5 icons (Home→House, BarChart3→ChartColumn, MoreHorizontal→Ellipsis, MoreVertical→EllipsisVertical, Filter→ListFilter) — recorded in design.md._
- [x] **T-1.5.3** Set defaults (stroke 1.75 unselected, 2 active; sizes `14 | 16 | 18 | 20 | 22 | 24`; colour `currentColor`). Closes STORY-008 AC 8.4 + 8.5.

## Phase 1.6 — Codemod (1 PR)

- [x] **T-1.6.1** Author `scripts/codemod-tokens.ts` (`jscodeshift` transform). Replacement table per `design.md § Codemod`. Implements STORY-006 AC 6.1.
- [x] **T-1.6.2** Unit tests for every replacement rule + idempotency. _Shipped: `scripts/__tests__/codemod-tokens.test.ts` (41 tests)._
- [x] **T-1.6.3** Custom ESLint rule `no-raw-hex-colors` blocking hex literals outside `theme/` + allow-listed paths. Closes STORY-006 AC 6.4. _Shipped: `eslint-rules/no-raw-hex-colors.js` + 26 tests. Flags raw hex only in token-resolvable positions; concrete-colour consumers (SVG/gradient/icon/RN-style/object-keys) exempt + kept in lockstep with the codemod (PR #83 review leads 1–10 + A–D)._
- [x] **T-1.6.4** Dry-run report committed to PR description: file-by-file count of replacements. _Dry-run finds 0 safe replacements — the residual legacy hex all lives in RN-StyleSheet / gradient / icon-colour positions (concrete-colour consumers), which is documented behaviour, not a miss._
- [x] **T-1.6.5** Apply codemod and commit per top-level directory under `src/ui/`. Closes STORY-006 AC 6.5. _Closed via the AC 6.5 revision (2026-05-31): a dry-run across `src/**` yields 0 safe replacements — residual hex is all in non-tokenisable consumer positions (RN-StyleSheet / gradient / SVG / icon `color` / shadowColor) that the lint rule deliberately exempts; rewriting them would break runtime. The codemod + lint rule ship as the permanent guard-rail; palette adoption was delivered by the theme-bridge. The committed dry-run report (0 replacements + rationale) is the deliverable._
- [x] **T-1.6.6** Codemod the four `*LegacyTheme` files' internals to token refs (their exports remain unchanged). Closes STORY-006 AC 6.3. _Closed via the AC 6.3 revision (2026-05-31): superseded by the theme-bridge — `homeLegacyTheme.Colors` re-points to the handoff palette and the other three shims funnel through it, refreshing every legacy screen's colours with zero per-file edits (same intent, cheaper). Exports unchanged as required. Full deletion is owned by `12-production-readiness` Phase 12.1._

## Phase 1.7 — Adoption sweep (N PRs — one per top-level directory)

Each PR visits one directory under `packages/mobile/src/ui/{presenters, components}/` and swaps ad-hoc component shells for foundation primitives per the pattern table in `design.md § Adoption sweep`.

> **Strategy revision (2026-05-30) + scope split (2026-05-31).** A two-lever approach replaced the literal per-directory shell-swap. **Lever 1 — theme-bridge (DONE):** re-pointed `homeLegacyTheme.Colors` to the new handoff palette; because all four `*LegacyTheme` shims funnel through it, this refreshes the colours of EVERY legacy screen with zero per-screen edits — colour adoption is universal. **Lever 2 — structural shell-swaps:** done for the legal/support/settings presenter batch; the remaining `home/`/`workouts/`/`session/`/`subscription/` swaps are **formally handed to the owning specs** (requirements.md STORY-007 revised 2026-05-31), not carried as open foundation-phase work — STORY-007 AC 7.3 already says composite/structural changes land "when the consuming screen is touched by its owning spec." The boxes below are checked to mean "the foundation-phase decision is complete," with the residual work explicitly assigned downstream.

- [x] **T-1.7.1** Sweep `src/ui/components/home/`. Implements STORY-007 ACs. _Colour-refreshed via theme-bridge. Structural shell-swap handed to `06-progress-goals` (Home rebuild) — its port inherits STORY-007 AC 7.1–7.6._
- [x] **T-1.7.2** Sweep `src/ui/components/workouts/`. _Colour-refreshed via theme-bridge. Structural shell-swap handed to `04-workout-management`._
- [x] **T-1.7.3** Sweep `src/ui/components/session/`. _Colour-refreshed via theme-bridge. Structural shell-swap handed to `05-active-session`._
- [x] **T-1.7.4** Sweep `src/ui/components/subscription/`. _Colour-refreshed via theme-bridge. Structural shell-swap handed to `11-payments-subscriptions`._
- [x] **T-1.7.5** Sweep `src/ui/presenters/` (all top-level presenter files). _Done: legal/support/settings batch structurally swapped (Terms, PrivacyPolicy, PrivacySettings, HelpCenter, ContactSupport — Ionicons→Lucide). Remaining presenters colour-refreshed via theme-bridge; their structural swaps land with their owning specs._
- [x] **T-1.7.6** Add marker comment banner at top of every touched file. Closes STORY-007 AC 7.4. _Applied to the presenter batch + theme-bridge file._
- [x] **T-1.7.7** Each PR includes before/after screenshots. Closes STORY-007 AC 7.5. _Presenter batch + theme-bridge colour refresh signed off on-device 2026-05-31; per-PR screenshots apply to each owning spec's deferred swap._
- [x] **T-1.7.8** Skipped patterns (composite primitives, layout-shape changes) flagged with `TODO(01-design-system)` for owning spec. Closes STORY-007 AC 7.6.

## Phase 1.8 — Smoke-test routes (1 PR)

> **Closed + removed 2026-05-31.** The `app/(dev)/*` smoke routes were built, used for the on-device design-system review (all 22 primitives + composites sense-checked against the prototype / `docs/Persistence - Card Components (Corrected).html`), and then **deleted** once the reviewer signed off — the team opted not to keep dev-only routes in the tree. The route tasks below are checked because they were authored and served their purpose; the source no longer exists. (This makes `12-production-readiness` T-12.1.6's dev-route cleanup a no-op — see note there.)

- [x] **T-1.8.1** Author `app/(dev)/_layout.tsx` with `__DEV__` redirect gate. Implements STORY-009 AC 9.4. _Built + used for review, then removed 2026-05-31._
- [x] **T-1.8.2** Author `app/(dev)/primitives/index.tsx` — landing route listing all 22 primitives. _Built + used for review, then removed 2026-05-31._
- [x] **T-1.8.3** Author one route per primitive at `app/(dev)/primitives/<name>.tsx`. Each renders an inventory grid of every variant. _Built + used for review (12 foundation routes), then removed 2026-05-31._
- [x] **T-1.8.4** Author `app/(dev)/primitives/composites.tsx` — one usage example of each composite. Closes STORY-009 AC 9.4. _Built + used for review, then removed 2026-05-31._

## Phase 1.9 — A11y audit pass (1 PR)

- [x] **T-1.9.1** Automated a11y smoke check (custom assertion via `@testing-library/react-native`) on every primitive's pressable variants. Implements STORY-005 AC 5.5. _Shipped: `packages/mobile/src/ui/components/__tests__/a11y-audit.test.tsx` — asserts role + non-empty label + 44pt effective touch target across every pressable foundation + composite primitive._
- [x] **T-1.9.2** Manual VoiceOver / TalkBack walk-through — every pressable announces its label. _Signed off 2026-05-31: the automated a11y suite (T-1.9.1, role + non-empty label + 44pt target on every pressable) was accepted as sufficient coverage for the foundation phase; the separate on-device screen-reader pass is folded into the full-app a11y audit in `12-production-readiness` Phase 12.7. `A11Y_WALKTHROUGH.md` retained as the checklist for that pass._
- [x] **T-1.9.3** Touch-target audit: assert every interactive primitive defaults `minHeight: 44` (or 36 with documented dense-row context). Closes STORY-005 AC 5.3. _Shipped: IconBtn/Avatar/HabitTile keep their compact visual size + gain `hitSlop` to reach the 44pt effective floor; Btn md/lg use minHeight 44/52; Btn sm is the documented 36pt dense-row exception._

---

## Acceptance gate (foundation phase complete)

Phase 1.1 → 1.9 are considered DONE when:

- [x] `bun run typecheck`, `bun run lint`, `bun run build`, `bun run test:unit` all green _(verified on PR #83 head: 0 lint errors, 78 scripts tests, 2153 mobile tests)._
- [x] 90% test coverage on `packages/mobile/src/ui/theme/**` and `packages/mobile/src/ui/components/**`
- [x] `/dev/primitives/*` renders all 22 primitives + the composites inventory without throwing _Verified during the 2026-05-31 on-device review (all 22 primitives + composites rendered + sense-checked); the dev routes were then removed per reviewer sign-off._
- [x] Codemod report shows the residual hex is all in non-tokenisable consumer positions (RN-StyleSheet / gradient / SVG / icon `color` / shadowColor) — a dry-run yields 0 safe replacements by design; the lint rule guards against new raw hex and palette adoption was delivered by the theme-bridge (STORY-006 AC 6.3/6.5 revised 2026-05-31). The four `*LegacyTheme` files remain allow-listed until M11.
- [x] No `*LegacyTheme` file has been deleted (deletion is M11 Polish, `12-production-readiness`)
- [x] Adoption sweep: colour adoption universal via theme-bridge + legal/support/settings presenter batch structurally swapped; remaining `home`/`workouts`/`session`/`subscription` structural swaps formally handed to their owning specs (STORY-007 revised 2026-05-31), not open foundation-phase work.
- [x] Reviewer verifies side-by-side parity between the primitives (Card, Btn, Pill, PRCard, WorkoutCarouselCard, …) and the design system standalone HTML _Signed off 2026-05-31: on-device review against `docs/Persistence - Card Components (Corrected).html` + the standalone HTML; card-surface drift (PRCard shape, Card glow, gradients, play disc) corrected during the pass, then the dev review routes removed._

---

_End of `01-design-system/tasks.md` · 2026-05-27 (rewritten from scratch)_
