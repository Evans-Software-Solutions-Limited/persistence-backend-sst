# 00 — Guardrails: Tasks

## Current state (2026-04-19)

**Shipped: 39 of 40 tasks complete.** This spec is essentially done — guardrails underpin everything else.

Built and verified:

- TypeScript strict mode, path aliases (`@/*` → `src/*`), `bun run typecheck` passes
- ESLint flat config with `no-restricted-imports` for domain purity
- Prettier configured and passing
- Jest + `jest-expo` preset (config lives in `package.json`, not standalone `jest.config.ts`)
- Hexagonal skeleton at `packages/mobile/src/{domain,application,adapters,ui,shared}/` with barrel exports
- All five driven ports: `ApiPort`, `StoragePort`, `AuthPort`, `HealthPort`, `NotificationsPort`, `PaymentsPort`
- `Result<T, E>` + `AppError` helpers in `src/shared/errors/`
- `AdapterProvider` / `useAdapters` DI wiring
- `InMemoryApiAdapter`, `InMemoryStorageAdapter`, `InMemoryAuthAdapter` for tests
- `ErrorBoundary` component (uses inline fallback UI; no separate `ErrorFallback` presenter)
- CI pipeline: `pr-checks.yml` runs typecheck, lint, build, test:unit on mobile

Known gaps:

- Separate `ErrorFallback` presenter (Phase 5) never extracted — the inline fallback in `ErrorBoundary` covers the use case, so this is unlikely to be prioritised.

## Phase 1: TypeScript & Tooling

- [x] Update `packages/mobile/tsconfig.json` with strict mode, path aliases (`@/*` → `src/*`)
- [x] Verify `bun run typecheck` passes for mobile package
- [x] Configure ESLint flat config (`eslint.config.js`) with typescript-eslint, expo rules
- [x] Add `no-restricted-imports` rule for domain layer purity
- [x] Verify `bun run lint` passes for mobile package
- [x] Ensure `.prettierignore` covers mobile build artifacts (`.expo`, `android`, `ios`)
- [x] Verify `bun run prettier:check` passes for mobile package

## Phase 2: Testing Infrastructure

- [x] Create `jest.config.ts` with jest-expo preset, coverage thresholds (90%), path aliases
  - _Note: config lives in `package.json` rather than standalone `jest.config.ts`_
- [x] Create `__tests__/setup.ts` with React Testing Library config, global mocks
- [x] Add `@testing-library/react-native` and `@testing-library/jest-native` to devDependencies
- [x] Create sample domain service test to verify test pipeline works
- [x] Create sample presenter test to verify component testing works
- [x] Verify `bun run test:unit` runs and reports coverage for mobile package

## Phase 3: Hexagonal Architecture Scaffolding

- [x] Create directory structure per design.md
- [x] Create barrel `index.ts` exports in each directory
- [x] Define `ApiPort` interface (`src/domain/ports/api.port.ts`) with initial methods
- [x] Define `StoragePort` interface (`src/domain/ports/storage.port.ts`) with initial methods
- [x] Define `HealthPort` interface stub (`src/domain/ports/health.port.ts`)
- [x] Define `NotificationsPort` interface stub (`src/domain/ports/notifications.port.ts`)
- [x] Define `PaymentsPort` interface stub (`src/domain/ports/payments.port.ts`)
- [x] Create `Result<T, E>` type with `ok()` and `fail()` helpers (`src/shared/errors/result.ts`)
- [x] Create `AppError` base type and domain-specific error types (`src/shared/errors/`)

## Phase 4: Dependency Injection

- [x] Create `Adapters` type aggregating all ports (`src/shared/types/adapters.ts`)
- [x] Create `AdapterProvider` context and `useAdapter()` hook (`src/ui/hooks/useAdapter.ts`)
  - _Note: named `useAdapters` (plural) in implementation_
- [x] Create `InMemoryApiAdapter` for tests (`src/adapters/api/__tests__/in-memory-api.adapter.ts`)
- [x] Create `InMemoryStorageAdapter` for tests (`src/adapters/storage/__tests__/in-memory-storage.adapter.ts`)
- [x] Create `TestAdapterProvider` helper for wrapping components in tests
- [x] Write tests for `useAdapter()` hook (throws outside provider, returns adapters inside)

## Phase 5: Error Handling

- [x] Create `ErrorBoundary` component (`src/ui/components/ErrorBoundary.tsx`)
- [ ] Create `ErrorFallback` presenter for error display (`src/ui/presenters/ErrorFallback.tsx`)
  - _ErrorBoundary has inline fallback UI; no separate ErrorFallback presenter exists_
- [x] Wire `ErrorBoundary` into app root layout (`app/_layout.tsx`)
- [x] Write tests for `ErrorBoundary` (catches errors, renders fallback)

## Phase 6: Migrate Existing Foundation Code

- [x] Move `src/api/client.ts` → `src/adapters/api/sst-api.adapter.ts` (implement `ApiPort`)
- [x] Move `src/api/types.ts` → `src/domain/models/` (split into entity-specific files)
- [x] Move `src/offline/database.ts` → `src/adapters/storage/sqlite.adapter.ts` (implement `StoragePort`)
- [x] Move `src/offline/sync-queue.ts` → `src/adapters/storage/sync-queue.ts`
- [x] Move `src/offline/sync-engine.ts` → `src/application/commands/sync.command.ts`
- [x] Move `src/offline/hooks.ts` → `src/ui/hooks/useSync.ts`
- [x] Update all import paths in `app/` routes
- [x] Verify app still runs after migration (`bun run start` from mobile package)

## Phase 7: CI Integration

- [x] Verify turbo pipeline includes mobile in `typecheck`, `lint`, `test:unit` tasks
- [x] Verify `pr-checks.yml` workflow covers mobile package
- [x] Run full quality gate suite and fix any failures:
  - [x] `bun run prettier:check`
  - [x] `bun run typecheck`
  - [x] `bun run lint`
  - [x] `bun run build`
  - [x] `bun run test:unit`
