# M0 — Handover notes

You're picking up M0 cold. This file is the tight handover — it covers **only** what the briefs (`BRIEF.md`, `BACKEND_BRIEF.md`, `FRONTEND_BRIEF.md`, `SMOKE_TEST.md`) don't already contain. Read those first; come back here for context that isn't in them.

## Spec-first discipline (read this before anything else)

This project follows a Kiro-style spec-first workflow. **Specs are the contract; briefs are scoped cuts of that contract; code traces to specific spec sections.** Non-negotiable.

Concretely, that means:

1. **Every feature lives under a single `specs/NN-<feature>/` folder** with three files — `requirements.md` (what users need, acceptance criteria), `design.md` (architecture, domain model, ports, endpoints, UI structure), `tasks.md` (the actionable checklist that maps to requirements + design).
2. **A feature's spec covers both tracks** — backend and frontend together. There is no separate "backend spec"; the backend endpoints live in the same feature spec's `design.md` alongside the mobile domain/UI architecture. This is what makes milestone-planning coherent.
3. **Briefs never introduce architecture.** If your work requires a new port, a new endpoint, a new domain model, or a new UI pattern that isn't already in `design.md`, you update the spec FIRST (as a dedicated commit in your PR), then implement against the updated spec. The spec is where new ideas land; the brief is where scoped execution happens.
4. **Every PR traces its changes to spec sections.** Commit messages and PR bodies reference: "implements `design.md` § Reference-list cache", "closes `tasks.md` Phase 7 items A, B, C", "satisfies `requirements.md` AC 4.5". A reviewer can open the spec alongside the PR and confirm alignment line-by-line.

### Your first task in this session, before writing any code

**M0 has spec gaps.** The briefs describe architecture (reference-list cache, backend write handlers) that isn't fully in `specs/03-exercise-library/{requirements,design,tasks}.md` yet. Fix that before coding:

1. Read `specs/03-exercise-library/{requirements.md, design.md, tasks.md}` — understand what's there today.
2. Extend **`design.md`** to include:
   - The new **backend write endpoints** (`POST/PATCH/DELETE /exercises`) and the extended `GET /exercises` filter shape, with wire format and ownership rules. See `BACKEND_BRIEF.md` for the technical detail.
   - The **reference-list cache** as a new architectural section — ports, storage schema, query shape, staleness strategy, enum↔UUID bridge. See `FRONTEND_BRIEF.md` for the technical detail.
   - The **hierarchical filter modal** pattern (section list → detail-per-axis with search on long lists) as a UI structure note.
3. Extend **`requirements.md`** with acceptance criteria for each of the above. E.g. "AC: user with a custom exercise they created can edit its name and see the change persist offline, syncing to backend when online". These are what `SMOKE_TEST.md` should map to 1:1.
4. Update **`tasks.md`** to mark what's in scope for M0 vs what stays deferred for M5. Every item in M0's scope should trace back to a design section and a requirement.
5. Ship the spec updates as the **first commits** on both M0 branches (backend branch gets the design.md backend-endpoints commit + requirements AC commit; frontend branch gets the design.md reference-list / modal commits + requirements AC commit). Don't merge those commits in isolation — they land as part of the M0 PRs.
6. Then implement against the updated specs. Every subsequent commit on each branch references the spec section(s) it's implementing.

If the brief and the updated spec disagree, **the spec wins**. If that happens, flag it — we updated the spec for a reason, but briefs occasionally carry context the spec misses.

### Concrete commit trace for M0 (shape to follow for all future work)

Your PR commit history on each branch should look roughly like this:

```
1. docs(03-exercise-library): add reference-list cache to design.md
2. docs(03-exercise-library): add AC 7.1-7.5 (reference-list cache) to requirements.md
3. docs(03-exercise-library): mark M0 scope in tasks.md Phase 7
4. feat(core): POST /exercises handler (implements design.md § Backend writes)
5. feat(core): PATCH + DELETE /exercises (implements design.md § Backend writes)
6. feat(core): extend GET /exercises with multi-axis filters (satisfies AC 7.2)
7. test(core): handler tests covering ownership + multi-axis filter OR semantics
```

Same shape on the frontend branch: spec updates first (design + requirements + tasks), then implementation commits that explicitly cite spec sections.

Every implementation commit message should include a **Spec alignment** footer:

```
feat(core): POST /exercises handler

...commit body...

Spec alignment:
- Implements specs/03-exercise-library/design.md § Backend writes > POST /exercises
- Satisfies specs/03-exercise-library/requirements.md AC 7.3 (user can create
  a custom exercise with ownership scoped to their user id)
- Closes specs/03-exercise-library/tasks.md Phase 7 item 3

Co-Authored-By: Claude <noreply@anthropic.com>
```

The PR body itself should open with a `## Spec alignment` block listing every
section/AC/task covered, so a reviewer can follow along with both documents
open.

## Where the source of truth lives

- **The plan** driving the whole execution model: `/Users/bradleysimms-evans/.claude/plans/reflective-snuggling-cosmos.md` (approved v3, post-user-review)
- **Architectural rules + brief-driven workflow**: [`specs/_agent.md`](../../_agent.md)
- **Feature-spec parent authority for M0**: [`specs/03-exercise-library/`](../../03-exercise-library/) — its `tasks.md` has a "Current state (2026-04-19)" section you should read
- **Backend rules** (SST + Elysia + Neon + JWT + ownership checks): [`CLAUDE.md`](../../../CLAUDE.md) at repo root
- **Roadmap**: [`specs/milestones/ROADMAP.md`](../ROADMAP.md) — M0 through M11, status per milestone
- **What shipped in Phase 4** that M0 is fixing: [`HISTORICAL_PHASE_4_BRIEF.md`](./HISTORICAL_PHASE_4_BRIEF.md) (sibling file)
- **Legacy mobile app** (visual grammar reference only — never copy code): `/Users/bradleysimms-evans/Documents/projects/personal/persistence-mobile/app/exercises.tsx` and surrounding files

## Branching — two branches, two PRs

Both branched from fresh `main`:

- **Backend:** `feat/m0-backend-exercises-writes` → one PR titled `feat(core): exercise write handlers + multi-axis filters (M0)`
- **Frontend:** `feat/m0-mobile-reference-lists` → one PR titled `feat(mobile): reference-list cache + filter wire format + hierarchical modal (M0)`

Whichever PR merges first, the other rebases onto main and carries on. Frontend depends on the backend endpoints existing — so either:

1. **Backend merges first** (ideal). Frontend rebases, removes any temporary mocks, re-runs smoke test against real endpoints, merges.
2. **Frontend develops against in-memory stubs** while backend is in review. The `InMemoryApiAdapter` already exists and can be temporarily extended with the new write methods. Gate the real e2e smoke test on backend being merged.

Both branches are independently reviewable. User will squash-merge each PR, the other rebases, and the branch is deleted. No long-lived milestone branch.

Coordinate across the two tracks by agreeing on the wire format up front (see "Inconsistencies flagged during the spec sweep" below — the reference-list response shape is the critical shared contract).

## What Phase 4 + the 6 bugbot fixes taught us (patterns to mirror)

### Container idioms

- **Double-tap guards use refs, not state.** Two taps in the same event-loop turn both pass a state-based guard before React re-renders. Pattern: `const isXRef = useRef(false); if (isXRef.current) return; isXRef.current = true; ...; finally { isXRef.current = false }`. See `ProfileContainer.handleSignOut` and `ExerciseListContainer.triggerRefresh`.
- **Debounced search requires splitting filter memos.** `useExerciseFilters` exposes both `filters` (live) and `filtersWithoutSearch` (stable across `setSearch` calls). Container reads `filtersWithoutSearch` + merges `useDebouncedValue(search)` on top so the query's `useMemo` doesn't recompute per keystroke. Apply the same pattern to any context that holds live text input feeding a heavy memo.
- **`hasAnyFilter` / similar flags must stay in lock-step with the debounced filter object.** If the flag is derived from raw state and the query uses debounced state, the 300ms window mis-renders empty states. Derive locally in the container from the same object the query consumes.

### Presenter idioms

- **Lists must use `useCallback(renderItem)` + `React.memo(Card)`.** Without both, every parent re-render re-renders every visible cell. See `ExerciseListPresenter` + `ExerciseCard`.
- **Staggered enter animations** for multi-section screens via `useStaggeredEntry(index)` from `src/ui/hooks/useStaggeredEntry.ts` (0-based index; wrap each section in `<Animated.View style={style}>`).
- **V2 tokens only.** `$primary` cyan `#00D4FF`, `$success` `#22C55E` (cooler than legacy Material), `$warning` `#F59E0B`, `$error` `#EF4444`, neutral0 `#FFFFFF` → neutral1000 `#0A0A0F`. Do NOT import legacy blue `#2196F3` or Material semantic colours.
- **Row/Column gap props take unquoted variant strings, not token strings.** `<Row gap="sm">` works, `<Row gap="$sm">` does not — the variant-map uses `"sm": { gap: "$sm" }`. Different from most other Tamagui props, which want `"$sm"`.
- **Empty states are left-aligned, not centered.** Title 18pt weight 600 → description 14pt `$colorMuted` → `variant="outline"` or `secondary` button, NOT fullWidth. See `ExerciseListPresenter.renderListEmpty`.
- **Whole-card pressable, no chevron.** Chevrons belong in settings lists, not content cards.
- **Custom-exercise indicator is a 3pt `$primary` left-accent** (absolute positioned inside the card), NOT a chunky "CUSTOM" badge. See `ExerciseCard.CustomAccent`.
- **Difficulty pills** use tinted backgrounds at 12% alpha + text at 80-85% lightness variant of the semantic. See `DIFFICULTY_PILL` const in `ExerciseCard.tsx`. Replicate the look for any severity-style indicator.

### Test conventions

- **Harness:** `packages/mobile/__tests__/test-utils.tsx`'s `renderWithTheme` wraps with `SafeAreaProvider` + `TamaguiProvider`. Use for every presenter test.
- **Container tests mock the presenter.** `jest.mock("@/ui/presenters/XPresenter")`, capture props via `MockPresenter.mockImplementation((props) => { lastProps = props; return <Stub /> })`. Stub exposes `<Pressable testID="stub-x" onPress={props.onX} />` etc. so the test exercises container logic without rendering real UI.
- **Jest hoisting quirk:** variables referenced inside `jest.mock(...)` factory args must be prefixed `mock*` (case-insensitive). `const mockRenderSpy = jest.fn()` works; `const renderSpy = jest.fn()` throws.
- **`jest.setTimeout(15_000)` required** on container test suites that render via Tamagui (compilation is slow).
- **`// eslint-disable-next-line import/first`** goes above imports that follow a `jest.mock()`.
- **`FiltersProbe` pattern** — render `<FiltersProbe onUpdate={v => (lastContext = v)} />` inside a provider to capture hook state from outside the component under test. See `ExerciseFiltersContainer.test.tsx` for the canonical use.
- **Reference-stability tests** — when verifying a memo doesn't invalidate, assert `expect(memoA).toBe(memoA_after_unrelated_change)` (identity via `toBe`, not `toEqual`). That's how `useExerciseFilters.test.tsx` proves `filtersWithoutSearch` is stable.
- **Regression tests over coverage.** Every bugbot fix shipped with a test that would have failed the bug scenario. Same rule for new work: if it could silently regress, write a test that fires a buzzer when it does.

### Commit conventions

- **Format:** `feat(core): ...` / `feat(mobile): ...` / `fix(mobile): ...` / `perf(mobile): ...` / `docs: ...` / `chore(mobile): ...`
- **Body:** a ~3-line summary + structured sections (Why / Fix / Regression tests / Gates) for substantive commits. See `git log feat/exercises_phase_4 --oneline` for examples (12 commits of precedent).
- **Footer:** `Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>`
- **PR body ends with `### How to view`** block — git checkout + boot commands + screen-navigation steps. Enables user simulator review.

## Known pitfalls that ate time in Phase 4

1. **`.expo/types/router.d.ts` is gitignored** and auto-regenerates on `expo start`. If typecheck fails because of router typing after you add a new `app/(app)/...` route, restart the dev server or hand-edit the file as a temp fix. Don't commit it.
2. **SafeAreaProvider missing in test harness** — if a component uses `useSafeAreaInsets()` and you haven't wrapped with `SafeAreaProvider initialMetrics={...}`, the test throws "No safe area value available". The existing `renderWithTheme` already handles this; your container-test `TestWrapper` also does. New test files: copy the wrapper pattern from `ExerciseListContainer.test.tsx`.
3. **Typed routes strict-mode requires every `router.push` path to be statically known.** Placeholder screens (`[id].tsx`, `create.tsx`, `filters/_layout.tsx`, etc.) need to exist at route time — typecheck fails otherwise. If you add new routes, add placeholder files before code that navigates to them.
4. **`bunx jest` from repo root sometimes corrupts tamagui config** — symptom is `"Missing 'themes' in your tamagui.config file"`. Workaround: run tests via `bun run test:unit` from repo root instead, or `bunx jest --rootDir /path/to/packages/mobile`.
5. **Prettier ignores** — `expo-env.d.ts` and `sst-env.d.ts` are both in `.prettierignore`; don't chase formatting fails on generated files. `.expo/` is also ignored.
6. **Exercises route structure** — the exercises detail/create/filters live as siblings of `(tabs)`, not inside it. See the big block comment in `app/(app)/_layout.tsx` for the why. Don't move them.
7. **Category filter on the UI is deferred.** `ExerciseFilters.category` exists for API compat; no UI surface uses it. If you touch filter code, preserve the field.

## Inconsistencies flagged during the spec sweep — relevant to M0

From the pre-M0 housekeeping (other items apply to later milestones):

- **#2** — mobile `ApiPort` already declares `createExercise`, `updateExercise`, `deleteExercise`. `SSTApiAdapter` has the wire-format mappers. Before M0, they were unused because the backend didn't serve them. Backend agent: your new handlers must match what `SSTApiAdapter.mapCreateExerciseInputToApi` produces (snake-cased `difficultyLevel`, `primaryMuscles`, `secondaryMuscles`, `equipmentRequired`). Frontend agent: don't change the mappers in a way that diverges from existing adapter tests without flagging.
- **#6** — backend handlers exist for `GET /dashboard`, `GET /progress/*` but mobile `ApiPort` has no methods for them. Not your concern for M0 — noting for M1/M4.
- **Reference-list response shape** — backend's `GET /exercises/muscle-groups` currently returns `[{ id: uuid, name, displayName }]` per the legacy audit. Frontend agent: the new `ReferenceEntry.key` field needs a mapping between the backend's `name` (which may or may not be the enum string like `"chest"`) and the mobile's enum. If names don't match, you'll need a bridge function — flag this early if the backend agent hasn't already exposed a `key`/`slug` column. Preferred resolution: backend returns `{ id, key, displayName }` where `key` matches the mobile enum string.

## What to skip reading unless you need it

- **Full plan file** — 300+ lines, most of it about later milestones. Only M0 section and "Strategic decisions" are relevant now.
- **Original Phase 4 brief** — superseded. Read HISTORICAL_PHASE_4_BRIEF.md only if you need context on why the current Exercise list looks like it does.
- **Other milestone stubs** (`specs/milestones/M1-...` through `M11-...`) — placeholders, ignore.
- **Nutrition spec stub** (`specs/13-nutrition-tracking/`) — placeholder, pre-M9.

## What "done" looks like

All 11 steps in [`SMOKE_TEST.md`](./SMOKE_TEST.md) pass against a locally-running `bun run dev` + simulator. Quality gates green on both tracks:

```
bun run prettier:check
bun run typecheck
bun run lint
bun run build
bun run test:unit      # 90% threshold per-file
```

Then PR(s) opened + merged + branch cleaned up. Update [`specs/milestones/ROADMAP.md`](../ROADMAP.md) M0 status to `shipped`.

## When to escalate back to the user

- **Brief is materially insufficient.** The brief forbade scope creep; it didn't forbid surfacing gaps. If the backend response shape is incompatible with a UUID→enum mapping, ask before inventing a bridge.
- **Backend schema change.** If you need a new column on the `exercises` table (soft-delete `deleted_at`, for example), propose the migration in the PR body — don't ship silently.
- **Design decision not covered by Phase 4 precedent.** If M0 introduces a UX pattern this session hasn't established (new empty-state copy for the creator stub, say), flag it. Don't invent.
- **Smoke test fails repeatedly after good-faith debugging.** Follow the rollback plan in `SMOKE_TEST.md` and surface the issue.

Good luck.
