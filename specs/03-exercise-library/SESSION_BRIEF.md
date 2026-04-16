# Session Brief: Exercise Library (Milestone 03)

## Context

Read the memory files first — they have full project context. Specs live in `specs/` at the repo root. The mobile app is in `packages/mobile`. Agent instructions in `specs/_agent.md` (must read — defines hexagonal architecture, container/presenter pattern, testing requirements).

We're building the Persistence fitness mobile app. The V2 is a rebuild of the original app (`persistence-mobile` at `/Users/bradleysimms-evans/Documents/projects/personal/persistence-mobile`) using hexagonal architecture, offline-first with SQLite, and container/presenter pattern.

**Stack:** Expo 55 / RN 0.83 / Xcode 26 / Tamagui / Supabase auth / SST API backend / react-native-reanimated 4.2.1 / react-native-svg 15.15.3

## What's complete

- **Milestone 00 (Guardrails):** ~97% — hexagonal architecture, DI, testing infra, CI
- **Milestone 01 (Design System):** ~95% — Tamagui tokens, ThemeProvider, all UI primitives, design polish
- **Milestone 02 (Auth Flow):** ~98% — sign-in/up/forgot-password screens with container/presenter, Supabase adapter (24 integration tests), AuthGate redirect (7 tests), sign-out cache clearing, staggered Reanimated enter animations, PLogoDrawLoader (ported from old app), 260 tests, 91% branch coverage, 0 lint warnings

Only deferred item: "sync queue re-sync on next sign-in" — to be defined alongside exercise library data flow.

## Priorities for this session

### 1. Milestone 03 — Exercise Library

Full spec: `specs/03-exercise-library/requirements.md` and `tasks.md`

**Key phases:**

1. **Domain** — `Exercise` model, filter/validation services (pure functions)
2. **Ports & Adapters** — Extend `ApiPort` + `StoragePort`, SST + SQLite + InMemory implementations
3. **Application** — `GetExercisesQuery` (cache-first), `CreateExerciseCommand` (validate + queue sync)
4. **UI — List** — `ExerciseCard`, `ExerciseFilterBar`, `ExerciseListPresenter/Container`, search, filters
5. **UI — Detail** — `ExerciseDetailPresenter/Container`, `app/(app)/exercises/[id].tsx`
6. **UI — Create** — `ExerciseCreatorPresenter/Container`, form validation
7. **Offline** — Cache sync, local search, stale indicator

**Reference the old app** for exercise model, muscle groups, equipment types, and UI patterns:

- `persistence-mobile/constants/exerciseEnums.ts` — categories, muscle groups, equipment
- `persistence-mobile/components/workouts/` — exercise picker patterns
- `persistence-mobile/hooks/api/useGetExercises.ts` — data shape

### 2. Design quality

Use `/frontend-design` skill on every screen. The app must feel like Strong/Hevy/Fitbod — premium dark-first gym aesthetic, not generic. Staggered enter animations (shared `useStaggeredEntry` hook at `src/ui/hooks/useStaggeredEntry.ts`), generous spacing, skeleton loaders.

## Quality gates (must pass)

```bash
bun run prettier:check && bun run typecheck && bun run lint && bun run build && bun run test:unit
```

90% coverage threshold is non-negotiable. 0 lint warnings in mobile package.

## Key gotchas

- **Build command:** `cd packages/mobile && LANG=en_US.UTF-8 npx expo run:ios`
- Run quality gates from **monorepo root**, not packages/mobile
- Use `npx turbo run typecheck --force` to bypass cache when debugging CI failures
- `jest.setTimeout(15_000)` on container test suites that trigger Tamagui compilation (SignUpContainer pattern)
- Test files with `jest.mock()` before imports need `// eslint-disable-next-line import/first`
- `StoragePort` now has `clearAll()` — any new tables added for exercises need clearing in both SQLite and InMemory implementations

## Key files

| File                                                          | What                                    |
| ------------------------------------------------------------- | --------------------------------------- |
| `specs/_agent.md`                                             | Architecture constraints (MUST READ)    |
| `specs/03-exercise-library/tasks.md`                          | Task checklist to work through          |
| `specs/03-exercise-library/requirements.md`                   | User stories & acceptance criteria      |
| `src/domain/ports/api.port.ts`                                | API interface to extend                 |
| `src/domain/ports/storage.port.ts`                            | Storage interface to extend             |
| `src/adapters/api/sst-api.adapter.ts`                         | SST API adapter                         |
| `src/adapters/storage/sqlite.adapter.ts`                      | SQLite adapter (add exercises table)    |
| `src/adapters/storage/__tests__/in-memory-storage.adapter.ts` | InMemory adapter (add exercise cache)   |
| `src/ui/hooks/useStaggeredEntry.ts`                           | Shared enter animation hook             |
| `src/ui/components/index.ts`                                  | Component barrel exports                |
| `src/shared/types/adapters.ts`                                | Adapters type definition                |
| `__tests__/setup.ts`                                          | Jest mock setup (Reanimated, SVG, etc.) |

## Test count baseline

260 tests, 37 suites, 91.23% branch coverage. Don't regress.
