# Persistence Mobile — Agent Instructions

## Purpose

This file guides AI agents working on the Persistence mobile app. It defines architectural constraints, quality gates, and patterns that **must** be followed for every feature implementation.

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
