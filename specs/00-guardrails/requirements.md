# 00 — Guardrails: Requirements

## Overview

Establish the quality gates, architecture scaffolding, and developer tooling that every subsequent feature depends on. No feature code is written until these pass.

---

## User Stories

### STORY-001: As a developer, I want TypeScript strict mode enforced so that type errors are caught at compile time

**Acceptance Criteria:**

- [ ] `tsconfig.json` in `packages/mobile` has `strict: true`
- [ ] `noImplicitAny`, `strictNullChecks`, `strictFunctionTypes` all enabled
- [ ] Path aliases configured (`@/*` maps to `src/*`)
- [ ] `bun run typecheck` passes with zero errors

### STORY-002: As a developer, I want ESLint configured so that code quality issues are flagged automatically

**Acceptance Criteria:**

- [ ] ESLint flat config (`eslint.config.js`) with `typescript-eslint` plugin
- [ ] Rules: no unused vars (error), no explicit `any` (warn), consistent return types
- [ ] Expo-specific lint rules included
- [ ] `bun run lint` passes with zero errors from `packages/mobile`

### STORY-003: As a developer, I want Prettier enforced so that formatting is consistent

**Acceptance Criteria:**

- [ ] Prettier config consistent with root repo (inherits from root `.prettierrc` or uses defaults)
- [ ] `.prettierignore` includes `node_modules`, `dist`, `build`, `.expo`, `android`, `ios`
- [ ] `bun run prettier:check` passes for `packages/mobile`

### STORY-004: As a developer, I want Jest configured with 90% coverage thresholds so that test quality is enforced

**Acceptance Criteria:**

- [ ] Jest config with `jest-expo` preset
- [ ] Coverage thresholds: 90% lines, functions, branches, statements
- [ ] Coverage includes: `src/domain/**`, `src/application/**`, `src/adapters/**`, `src/ui/containers/**`, `src/ui/presenters/**`
- [ ] Coverage excludes: `src/ui/navigation/**`, `*.types.ts`, `index.ts` barrel files
- [ ] `bun run test:unit` runs and reports coverage
- [ ] React Testing Library configured for component tests

### STORY-005: As a developer, I want the hexagonal architecture folder structure scaffolded so that I know where code goes

**Acceptance Criteria:**

- [ ] Directory structure matches `_agent.md` specification
- [ ] Each directory has an `index.ts` barrel export
- [ ] Domain layer has no React/RN/Expo imports (enforced by ESLint rule or convention)
- [ ] Port interfaces created for: API, Storage, Health, Notifications, Payments

### STORY-006: As a developer, I want dependency injection via React Context so that adapters are swappable in tests

**Acceptance Criteria:**

- [ ] `AdapterProvider` context created with typed adapter slots
- [ ] `useAdapter()` hook for accessing adapters in containers
- [ ] `TestAdapterProvider` with in-memory implementations for tests
- [ ] App root wraps everything in `AdapterProvider`

### STORY-007: As a developer, I want an error boundary and global error handling so that the app doesn't crash silently

**Acceptance Criteria:**

- [ ] React error boundary component at app root
- [ ] Domain errors use typed Result pattern (`Success<T> | Failure<E>`)
- [ ] Adapter errors caught at boundary and converted to domain errors
- [ ] User-facing error display component (generic fallback)

### STORY-008: As a developer, I want CI to validate mobile package quality on every PR

**Acceptance Criteria:**

- [ ] Existing `pr-checks.yml` runs typecheck, lint, prettier, test for `packages/mobile`
- [ ] Turbo tasks include mobile package in pipeline
- [ ] Build step passes (even if EAS build is deferred)
