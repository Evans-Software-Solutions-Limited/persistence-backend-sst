# CLAUDE.md – Persistence Backend SST

**Canonical state ledger: [`./STATE.md`](./STATE.md) — read at session
start, update before ending any session.** Milestone status, open
failures, and parked tasks live there, not here.

## Current execution model

Work ships via milestone-driven parallel agents. Specs are the source of truth; briefs drive PRs.

- **Feature specs** live at `specs/NN-<feature>/` (requirements + design + tasks) and are authoritative.
- **Milestone briefs** live at `specs/milestones/M<N>-<name>/` and scope a shippable cross-feature slice. Each milestone produces `BRIEF.md`, `BACKEND_BRIEF.md`, `FRONTEND_BRIEF.md`, and `SMOKE_TEST.md`.
- **Agents always work from a brief**, never from a raw `tasks.md`. Backend + frontend agents run in parallel against their respective briefs and land two PRs on a shared milestone branch, gated on an e2e smoke test.
- **The authoritative status ledger is [`./STATE.md`](./STATE.md).** `specs/milestones/ROADMAP.md` (§ Phase status) was refreshed 2026-07-05 but can lag merged PRs — cross-check `STATE.md` + `git log --oneline -30` before assuming any milestone is "pending".

See [`specs/milestones/ROADMAP.md`](./specs/milestones/ROADMAP.md) for the M0 → M11 layout, and [`specs/_agent.md`](./specs/_agent.md) for the execution-model details.

## Migration intent (Mobile V2 — non-negotiable)

The mobile V2 build (`packages/mobile`) is a **port** of the legacy mobile app at `/Users/bradleysimms-evans/Documents/projects/personal/persistence-mobile/`. It is **not** a redesign. The whole point of this migration is **under-the-hood efficiency**:

- Offline-first SQLite cache (replacing direct Supabase calls)
- SST v3 backend with explicit authorization (replacing Supabase RLS)
- Performance work — FlashList, expo-image, animation budgets (M11)

**The UI MUST match legacy exactly.** Same layouts, same component hierarchy, same affordances, same copy, same flows. The only deliberate change at port time is the V2 container/presenter seam — containers absorb the V2 data-flow deltas (ports, adapters, hooks, segment-aware navigation); presenter render output mirrors legacy 1:1.

**No UI deviation from legacy is allowed without explicit user go-ahead.** If a brief, spec, or PR description says "port" without specifying legacy fidelity, assume strict fidelity and confirm before deviating. If you find yourself "improving" a screen — stop. The migration is not the place to improve the UX. `/frontend-design` polish happens only AFTER the port lands and is verified on device.

**When in doubt, read the legacy.** It's at the sibling path `../persistence-mobile/` — `app/`, `components/`, `hooks/api/`, `lib/utils/`, `lib/supabase/queries/`. Cross-reference legacy before authoring a brief, before writing code, before reviewing a PR. If you cannot find the legacy reference, flag it and ask — don't invent.

See `feedback_port_then_revamp.md` in memory for the full discipline rules (which axes to audit, common failure modes, how to handle briefs that contradict legacy).

## Session continuity — read this first on a fresh session

Brad runs many sessions across this repo and occasionally switches Claude accounts. Most context survives because it lives on disk, not in the Claude account. The few things that DON'T survive:

- **MCP connectors are account-scoped on the Claude side.** Supabase, Stripe, Slack, Notion, Atlassian, Figma, etc. — each one needs the connector re-enabled in the new account's Claude Code settings. If a `mcp__*` tool errors with "connector not connected" or returns a 401, that's the first thing to check. Don't fall through to slower tools — surface the disconnect to Brad so he can re-auth in one go.
- **`STATE.md` (in-repo) is the canonical state ledger** — last shipped milestones, active gotchas, parked tasks, decisions Brad has explicitly baked in. Read it at session start; update it before ending any session. Anything that contradicts STATE.md is wrong by default.
- **CLAUDE.md (this file), `STATE.md`, and `specs/` are in the repo** — survive everything.
- **Skills + ntfy topic + Slack channel ID are filesystem-resident** in `~/.claude/.../skills/slack-progress-updates/` — survive everything. The Slack channel ID `C0ATYL6T11V` for `#brad-claude-agents` is hardcoded.
- **Stripe / Supabase MCP project credentials are project-scoped on the service side**, not Claude-side — they survive the account switch as long as the MCP connector itself is re-enabled.

**Don't pre-empt `@inspector-brad`.** Brad fires it himself on the PR when he wants a sweep. Don't run it speculatively.

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

## PR Checklist

- [ ] All checks pass (prettier, typecheck, lint, build, test)
- [ ] Coverage ≥ 90% on changed files
- [ ] No fake tests
- [ ] If touching user data queries: verify userId filtering on all DB calls
- [ ] If adding role-based route: test unauthorized access (wrong role → 403)
- [ ] If modifying visibility: test private/friends/public filters work
- [ ] If adding migrations: test forward and backward, idempotency
- [ ] Conventional commit (feat/, fix/, chore/)
