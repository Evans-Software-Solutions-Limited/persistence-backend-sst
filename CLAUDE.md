# CLAUDE.md – Persistence Backend SST

## Current execution model (as of 2026-04-19)

Work ships via milestone-driven parallel agents. Specs are the source of truth; briefs drive PRs.

- **Feature specs** live at `specs/NN-<feature>/` (requirements + design + tasks) and are authoritative.
- **Milestone briefs** live at `specs/milestones/M<N>-<name>/` and scope a shippable cross-feature slice. Each milestone produces `BRIEF.md`, `BACKEND_BRIEF.md`, `FRONTEND_BRIEF.md`, and `SMOKE_TEST.md`.
- **Agents always work from a brief**, never from a raw `tasks.md`. Backend + frontend agents run in parallel against their respective briefs and land two PRs on a shared milestone branch, gated on an e2e smoke test.
- **Current milestone: M0 — Integration baseline** (briefs pending). M0 closes Exercise Library wire-format drift, adds backend `POST/PATCH/DELETE /exercises`, and shifts mobile filters onto API-sourced reference data.

See [`specs/milestones/ROADMAP.md`](./specs/milestones/ROADMAP.md) for the full M0 → M11 list, and [`specs/_agent.md`](./specs/_agent.md) for the execution-model details.

## What This Repo Is

Gym/fitness tracking backend. User workout logging, session management, exercise tracking, goal setting, and progress analytics. Originally built with Supabase RLS; now migrating to SST v3 with explicit backend authorization.

Supports multiple user roles: regular users, personal trainers, physiotherapists, admins. Cross-user visibility controlled explicitly (workouts are private/friends/public).

## Architecture

- **Frontend:** React app (packages/web)
- **Backend:** Elysia routes with auth middleware (microservices/core)
- **Database:** Neon (serverless Postgres) + Drizzle ORM (packages/db)
- **Infra:** SST v3, Lambda-based
- **Auth:** Supabase JWT validation in middleware, then explicit role/ownership checks

Core data model:

- Users (with roles: user, PT, physio, admin)
- Workouts (name, exercises, visibility)
- Sessions (workout instances, with sets/reps)
- Exercises (exercise library, muscle groups, equipment)
- Records, goals, measurements, progress
- Relationships (friendships, PT assignments)

## Key Directories

| Path                                               | Purpose                                |
| -------------------------------------------------- | -------------------------------------- |
| `microservices/core/src/application/`              | Business logic, repositories, services |
| `microservices/core/src/application/sessions/`     | Session CRUD, set/exercise tracking    |
| `microservices/core/src/application/workouts/`     | Workout CRUD, sharing/visibility       |
| `microservices/core/src/application/exercises/`    | Exercise library, metadata             |
| `microservices/core/src/application/goals/`        | Goal CRUD, progress tracking           |
| `microservices/core/src/application/repositories/` | Data access layer, services            |
| `packages/db/src/schema.ts`                        | Drizzle table definitions, enums       |
| `packages/db/migrations/`                          | SQL migrations (Neon)                  |
| `infra/`                                           | SST resources (API, DB, storage)       |

## Standards

### Code Quality

- **Typecheck:** `bun run typecheck`
- **Lint:** `bun run lint`
- **Format:** `bun run prettier:check` / `--write`
- **Build:** `bun run build`
- **Tests:** `bun run test:unit` (Vitest)

### Testing Rules

- **Coverage threshold:** 90% (lines, functions, branches, statements) — non-negotiable
- **No fake tests.** Tests must prove behaviour.
- **Coverage includes:** `src/application/**/*.ts` and `src/**/repositories/*.ts`
- **Excluded:** Handler files (thin, tested via service/repo tests), api/index files, type defs

### Elysia Route Pattern

- Routes are thin: parse input, call service/repository
- Auth: Supabase JWT → `requireAuth` middleware → `getUser(ctx)` for userId
- Service layer: `SessionService`, etc., decorates context with repository
- Repository: `SessionRepository.create(userId, {...})`, `SessionRepository.get(userId, id)` for ownership check
- Type guards: `t.Object({...})` for request validation

### Authorization Pattern

- **Ownership check:** Every query filters by `userId` from JWT token
- **Role check:** If PT-only route, verify user role after auth
- **Visibility check:** For shared items (workouts, goals), check visibility + user is owner/friend/public

### Frontend

- Container/Presenter: containers own logic, presenters are pure
- Global state: auth context, user profile
- API calls: through api service layer
- Tests: rendering, interactions, API mocking

### Database & Migrations

- Neon serverless Postgres, HTTP transport (Lambda-friendly)
- Drizzle ORM with schema.ts as source of truth
- Migrations in SQL (Neon format), must be idempotent
- No raw SQL; use Drizzle query builder

## Commands Before Claiming Done

```bash
bun run prettier:check  # format check
bun run typecheck       # TypeScript
bun run lint           # ESLint
bun run build          # build all packages
bun run test:unit      # Vitest (90% coverage required)
```

## Dangerous Areas

### User Data Isolation

- **Files:** All `src/application/*/repositories/*.ts`, all handlers
- **Risk:** User A seeing User B's workouts, sessions, goals
- **Rules:**
  - Every repository method takes `userId` as first parameter
  - Every DB query filters by `userId` or ownership check
  - No global queries (e.g., "get all sessions") — must scope to user
  - PT/trainer: can only see their assigned users' data
  - Test: create two users, verify each only sees own data

### Role-Based Access Control

- **Files:** Handlers that check `user.role` (PT, physio, admin routes)
- **Risk:** User spoofs role claim in JWT
- **Rules:**
  - Never trust role from request body; use only from validated JWT
  - Verify Supabase JWT signature (handled by `getAuthUser()`)
  - PT routes: check `role === "personal_trainer"` after auth
  - Admin routes: check `role === "admin"`
  - Test unauthorized access (wrong role, should 403)

### Visibility & Sharing

- **Files:** Workout, goal, session handlers where `visibility` is set
- **Risk:** Private workout marked public, or wrong users seeing it
- **Rules:**
  - Visibility enum: `private`, `friends`, `public`
  - Private workouts: only owner can view/edit
  - Friends visibility: only owner + friends can view
  - Public: anyone can view (but only owner can edit)
  - When fetching: apply visibility filter before returning
  - Test: create private workout, verify friend can't see it without sharing

### Neon/Serverless DB Patterns

- **Files:** `packages/db/src/client.ts`, migration scripts
- **Risk:** Cold-start latency, connection pooling assumptions, transaction issues
- **Rules:**
  - Neon HTTP transport: stateless, no persistent pool (good for Lambda)
  - Avoid long-lived transactions (timeout risk)
  - Idempotent migrations: can be run multiple times safely
  - Test migrations: apply forward and backward without data loss
  - Connection: singleton pattern in `getDb()` (one per cold start)

## Current Priorities

1. **Data isolation verification** — audit all repo methods to ensure userId filtering
2. **PT/trainer relationship logic** — access control when PT views assigned user's data
3. **Workout visibility enforcement** — friends/public visibility correctly applied
4. **Migration from Supabase RLS** — ensure explicit authorization replaces RLS
5. **Neon cold-start optimization** — minimize latency on first query

## PR Checklist

- [ ] All checks pass (prettier, typecheck, lint, build, test)
- [ ] Coverage ≥ 90% on changed files
- [ ] No fake tests
- [ ] If touching user data queries: verify userId filtering on all DB calls
- [ ] If adding role-based route: test unauthorized access (wrong role → 403)
- [ ] If modifying visibility: test private/friends/public filters work
- [ ] If adding migrations: test forward and backward, idempotency
- [ ] Conventional commit (feat/, fix/, chore/)
