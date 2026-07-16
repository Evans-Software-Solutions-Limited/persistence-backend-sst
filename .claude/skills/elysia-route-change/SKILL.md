---
name: elysia-route-change
description: Use when creating, modifying, or removing Elysia route handlers in persistence-backend-sst — Supabase auth guards, service injection, ownership checks, typed schemas, and mounting in src/api.ts.
---

# Skill: Elysia Route Change

Extends the shared elysia-endpoint skill from claude-setup (projects/claude-setup/skills/elysia-endpoint/SKILL.md). This file holds only the persistence-backend-sst-specific deltas.

## Repo Specifics

- Read the root CLAUDE.md → "Authorization Pattern" and "Elysia Route Pattern" before starting.
- Read `microservices/core/src/application/sessions/CLAUDE.md` for session-handling patterns.
- Handler path convention: `src/application/{domain}/{action}/{domain}{Action}Handler.ts`.
- Auth helpers import from `@persistence/api-utils/auth/supabaseAuth`:

```ts
import {
  getAuthUser,
  requireAuth,
  getUser,
} from "@persistence/api-utils/auth/supabaseAuth";
```

- Service injection: decorate with `.use(MyService)` to access `ctx.MyRepository` in handlers.
- Mount new handlers in `src/api.ts` via `.use(myHandler)`.

## Commands

1. `bun run typecheck` — no TS errors
2. `bun run test:unit` — handler + repo tests pass
