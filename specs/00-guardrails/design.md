# 00 — Guardrails: Technical Design

## Architecture Overview

This milestone scaffolds the hexagonal architecture and quality tooling for `packages/mobile`.

### Directory Structure

```
packages/mobile/
├── src/
│   ├── domain/
│   │   ├── models/              # Domain entities (Workout, Exercise, Session, etc.)
│   │   │   └── index.ts
│   │   ├── ports/               # Interface definitions
│   │   │   ├── api.port.ts      # Remote API operations
│   │   │   ├── storage.port.ts  # Local persistence operations
│   │   │   ├── health.port.ts   # Health data provider
│   │   │   ├── notifications.port.ts
│   │   │   ├── payments.port.ts
│   │   │   └── index.ts
│   │   ├── services/            # Pure business logic functions
│   │   │   └── index.ts
│   │   └── index.ts
│   ├── application/
│   │   ├── commands/            # Write use cases
│   │   │   └── index.ts
│   │   ├── queries/             # Read use cases
│   │   │   └── index.ts
│   │   └── index.ts
│   ├── adapters/
│   │   ├── api/                 # SST API client (existing, to be refactored)
│   │   │   └── index.ts
│   │   ├── storage/             # SQLite offline (existing, to be refactored)
│   │   │   └── index.ts
│   │   ├── health/              # HealthKit / Health Connect (future)
│   │   │   └── index.ts
│   │   ├── notifications/       # Push notifications (future)
│   │   │   └── index.ts
│   │   ├── payments/            # Stripe (future)
│   │   │   └── index.ts
│   │   └── index.ts
│   ├── ui/
│   │   ├── components/          # Reusable UI primitives
│   │   │   └── index.ts
│   │   ├── containers/          # Data-fetching wrappers
│   │   │   └── index.ts
│   │   ├── presenters/          # Pure display components
│   │   │   └── index.ts
│   │   ├── hooks/               # Custom React hooks
│   │   │   └── index.ts
│   │   ├── navigation/          # Expo Router screens (thin)
│   │   │   └── index.ts
│   │   ├── theme/               # Design tokens
│   │   │   └── index.ts
│   │   └── index.ts
│   └── shared/
│       ├── types/               # Shared TypeScript types
│       │   └── index.ts
│       ├── utils/               # Pure utilities
│       │   └── index.ts
│       ├── errors/              # Error types
│       │   ├── result.ts        # Result<T, E> type
│       │   └── index.ts
│       └── index.ts
├── app/                          # Expo Router file-based routes (existing)
├── __tests__/                    # Test utilities, setup
│   └── setup.ts
└── jest.config.ts
```

### Dependency Injection Design

```typescript
// src/domain/ports/api.port.ts
export interface ApiPort {
  getProfile(): Promise<Result<UserProfile, ApiError>>;
  getWorkouts(): Promise<Result<Workout[], ApiError>>;
  createWorkout(data: CreateWorkoutInput): Promise<Result<Workout, ApiError>>;
  // ... expanded per feature
}

// src/domain/ports/storage.port.ts
export interface StoragePort {
  getWorkouts(): Promise<Workout[]>;
  saveWorkout(workout: Workout): Promise<void>;
  queueMutation(mutation: PendingMutation): Promise<void>;
  getPendingMutations(): Promise<PendingMutation[]>;
  // ... expanded per feature
}

// src/shared/types/adapters.ts
export interface Adapters {
  api: ApiPort;
  storage: StoragePort;
  health: HealthPort;
  notifications: NotificationsPort;
  payments: PaymentsPort;
}

// src/ui/hooks/useAdapter.ts
const AdapterContext = createContext<Adapters | null>(null);

export function AdapterProvider({ children, ...adapters }: PropsWithChildren<Adapters>) {
  return <AdapterContext.Provider value={adapters}>{children}</AdapterContext.Provider>;
}

export function useAdapter(): Adapters {
  const ctx = useContext(AdapterContext);
  if (!ctx) throw new Error('useAdapter must be used within AdapterProvider');
  return ctx;
}
```

### Result Type

```typescript
// src/shared/errors/result.ts
type Success<T> = { ok: true; value: T };
type Failure<E> = { ok: false; error: E };
export type Result<T, E = Error> = Success<T> | Failure<E>;

export const ok = <T>(value: T): Success<T> => ({ ok: true, value });
export const fail = <E>(error: E): Failure<E> => ({ ok: false, error });
```

### Error Boundary

```typescript
// src/ui/components/ErrorBoundary.tsx
// Class component (only valid use case) wrapping app root
// Catches render errors, displays fallback UI
// Logs errors to console (and future analytics adapter)
```

### ESLint Custom Rule (Convention)

Domain layer purity enforced via:

- ESLint `no-restricted-imports` rule on `src/domain/**`:
  - Disallow `react`, `react-native`, `expo-*`, `@react-navigation/*`
- This ensures domain stays framework-agnostic

### Jest Configuration

```typescript
// jest.config.ts
export default {
  preset: "jest-expo",
  setupFilesAfterSetup: ["<rootDir>/__tests__/setup.ts"],
  collectCoverageFrom: [
    "src/domain/**/*.ts",
    "src/application/**/*.ts",
    "src/adapters/**/*.ts",
    "src/ui/containers/**/*.{ts,tsx}",
    "src/ui/presenters/**/*.{ts,tsx}",
    "src/ui/hooks/**/*.ts",
    "src/shared/**/*.ts",
    "!**/*.types.ts",
    "!**/index.ts",
    "!**/__tests__/**",
  ],
  coverageThreshold: {
    global: { branches: 90, functions: 90, lines: 90, statements: 90 },
  },
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/src/$1",
  },
};
```

### Migration Plan for Existing Code

The mobile foundation (merged in `feat/mobile-foundation-offline-first`) has:

- `src/api/client.ts` → moves to `src/adapters/api/sst-api.adapter.ts`
- `src/api/types.ts` → moves to `src/domain/models/` (split by entity)
- `src/auth/provider.tsx` → stays as auth adapter
- `src/offline/database.ts` → moves to `src/adapters/storage/sqlite.adapter.ts`
- `src/offline/sync-queue.ts` → moves to `src/adapters/storage/sync-queue.ts`
- `src/offline/sync-engine.ts` → moves to `src/application/commands/sync.command.ts`
- `src/offline/hooks.ts` → moves to `src/ui/hooks/useSync.ts`
- `app/` routes → remain (Expo Router file-based routing)
