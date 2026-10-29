# Persistence Mobile — Agent Instructions

## Purpose

This file guides AI agents working on the Persistence mobile app. It defines architectural constraints, quality gates, and patterns that **must** be followed for every feature implementation.

---

## Spec-first discipline (Kiro)

**Non-negotiable.** Specs are the contract, briefs are scoped cuts of the contract, code traces to the spec. This applies to every feature migration and every new feature — not just M0, not just the current milestone.

The rules:

1. **Every feature has a single spec folder `specs/NN-<feature>/` with three files**:
   - `requirements.md` — user needs, acceptance criteria. What the user will be able to do.
   - `design.md` — architecture, domain model, ports, backend endpoints, adapters, offline strategy, UI structure. How the system is built to satisfy the requirements.
   - `tasks.md` — actionable checklist. Every item traces back to a requirement AC and a design section.

2. **A feature's spec covers both tracks.** Backend endpoints and mobile architecture live in the same `design.md` side-by-side. There is no separate backend-only spec folder. This is what makes milestone-planning coherent: one spec = one feature = one cut of work across both tracks.

3. **Briefs never introduce architecture.** A milestone brief scopes EXECUTION of an already-specced architecture. If your work requires a new port, a new endpoint, a new domain model, or a new UI pattern that isn't already in `design.md`, you UPDATE THE SPEC FIRST — as a dedicated commit in your PR — then implement against the updated spec. The spec is where new ideas land; the brief is where scoped execution happens.

4. **Every PR traces to spec sections.** Commit messages and PR bodies explicitly cite: "implements `03-exercise-library/design.md` § Reference-list cache", "closes `03-exercise-library/tasks.md` Phase 7 items A, B, C", "satisfies `03-exercise-library/requirements.md` AC 4.5". A reviewer can open the spec alongside the PR and confirm alignment line-by-line.

5. **Spec updates are the first commit(s) of any milestone work.** Backend agent's first commit on their branch: extend `design.md` with the new endpoints + update `requirements.md` with new ACs + mark M0 scope in `tasks.md`. Frontend agent: same shape. Only once the spec is updated does implementation start.

6. **If a brief and an updated spec disagree, the spec wins.** Flag the divergence in PR review — briefs occasionally carry context the spec missed, but the resolution is always "update the spec to match the intent", never "code against the brief while the spec says otherwise."

7. **Specs are append-only in intent.** Mark tasks as shipped, add "Current state (YYYY-MM-DD)" notes, extend design with new sections. Don't rewrite original requirements or delete historical design decisions — preserve the record of what was intended vs what was built.

8. **Net-new features (e.g. nutrition, AI coaching) need requirements + design done BEFORE their milestone kicks off.** A spec stub without real content (just section headings) is not sufficient. A discovery + design agent pass fills it out as its own preparatory work item.

If you find yourself implementing something that isn't in a spec, stop. Update the spec. Then implement.

---

## Execution model — milestones and briefs

Builds on the spec-first discipline above. Briefs are HOW we scope work across specs into shippable milestones; specs are WHAT we're building toward.

- **Source of truth:** each `specs/NN-<feature>/` folder (requirements + design + tasks) is the authoritative description of what a feature must do and how it's architected. Briefs cite them; code traces to them.
- **Milestone briefs** at `specs/milestones/M<N>-<name>/` scope a shippable cross-feature slice of work. A brief cites its parent spec(s) as authority and cuts a focused contract between humans and agents about what's in scope for this milestone. If the parent spec doesn't cover something the brief describes, that's a spec update required FIRST — see rule 3 above.
- **Agents always work from a brief**, never from a raw feature-level `tasks.md`. The `tasks.md` is a reservoir of work; the brief is the next cup to drink. Both trace back to the same well.
- **Every milestone produces four files** in `specs/milestones/M<N>-<name>/`:
  - `BRIEF.md` — overview, review gate, links to the two agent briefs. Includes a `## Spec alignment` section listing which parent-spec sections / requirements / tasks this milestone closes.
  - `BACKEND_BRIEF.md` — focused context for the backend agent (endpoints to add/change, JWT/role/ownership rules, schema touches, exact handler paths). Opens with a `## Spec alignment` citing specific `design.md` sections the work implements.
  - `FRONTEND_BRIEF.md` — focused context for the frontend agent (screens, containers, presenters, adapters, domain additions, legacy-app file paths to reference). Opens with a `## Spec alignment` citing specific `design.md` sections the work implements.
  - `SMOKE_TEST.md` — the reviewer's step-by-step e2e walkthrough against `bun run dev`. Each step maps to an acceptance criterion in `requirements.md`.
- **Parallel execution:** the backend and frontend agents work from their respective briefs in parallel. Each lands a PR on its own branch; both gated on the e2e smoke test before merge.
- **Briefs forbid scope creep.** If an agent discovers the brief is insufficient (missing endpoint, bad assumption, legacy pattern harder than described), it surfaces the gap in PR review rather than expanding scope unilaterally. Real gaps become spec updates first, then brief amendments, then code.
- **See** [`README.md`](./README.md) for the feature-spec index and [`milestones/ROADMAP.md`](./milestones/ROADMAP.md) for the M0 → M11 execution order.

Historical per-phase briefs (e.g. `specs/03-exercise-library/PHASE_4_BRIEF.md`) are preserved for context but no longer model the workflow. They did not follow the Kiro spec-first discipline — new work must.

---

## Reference: Old Mobile App (`persistence-mobile`)

The original app lives at `/Users/bradleysimms-evans/Documents/projects/personal/persistence-mobile`. It is the **behavioural source of truth** for what the V2 must support. Use it as a reference for flows, business rules, edge cases, and proven UI patterns — but **do not copy its architecture**.

### What to extract

- **Business logic and rules** — how workouts are structured, how sets are logged, how supersets work, how visibility/sharing works, how rest timers behave, how PRs are detected. The old hooks and queries encode these rules even though the architecture is different.
- **API hook names → feature coverage** — the old hook list maps 1:1 to features the V2 must support. If the old app has `useGetProgress`, `usePostRecordWorkout`, `usePostEditWorkout`, etc., the V2 needs equivalent capability.
- **UI flows and navigation** — the old app's screen structure and component organisation show the user's mental model. V2 screens should feel familiar.
- **Edge cases and validation** — the old `lib/supabase/queries/` files contain validation logic, error handling, and data transforms that represent real production learning. Port these rules, not the code.
- **Theme tokens** — `constants/colors.ts`, `constants/theme.ts` define the existing brand. V2 should match or evolve these.

### What NOT to copy

- **Direct Supabase queries** — V2 talks to SST API, not Supabase tables.
- **Hook-heavy architecture** — the old app couples data fetching into hooks that mix concerns. V2 uses hexagonal ports/adapters.
- **Tanstack Query as offline storage** — the old app uses React Query cache as a pseudo-offline layer. V2 uses SQLite with an explicit sync engine.
- **Component structure** — the old `components/workouts/` has 29 files with mixed concerns. V2 splits into containers + presenters.

### Key reference paths

| Old App Path                                           | What it tells you                                                                | V2 equivalent                                     |
| ------------------------------------------------------ | -------------------------------------------------------------------------------- | ------------------------------------------------- |
| `hooks/api/useGet*.ts` (30 files)                      | Every read operation the app needs                                               | `domain/ports/api.port.ts` query methods          |
| `hooks/api/usePost*.ts` (25 files)                     | Every write operation the app needs                                              | `domain/ports/api.port.ts` mutation methods       |
| `lib/supabase/queries/*.ts` (12 files)                 | Business logic, validation, data transforms                                      | `domain/services/`, `application/commands/`       |
| `components/workouts/` (29 files)                      | Workout UI: active session, exercise picker, superset, rest timer, quick actions | `ui/containers/` + `ui/presenters/` (split)       |
| `components/home/`                                     | Dashboard tiles: greeting, energy, goals, steps, recent activity                 | `ui/presenters/Dashboard*`                        |
| `components/health/`                                   | HealthKit/Health Connect integration patterns                                    | `adapters/health/`                                |
| `components/trainer/`                                  | PT client management UI                                                          | `ui/containers/Client*` + `ui/presenters/Client*` |
| `components/subscription/`                             | Stripe payment flows, tier selection                                             | `adapters/payments/`, `ui/*/Subscription*`        |
| `components/ui/`                                       | Reusable primitives (Button, Card, LoadingState, SearchBar)                      | `ui/components/`                                  |
| `constants/colors.ts`, `constants/theme.ts`            | Brand colours, typography, spacing tokens                                        | `ui/theme/tokens.ts`                              |
| `utils/bodyMeasurements.ts`, `utils/dateFormatters.ts` | Proven utility functions                                                         | `shared/utils/`                                   |
| `app/(tabs)/*.tsx`                                     | Tab navigation structure: home, progress, workouts, clients, profile             | `app/(app)/(tabs)/*.tsx`                          |
| `app/(auth)/*.tsx`                                     | Auth flow: sign-in, subscription-selection, success                              | `app/(auth)/*.tsx`                                |
| `lib/supabase.ts`, `lib/query-client.ts`               | Auth config, query cache config                                                  | `adapters/auth/`, application config              |
| `constants/exerciseEnums.ts`                           | Exercise categories, muscle groups, equipment types                              | `domain/models/exercise.ts`                       |

### How to use during implementation

1. **Before building a feature**, read the equivalent old app files to understand the full scope of what users expect.
2. **Extract business rules** (validation, calculations, state machines) and re-implement them as pure domain services.
3. **Port utility functions** (`dateFormatters.ts`, `bodyMeasurements.ts`) directly where they're still correct — these are framework-agnostic.
4. **Match the old theme tokens** to maintain brand continuity, then evolve.
5. **Do not cargo-cult** — if the old app does something questionable (polling loops, broad refetch-on-focus, mixed concerns in hooks), fix it in V2.

---

## Architecture: Hexagonal (Ports & Adapters)

All mobile code follows hexagonal architecture within `packages/mobile/src/`:

```
src/
├── domain/              # Pure business logic, no framework deps
│   ├── models/          # Domain entities & value objects
│   ├── ports/           # Interfaces (driven & driving)
│   └── services/        # Domain services (pure functions)
├── application/         # Use cases / orchestration
│   ├── commands/        # Write operations (mutations)
│   └── queries/         # Read operations
├── adapters/            # Framework implementations of ports
│   ├── api/             # SST API client (driven adapter)
│   ├── storage/         # SQLite offline storage (driven adapter)
│   ├── health/          # HealthKit/Health Connect (driven adapter)
│   ├── notifications/   # Push notification service (driven adapter)
│   └── payments/        # Stripe adapter (driven adapter)
├── ui/                  # React Native presentation layer (driving adapter)
│   ├── components/      # Reusable UI primitives
│   ├── containers/      # Data-fetching + state containers
│   ├── presenters/      # Pure display components (props only)
│   ├── hooks/           # React hooks (connect ports to UI)
│   ├── navigation/      # Expo Router screens (thin wrappers)
│   └── theme/           # Design tokens, colors, typography
└── shared/              # Cross-cutting concerns
    ├── types/           # Shared TypeScript types
    ├── utils/           # Pure utility functions
    └── errors/          # Error types and handling
```

### Key Rules

1. **Domain layer has ZERO framework imports** — no React, no Expo, no React Native
2. **Ports are TypeScript interfaces** — adapters implement them
3. **Containers own logic, presenters are pure** — presenters receive props only, no hooks or side effects
4. **Adapters are swappable** — tests use in-memory adapters, prod uses real ones
5. **Dependencies point inward** — UI → Application → Domain; Adapters → Ports

---

## Container / Presenter Pattern

Every screen follows this split:

```typescript
// containers/WorkoutListContainer.tsx
export function WorkoutListContainer() {
  const { data, isLoading, error } = useWorkouts();
  const { mutate: deleteWorkout } = useDeleteWorkout();

  return (
    <WorkoutListPresenter
      workouts={data ?? []}
      isLoading={isLoading}
      error={error}
      onDelete={deleteWorkout}
    />
  );
}

// presenters/WorkoutListPresenter.tsx
type Props = {
  workouts: Workout[];
  isLoading: boolean;
  error: Error | null;
  onDelete: (id: string) => void;
};

export function WorkoutListPresenter({ workouts, isLoading, error, onDelete }: Props) {
  // Pure rendering — no hooks, no side effects
}
```

### Rules

- **Container**: uses hooks, manages state, calls mutations, handles navigation
- **Presenter**: receives ALL data via props, stateless, easily testable
- **Screen (navigation)**: thin wrapper that renders the container
- Presenters MUST be testable without mocking hooks

---

## Quality Gates (Non-Negotiable)

Every PR must pass:

```bash
bun run prettier:check   # Format check
bun run typecheck         # TypeScript strict mode
bun run lint              # ESLint
bun run build             # All packages build
bun run test:unit         # 90% coverage threshold
```

### Testing Requirements

- **Unit tests**: All domain services, application use cases, utility functions
- **Component tests**: All presenters (React Testing Library)
- **Integration tests**: Container → adapter → mock API flow
- **Coverage**: 90% lines, functions, branches, statements
- **No fake tests**: Every test must assert meaningful behavior
- **Test file location**: Co-located `__tests__/` folders or `.test.ts` suffix

### Test Patterns

```typescript
// Domain service test (pure, no mocking)
describe('WorkoutService', () => {
  it('calculates total volume', () => {
    const sets = [{ reps: 10, weight: 100 }, { reps: 8, weight: 100 }];
    expect(calculateVolume(sets)).toBe(1800);
  });
});

// Presenter test (render with props)
describe('WorkoutListPresenter', () => {
  it('renders workout names', () => {
    render(<WorkoutListPresenter workouts={mockWorkouts} ... />);
    expect(screen.getByText('Push Day')).toBeTruthy();
  });
});

// Container integration test (with adapter)
describe('WorkoutListContainer', () => {
  it('fetches and displays workouts', async () => {
    const adapter = new InMemoryWorkoutAdapter(mockWorkouts);
    render(
      <AdapterProvider workouts={adapter}>
        <WorkoutListContainer />
      </AdapterProvider>
    );
    await waitFor(() => expect(screen.getByText('Push Day')).toBeTruthy());
  });
});
```

---

## Offline-First Architecture

The app is offline-first. All writes go through the sync queue:

1. **User action** → mutation saved to local SQLite
2. **Sync engine** picks up pending mutations when online
3. **Conflict resolution**: server wins (last-write-wins for v1)
4. **UI reads from local cache** with background refresh

### Rules

- Never block UI on network requests
- Show sync status indicators (synced / syncing / offline)
- Queue mutations with retry + exponential backoff
- Cached data must be available immediately on app launch

---

## UI/UX Design Quality

Persistence must be a **sexy, clean, modern gym application** that users love to open. Performance alone is not enough — visual design quality is a first-class requirement.

### Design Principles

1. **Premium feel** — dark-first palette, smooth transitions, micro-interactions on key actions (completing sets, hitting PRs, finishing workouts)
2. **Clarity over density** — generous spacing, clear hierarchy, no cramped screens
3. **Instant feedback** — every tap produces immediate visual feedback (haptics where supported)
4. **Gym-floor usable** — large touch targets (min 44pt), high contrast, glanceable data during active sessions
5. **Progressive disclosure** — simple by default, power features accessible via gestures or secondary UI

### Component Library

Use **Tamagui** as the component library foundation:

- **Why**: Optimizing compiler that flattens component trees at build time, minimal runtime overhead, universal web/mobile support, Expo-compatible
- **Alternatives evaluated**: gluestack UI (good but heavier runtime), NativeWind (Tailwind familiarity but compile-time config complexity), React Native Paper (Material Design — wrong aesthetic for a fitness app)
- **Usage**: Use Tamagui primitives (`Stack`, `Text`, `Button`, `Input`, `Sheet`, etc.) wrapped in our own design-system components that add Persistence branding, tokens, and variants
- **Theme tokens**: Define in Tamagui's token system, which compiles away at build time for zero-cost theming

If Tamagui proves too complex for the Expo 53 preview environment, fall back to **gluestack UI** which has a similar API surface.

### Design Tooling

- Use the `/frontend-design` skill when building any screen or component to ensure high design quality
- Run the app locally and take screenshots at each milestone to review visual quality
- Use Expo's built-in preview tools or the Claude Preview MCP for visual analysis
- Reference the old app's theme tokens (`persistence-mobile/constants/colors.ts`, `constants/theme.ts`) as a baseline, then evolve

### Performance + Aesthetics Checklist

For every screen, verify:

- [ ] 60fps scroll/animation (no jank on `FlatList` or `ScrollView`)
- [ ] Skeleton loaders for async content (not spinners — skeletons feel faster)
- [ ] Optimistic UI updates for mutations (don't wait for server)
- [ ] Image lazy loading with blur-up placeholders where applicable
- [ ] Consistent enter/exit transitions between screens
- [ ] Dark mode looks intentional (not just inverted light mode)

---

## Code Style

- **TypeScript strict mode** — no `any`, no `as` casts without justification
- **Functional components** — no class components
- **Named exports** — no default exports (except Expo Router screens)
- **Barrel exports** — `index.ts` per module for clean imports
- **Error handling** — Result types for domain, try/catch at adapter boundary
- **No magic strings** — use enums or const objects
- **Date handling** — `date-fns` for all date operations

---

## Dependency Injection

Adapters are injected via React Context at the app root:

```typescript
// App root
<AdapterProvider
  api={new SSTApiAdapter(config)}
  storage={new SQLiteStorageAdapter(db)}
  health={new HealthKitAdapter()}
>
  <App />
</AdapterProvider>
```

Tests swap in mock/in-memory adapters:

```typescript
<AdapterProvider
  api={new InMemoryApiAdapter()}
  storage={new InMemoryStorageAdapter()}
  health={new MockHealthAdapter()}
>
  <ComponentUnderTest />
</AdapterProvider>
```

---

## File Naming Conventions

- Components: `PascalCase.tsx` (e.g., `WorkoutCard.tsx`)
- Hooks: `camelCase.ts` with `use` prefix (e.g., `useWorkouts.ts`)
- Services: `camelCase.ts` (e.g., `workoutService.ts`)
- Types: `camelCase.types.ts` (e.g., `workout.types.ts`)
- Tests: `*.test.ts` or `*.test.tsx`
- Constants: `SCREAMING_SNAKE_CASE` for values, `camelCase.ts` for files

---

## Feature Implementation Checklist

For every feature, the implementing agent must:

1. [ ] Read the feature's `requirements.md` fully
2. [ ] Follow the `design.md` architecture
3. [ ] Complete ALL items in `tasks.md` (mark as done)
4. [ ] Domain layer: pure functions, no framework deps
5. [ ] Ports: interfaces defined before adapters
6. [ ] Adapters: implement ports, handle errors at boundary
7. [ ] Containers: use hooks, manage state
8. [ ] Presenters: pure props, no side effects
9. [ ] Tests: unit + component + integration, 90% coverage
10. [ ] All quality gates pass (prettier, typecheck, lint, build, test)
