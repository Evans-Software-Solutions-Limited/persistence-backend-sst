# Skill: Elysia Route Change

Use this when creating, modifying, or removing Elysia route handlers.

## Before You Start

1. Read the root CLAUDE.md → "Authorization Pattern" and "Elysia Route Pattern"
2. Read `microservices/core/src/application/sessions/CLAUDE.md` for session-handling patterns
3. Understand: is this a new domain (e.g., goals) or extending existing (e.g., sessions)?
4. Decide: does this need auth? Does it need ownership/role checks?

## Route Structure

```ts
import Elysia, { t } from "elysia";
import { getAuthUser, requireAuth, getUser } from "@persistence/api-utils/auth/supabaseAuth";
import { MyService } from "../repositories/myService";

export const myHandler = new Elysia()
  .derive(async ({ headers }) => ({
    user: await getAuthUser(headers.authorization),
  }))
  .onBeforeHandle(requireAuth)  // Optional: only if auth required
  .use(MyService)  // Decorate with repository service
  .get(
    "/items/:id",
    async (ctx) => {
      const { sub: userId } = getUser(ctx);  // Extract from JWT
      const { id } = ctx.params;

      const item = await ctx.MyRepository.get(userId, id);
      if (!item) return ctx.error(404, "Item not found");

      return { data: item };
    },
    {
      params: t.Object({ id: t.String() }),
      detail: { description: "Get item", tags: ["Items"] },
    },
  );
```

## Checklist

- [ ] New handler in `src/application/{domain}/{action}/{domain}{Action}Handler.ts`
- [ ] Auth required? Use `requireAuth` guard, extract `userId` from `getUser(ctx)`
- [ ] Public route? Omit `requireAuth`, but document why
- [ ] Role-based? Check `user.role` after getting user
- [ ] Ownership check? Pass `userId` to repository method
- [ ] Type guards: `t.Object({...})` for params, body, query
- [ ] Error responses: 400/401/403/404/500 with messages
- [ ] Service injection: `use(MyService)` to access `ctx.MyRepository`
- [ ] Mounted in `src/api.ts`: `.use(myHandler)`
- [ ] Tests: auth required, ownership check, validation errors
- [ ] Coverage ≥ 90% on service/repository logic

## Common Patterns

### GET with Ownership Check
```ts
.get("/items/:id", async (ctx) => {
  const { sub: userId } = getUser(ctx);
  const item = await ctx.ItemRepository.get(userId, ctx.params.id);
  if (!item) return ctx.error(404, "Not found");
  return { data: item };
})
```

### POST with Input Validation
```ts
.post("/items", async (ctx) => {
  const { sub: userId } = getUser(ctx);
  const item = await ctx.ItemRepository.create(userId, ctx.body);
  ctx.set.status = 201;
  return { data: item };
}, {
  body: t.Object({
    name: t.String(),
    description: t.Optional(t.String()),
  }),
})
```

### List with Filters
```ts
.get("/items", async (ctx) => {
  const { sub: userId } = getUser(ctx);
  const { status, limit } = ctx.query;
  const items = await ctx.ItemRepository.list(userId, { status, limit });
  return { data: items };
})
```

### Role-Based Route
```ts
.post("/admin/config", async (ctx) => {
  const user = getUser(ctx);
  if (user.role !== "admin") return ctx.error(403, "Admin only");
  // ... admin logic
})
```

## After You're Done

1. `bun run typecheck` — no TS errors
2. `bun run test:unit` — handler + repo tests pass
3. Verify mounted in `src/api.ts`
4. Check coverage ≥ 90% on repository logic
5. Test auth required (missing token → 401)
6. Test ownership check (wrong user → 404)
7. If new domain, consider adding local CLAUDE.md for the module
