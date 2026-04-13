# 00 — Guardrails: Tasks

## Phase 1: TypeScript & Tooling

- [ ] Update `packages/mobile/tsconfig.json` with strict mode, path aliases (`@/*` → `src/*`)
- [ ] Verify `bun run typecheck` passes for mobile package
- [ ] Configure ESLint flat config (`eslint.config.js`) with typescript-eslint, expo rules
- [ ] Add `no-restricted-imports` rule for domain layer purity
- [ ] Verify `bun run lint` passes for mobile package
- [ ] Ensure `.prettierignore` covers mobile build artifacts (`.expo`, `android`, `ios`)
- [ ] Verify `bun run prettier:check` passes for mobile package

## Phase 2: Testing Infrastructure

- [ ] Create `jest.config.ts` with jest-expo preset, coverage thresholds (90%), path aliases
- [ ] Create `__tests__/setup.ts` with React Testing Library config, global mocks
- [ ] Add `@testing-library/react-native` and `@testing-library/jest-native` to devDependencies
- [ ] Create sample domain service test to verify test pipeline works
- [ ] Create sample presenter test to verify component testing works
- [ ] Verify `bun run test:unit` runs and reports coverage for mobile package

## Phase 3: Hexagonal Architecture Scaffolding

- [ ] Create directory structure per design.md
- [ ] Create barrel `index.ts` exports in each directory
- [ ] Define `ApiPort` interface (`src/domain/ports/api.port.ts`) with initial methods
- [ ] Define `StoragePort` interface (`src/domain/ports/storage.port.ts`) with initial methods
- [ ] Define `HealthPort` interface stub (`src/domain/ports/health.port.ts`)
- [ ] Define `NotificationsPort` interface stub (`src/domain/ports/notifications.port.ts`)
- [ ] Define `PaymentsPort` interface stub (`src/domain/ports/payments.port.ts`)
- [ ] Create `Result<T, E>` type with `ok()` and `fail()` helpers (`src/shared/errors/result.ts`)
- [ ] Create `AppError` base type and domain-specific error types (`src/shared/errors/`)

## Phase 4: Dependency Injection

- [ ] Create `Adapters` type aggregating all ports (`src/shared/types/adapters.ts`)
- [ ] Create `AdapterProvider` context and `useAdapter()` hook (`src/ui/hooks/useAdapter.ts`)
- [ ] Create `InMemoryApiAdapter` for tests (`src/adapters/api/__tests__/in-memory-api.adapter.ts`)
- [ ] Create `InMemoryStorageAdapter` for tests (`src/adapters/storage/__tests__/in-memory-storage.adapter.ts`)
- [ ] Create `TestAdapterProvider` helper for wrapping components in tests
- [ ] Write tests for `useAdapter()` hook (throws outside provider, returns adapters inside)

## Phase 5: Error Handling

- [ ] Create `ErrorBoundary` component (`src/ui/components/ErrorBoundary.tsx`)
- [ ] Create `ErrorFallback` presenter for error display (`src/ui/presenters/ErrorFallback.tsx`)
- [ ] Wire `ErrorBoundary` into app root layout (`app/_layout.tsx`)
- [ ] Write tests for `ErrorBoundary` (catches errors, renders fallback)

## Phase 6: Migrate Existing Foundation Code

- [ ] Move `src/api/client.ts` → `src/adapters/api/sst-api.adapter.ts` (implement `ApiPort`)
- [ ] Move `src/api/types.ts` → `src/domain/models/` (split into entity-specific files)
- [ ] Move `src/offline/database.ts` → `src/adapters/storage/sqlite.adapter.ts` (implement `StoragePort`)
- [ ] Move `src/offline/sync-queue.ts` → `src/adapters/storage/sync-queue.ts`
- [ ] Move `src/offline/sync-engine.ts` → `src/application/commands/sync.command.ts`
- [ ] Move `src/offline/hooks.ts` → `src/ui/hooks/useSync.ts`
- [ ] Update all import paths in `app/` routes
- [ ] Verify app still runs after migration (`bun run start` from mobile package)

## Phase 7: CI Integration

- [ ] Verify turbo pipeline includes mobile in `typecheck`, `lint`, `test:unit` tasks
- [ ] Verify `pr-checks.yml` workflow covers mobile package
- [ ] Run full quality gate suite and fix any failures:
  - [ ] `bun run prettier:check`
  - [ ] `bun run typecheck`
  - [ ] `bun run lint`
  - [ ] `bun run build`
  - [ ] `bun run test:unit`
