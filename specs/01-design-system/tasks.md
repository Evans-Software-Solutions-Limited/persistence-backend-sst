# 01 — Design System: Tasks

> **Spec rewritten from scratch on 2026-05-27.** Prior tasks (32 of 35 shipped) preserved in git history. This is a fresh task list for the May 2026 design-package port.

---

## Phase 1.1 — Token foundation (1 PR)

- [ ] **T-1.1.1** Drop `~/Downloads/handoff/tokens.tamagui.ts` into `packages/mobile/src/ui/theme/tokens.ts` verbatim. Implements `requirements.md` STORY-001 AC 1.1.
- [ ] **T-1.1.2** Configure Tamagui's `createTamagui({ tokens, ... })` in `packages/mobile/src/ui/theme/tamagui.config.ts`. Implements STORY-001 AC 1.2.
- [ ] **T-1.1.3** Verify `bun run typecheck` passes. Closes STORY-001 AC 1.2.
- [ ] **T-1.1.4** Document tokens in `design.md § Token reference` with contrast ratios. Closes STORY-001 AC 1.4.

## Phase 1.2 — Fonts (1 PR)

- [ ] **T-1.2.1** Install `@expo-google-fonts/geist` + `@expo-google-fonts/geist-mono` + `expo-font`. Implements STORY-002 AC 2.1.
- [ ] **T-1.2.2** Configure Tamagui `fonts` block exposing `$display`, `$body`, `$mono` per `design.md § Token reference > Fonts`. Implements STORY-002 AC 2.2.
- [ ] **T-1.2.3** Add `<Text variant="stat-lg">` Tamagui variant helper that auto-applies `$mono` + `tnum` + `zero`. Closes STORY-002 AC 2.3.
- [ ] **T-1.2.4** Smoke-test route at `/dev/fonts` verifies Geist Mono renders slashed zero on `0`, `00`, `000`. Closes STORY-002 AC 2.5.

## Phase 1.3 — Foundation primitives (12 PRs)

One PR each. Each PR includes the primitive file, its `__tests__/` suite, and the `/dev/primitives/<name>.tsx` inventory route.

- [ ] **T-1.3.1** `<Card>` — `packages/mobile/src/ui/components/foundation/Card.tsx`. Implements STORY-003 + STORY-005 ACs.
- [ ] **T-1.3.2** `<Btn>` — same path pattern. 4 variants × 6 tones × 3 sizes = 72 combinations rendered in inventory route.
- [ ] **T-1.3.3** `<Pill>` — `whiteSpace: 'nowrap'` + `flexShrink: 0` enforced.
- [ ] **T-1.3.4** `<IconBtn>` — `event.stopPropagation()` baked in; no-onPress renders as `<View>`.
- [ ] **T-1.3.5** `<Avatar>` — gradient bg, COACH badge always `$accentTrainer`.
- [ ] **T-1.3.6** `<Bar>` — Reanimated 3 `withTiming` (600ms) width animation; `useReducedMotion` respected.
- [ ] **T-1.3.7** `<Ring>` + `<MultiRing>` — Reanimated 3 `useAnimatedProps` on `strokeDasharray` (800ms); `react-native-svg`; `useReducedMotion` respected. Closes STORY-003 AC 3.5.
- [ ] **T-1.3.8** `<Stat>` — ALWAYS `$mono` + `tnum` for value. Trend arrow + percent.
- [ ] **T-1.3.9** `<Segmented>` — 2–5 options, horizontal auto-scroll < 360pt viewport. Closes STORY-003 AC 3.7 + locked decision #9.
- [ ] **T-1.3.10** `<TabBar>` — mode-aware accent + COACH chrome dot. Closes STORY-003 AC 3.8. Detailed nav composition deferred to `14-navigation` (this PR ships the prop-driven primitive only).
- [ ] **T-1.3.11** `<HeaderBar>` — compact + `large` variants.
- [ ] **T-1.3.12** `<BottomSheet>` — `@gorhom/bottom-sheet` v4 integration. Closes STORY-003 AC 3.6.

## Phase 1.4 — Composite primitives (10 PRs)

One PR each. Each PR includes the composite, its `__tests__/`, and a row in `/dev/primitives/composites.tsx`.

- [ ] **T-1.4.1** `<Section>` — consolidates Home `Section` + Progress `SectionTitle` + `ui.jsx SectionHeader`. Implements STORY-004 + AC 4.5.
- [ ] **T-1.4.2** `<DrawerRow>` — icon tile + title + sub + trailing + chevron. `loading` skeleton. Closes STORY-004 AC 4.6.
- [ ] **T-1.4.3** `<MicroPill>` — icon + value + label vertical stack, toned bg.
- [ ] **T-1.4.4** `<RingLegend>` — colour dot + label + value + sub + pct.
- [ ] **T-1.4.5** `<PRCard>` — gold-tinted card with medal + strikethrough previous + delta. `loading` skeleton.
- [ ] **T-1.4.6** `<SummaryChip>` — big count + label, toned bg, `flex: 1`.
- [ ] **T-1.4.7** `<ClientRow>` — avatar + name + status badge + meta + adherence bar + chevron. `loading` skeleton.
- [ ] **T-1.4.8** `<WorkoutCarouselCard>` — 260pt fixed-width with optional `primary` gradient highlight. `loading` skeleton.
- [ ] **T-1.4.9** `<HabitTile>` — 36×36 cell with `done` / `today` / `missed` / `locked` states.
- [ ] **T-1.4.10** `<SearchBar>` — 40pt input with leading search icon.

## Phase 1.5 — Icon migration (1 PR)

- [ ] **T-1.5.1** Add `lucide-react-native` dependency. Implements STORY-008 AC 8.1.
- [ ] **T-1.5.2** Author `packages/mobile/src/ui/components/icons.ts` per the table in `design.md § Lucide icon migration`. Closes STORY-008 AC 8.2.
- [ ] **T-1.5.3** Set defaults (stroke 1.75 unselected, 2 active; sizes `14 | 16 | 18 | 20 | 22 | 24`; colour `currentColor`). Closes STORY-008 AC 8.4 + 8.5.

## Phase 1.6 — Codemod (1 PR)

- [ ] **T-1.6.1** Author `scripts/codemod-tokens.ts` (`jscodeshift` transform). Replacement table per `design.md § Codemod`. Implements STORY-006 AC 6.1.
- [ ] **T-1.6.2** Unit tests for every replacement rule + idempotency.
- [ ] **T-1.6.3** Custom ESLint rule `no-raw-hex-colors` blocking hex literals outside `theme/` + allow-listed paths. Closes STORY-006 AC 6.4.
- [ ] **T-1.6.4** Dry-run report committed to PR description: file-by-file count of replacements.
- [ ] **T-1.6.5** Apply codemod and commit per top-level directory under `src/ui/`. Closes STORY-006 AC 6.5.
- [ ] **T-1.6.6** Codemod the four `*LegacyTheme` files' internals to token refs (their exports remain unchanged). Closes STORY-006 AC 6.3.

## Phase 1.7 — Adoption sweep (N PRs — one per top-level directory)

Each PR visits one directory under `packages/mobile/src/ui/{presenters, components}/` and swaps ad-hoc component shells for foundation primitives per the pattern table in `design.md § Adoption sweep`.

- [ ] **T-1.7.1** Sweep `src/ui/components/home/`. Implements STORY-007 ACs.
- [ ] **T-1.7.2** Sweep `src/ui/components/workouts/`.
- [ ] **T-1.7.3** Sweep `src/ui/components/session/`.
- [ ] **T-1.7.4** Sweep `src/ui/components/subscription/`.
- [ ] **T-1.7.5** Sweep `src/ui/presenters/` (all top-level presenter files).
- [ ] **T-1.7.6** Add marker comment banner at top of every touched file. Closes STORY-007 AC 7.4.
- [ ] **T-1.7.7** Each PR includes before/after screenshots. Closes STORY-007 AC 7.5.
- [ ] **T-1.7.8** Skipped patterns (composite primitives, layout-shape changes) flagged with `TODO(01-design-system)` for owning spec. Closes STORY-007 AC 7.6.

## Phase 1.8 — Smoke-test routes (1 PR)

- [ ] **T-1.8.1** Author `app/(dev)/_layout.tsx` with `__DEV__` redirect gate. Implements STORY-009 AC 9.4.
- [ ] **T-1.8.2** Author `app/(dev)/primitives/index.tsx` — landing route listing all 22 primitives.
- [ ] **T-1.8.3** Author one route per primitive at `app/(dev)/primitives/<name>.tsx`. Each renders an inventory grid of every variant. (Combined with the per-primitive PRs in Phase 1.3 + 1.4 — this task ships the index + layout; per-primitive routes ship with their primitive's PR.)
- [ ] **T-1.8.4** Author `app/(dev)/primitives/composites.tsx` — one usage example of each composite. Closes STORY-009 AC 9.4.

## Phase 1.9 — A11y audit pass (1 PR)

- [x] **T-1.9.1** Automated a11y smoke check (custom assertion via `@testing-library/react-native`) on every primitive's pressable variants. Implements STORY-005 AC 5.5. _Shipped: `packages/mobile/src/ui/components/__tests__/a11y-audit.test.tsx` — asserts role + non-empty label + 44pt effective touch target across every pressable foundation + composite primitive._
- [ ] **T-1.9.2** Manual VoiceOver / TalkBack walk-through of `/dev/primitives/*` — every pressable announces its label. _Checklist authored at `A11Y_WALKTHROUGH.md` for the on-device reviewer pass (not runnable in CI)._
- [x] **T-1.9.3** Touch-target audit: assert every interactive primitive defaults `minHeight: 44` (or 36 with documented dense-row context). Closes STORY-005 AC 5.3. _Shipped: IconBtn/Avatar/HabitTile keep their compact visual size + gain `hitSlop` to reach the 44pt effective floor; Btn md/lg use minHeight 44/52; Btn sm is the documented 36pt dense-row exception._

---

## Acceptance gate (foundation phase complete)

Phase 1.1 → 1.9 are considered DONE when:

- [ ] `bun run typecheck`, `bun run lint`, `bun run build`, `bun run test:unit` all green
- [ ] 90% test coverage on `packages/mobile/src/ui/theme/**` and `packages/mobile/src/ui/components/**`
- [ ] `/dev/primitives/*` renders all 22 primitives + the composites inventory without throwing
- [ ] Codemod report shows ≥ 95% of hex literals replaced; residuals are in allow-listed `*LegacyTheme` files or `__tests__/fixtures/`
- [ ] No `*LegacyTheme` file has been deleted (deletion is M11 Polish, `12-production-readiness`)
- [ ] Adoption sweep PRs cover every top-level directory under `src/ui/{presenters, components}/`
- [ ] Reviewer verifies side-by-side parity between `/dev/primitives/Btn` (and Card, Pill, etc.) and the design system standalone HTML

---

_End of `01-design-system/tasks.md` · 2026-05-27 (rewritten from scratch)_
