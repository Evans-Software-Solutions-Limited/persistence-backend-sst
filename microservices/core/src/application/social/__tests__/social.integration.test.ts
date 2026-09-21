import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { PgDialect, getTableConfig, type PgTable } from "drizzle-orm/pg-core";
import { is, SQL, eq } from "drizzle-orm";
import {
  beforeAll,
  beforeEach,
  afterAll,
  describe,
  it,
  expect,
  vi,
} from "vitest";
import * as schema from "@persistence/db/schema";
const holder = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("@persistence/db", async (original) => ({
  ...(await original<object>()),
  getDb: () => holder.db,
}));
import {
  socialRepository as social,
  areFriends,
  canInteract,
} from "../socialRepository";
import { templatesRepository as templates } from "../../together/templatesRepository";
import { withActors } from "../../together/shared";

vi.mock("@persistence/api-utils/auth/supabaseAuth", async (original) => ({
  ...(await original<object>()),
  getAuthUser: async (header?: string) =>
    header?.startsWith("Bearer ")
      ? {
          sub: header.slice(7).replace("admin:", ""),
          app_metadata: { admin: header.includes("admin:") },
        }
      : null,
}));
import Elysia from "elysia";
import { encodeCursor, decodeCursor } from "../pagination";
import { socialHandler } from "../socialHandler";
import { templatesHandler } from "../../together/templatesHandler";
import { placesHandler } from "../../places/placesHandler";
const app = new Elysia()
  .use(socialHandler)
  .use(templatesHandler)
  .use(placesHandler);
async function http(
  path: string,
  actor: string | null = a,
  method = "GET",
  body?: unknown,
  mutationKey?: string,
) {
  return app.handle(
    new Request(`http://localhost${path}`, {
      method,
      headers: {
        ...(actor ? { authorization: `Bearer ${actor}` } : {}),
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
        ...(mutationKey ? { "idempotency-key": mutationKey } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );
}
let pg: PGlite;
let db: ReturnType<typeof drizzle>;
const a = randomUUID(),
  b = randomUUID(),
  c = randomUUID(),
  exercise = randomUUID();
const key = () => randomUUID();
const dialect = new PgDialect();
const tables = [
  schema.profiles,
  schema.friendships,
  schema.socialProfiles,
  schema.socialBlocks,
  schema.socialReports,
  schema.socialRequestDecisions,
  schema.togetherTemplateShares,
  schema.togetherTemplateCopies,
  schema.togetherActors,
  schema.togetherReceipts,
  schema.togetherRateLimits,
  schema.subscriptionTiers,
  schema.userSubscriptions,
  schema.exercises,
  schema.workouts,
  schema.workoutExercises,
  schema.ptClientRelationships,
  schema.togetherSessions,
  schema.togetherParticipants,
  schema.togetherInvites,
  schema.togetherConnections,
  schema.workoutSessions,
  schema.workoutAssignments,
  schema.programWorkouts,
  schema.programAssignments,
];
function ddl(table: PgTable) {
  const cfg = getTableConfig(table);
  const columns = cfg.columns.map((c) => {
    let type = c.getSQLType();
    if (c.enumValues?.length) type = "text";
    let def = "";
    if (c.default !== undefined) {
      def =
        " default " +
        (is(c.default, SQL)
          ? dialect.sqlToQuery(c.default).sql
          : typeof c.default === "string"
            ? `'${c.default.replaceAll("'", "''")}'`
            : Array.isArray(c.default) && type.endsWith("[]")
              ? "'{}'"
              : typeof c.default === "object"
                ? `'${JSON.stringify(c.default)}'`
                : String(c.default));
    }
    return `"${c.name}" ${type}${c.notNull ? " not null" : ""}${c.primary ? " primary key" : ""}${def}`;
  });
  for (const pk of cfg.primaryKeys)
    columns.push(
      `primary key (${pk.columns.map((c) => `"${c.name}"`).join(",")})`,
    );
  for (const idx of cfg.indexes.filter((i) => i.config.unique)) {
    const cols = idx.config.columns.map((c) =>
      "name" in c ? `"${c.name}"` : "",
    );
    if (cols.every(Boolean)) columns.push(`unique (${cols.join(",")})`);
  }
  return `create table "${cfg.name}" (${columns.join(",")});`;
}
beforeAll(async () => {
  vi.stubEnv("TOGETHER_TOKEN_SECRET", "social-test-secret-32-characters-long");
  pg = await PGlite.create();
  for (const table of tables.filter(
    (t) =>
      !getTableConfig(t).name.startsWith("together_") &&
      !getTableConfig(t).name.startsWith("social_"),
  ))
    await pg.exec(ddl(table));
  await pg.exec(
    "create unique index exercises_client_request_test on exercises(created_by,client_request_id); alter table workout_exercises add constraint test_exercise_fk foreign key(exercise_id) references exercises(id) on delete cascade;",
  );
  await pg.exec("create role anon; create role authenticated;");
  await pg.exec(
    await readFile(
      new URL(
        "../../../../../../supabase/migrations/20260921211637_together_backend.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  db = drizzle(pg, { schema });
  holder.db = db;
});
beforeEach(async () => {
  await pg.exec(
    `truncate ${tables.map((t) => `"${getTableConfig(t).name}"`).join(",")} cascade`,
  );
  await db.insert(schema.profiles).values([
    { id: a, fullName: "Alice" },
    { id: b, fullName: "Alicia" },
    { id: c, fullName: "Alison" },
  ]);
  await db.insert(schema.subscriptionTiers).values({
    tierName: "premium",
    displayName: "Pro",
    priceMonthly: "10",
    priceYearly: "100",
  } as typeof schema.subscriptionTiers.$inferInsert);
  await db.insert(schema.userSubscriptions).values(
    [a, b].map((userId) => ({
      userId,
      tierName: "premium",
      paymentStatus: "active" as const,
      startsAt: new Date(0),
    })),
  );
  await db.insert(schema.exercises).values({ id: exercise, name: "Squat" });
});
afterAll(async () => {
  await pg.close();
  vi.unstubAllEnvs();
});
async function friends() {
  await social.profile(b, key(), true);
  const req = await social.request(a, b, key());
  await social.decision(b, req.requestId, key(), "accept");
  return req;
}
const plan = () => ({
  name: "Independent",
  exercises: [
    {
      planExerciseId: key(),
      exerciseId: exercise,
      order: 0,
      targetSets: 3,
      targetReps: 8,
    },
  ],
});
describe("production social persistence", () => {
  it("requires opt-in, returns bounded public profiles, binds cursor to actor/query and filters either block direction", async () => {
    expect((await social.people(a, "Al")).data).toEqual([]);
    await social.profile(b, key(), true);
    await social.profile(c, key(), true);
    const page = await social.people(a, "Al", 1);
    expect(page.data).toHaveLength(1);
    expect(Object.keys(page.data[0]).sort()).toEqual([
      "avatarUrl",
      "displayName",
      "userId",
    ]);
    expect(
      (await social.people(a, "Al", 1, page.nextCursor!)).data,
    ).toHaveLength(1);
    await expect(
      social.people(b, "Al", 1, page.nextCursor!),
    ).rejects.toMatchObject({ code: "INVALID_CURSOR" });
    await expect(
      social.people(a, "xx", 1, page.nextCursor!),
    ).rejects.toMatchObject({ code: "INVALID_CURSOR" });
    await expect(social.people(a, " ")).rejects.toMatchObject({ status: 400 });
    await social.block(b, a, key(), true);
    expect((await social.people(a, "Al")).data.map((x) => x.userId)).toEqual([
      c,
    ]);
  });
  it("persists UUID mutation receipts and refuses mismatched payloads", async () => {
    const k = key();
    expect(await social.profile(a, k, true)).toEqual(
      await social.profile(a, k, true),
    );
    await expect(social.profile(a, k, false)).rejects.toMatchObject({
      code: "IDEMPOTENCY_MISMATCH",
    });
    await expect(social.profile(a, "bad", true)).rejects.toMatchObject({
      code: "INVALID_SCHEMA",
    });
  });
  it("consent is recipient-only, canonical pair deduplicates reverse requests, rejection replays", async () => {
    await social.profile(a, key(), true);
    await social.profile(b, key(), true);
    const req = await social.request(a, b, key());
    expect(await social.request(b, a, key())).toEqual(req);
    await expect(
      social.decision(a, req.requestId, key(), "accept"),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      social.decision(c, req.requestId, key(), "accept"),
    ).rejects.toMatchObject({ status: 404 });
    const k = key();
    expect(await social.decision(b, req.requestId, k, "reject")).toEqual(
      await social.decision(b, req.requestId, k, "reject"),
    );
    await expect(
      social.decision(b, req.requestId, key(), "accept"),
    ).rejects.toMatchObject({ code: "INVALID_STATE" });
    expect((await social.list(a, "pending")).data).toHaveLength(0);
  });
  it("removal and blocks revoke offers, unblock never restores friendship", async () => {
    await friends();
    expect((await social.list(a, "accepted")).data).toHaveLength(1);
    expect(await withActors([a, b], (tx) => areFriends(tx, a, b))).toBe(true);
    const share = await templates.create(a, key(), b, plan());
    await social.remove(a, b, key());
    await expect(templates.get(b, share.shareId)).rejects.toMatchObject({
      status: 403,
    });
    expect(await withActors([a, b], (tx) => areFriends(tx, a, b))).toBe(false);
    await friends();
    await social.block(b, a, key(), true);
    expect(await withActors([a, b], (tx) => canInteract(tx, a, b))).toBe(false);
    await expect(social.request(a, b, key())).rejects.toMatchObject({
      status: 403,
    });
    await social.block(b, a, key(), false);
    expect(await withActors([a, b], (tx) => canInteract(tx, a, b))).toBe(true);
    expect(await withActors([a, b], (tx) => areFriends(tx, a, b))).toBe(false);
    await expect(social.block(a, a, key(), true)).rejects.toMatchObject({
      status: 403,
    });
  });
  it("reports only authorized coach context; stores private content once", async () => {
    const body = {
      subjectUserId: b,
      context: "coach" as const,
      reason: "unsafe",
      details: "Private",
    };
    await expect(social.report(a, key(), body)).rejects.toMatchObject({
      status: 404,
    });
    await db
      .insert(schema.ptClientRelationships)
      .values({ trainerId: b, clientId: a, status: "active" });
    const k = key();
    expect(await social.report(a, k, body)).toEqual(
      await social.report(a, k, body),
    );
    expect((await social.moderation(a)).data).toHaveLength(1);
    expect((await social.list(b, "pending")).data).toHaveLength(0);
    await expect(
      social.report(a, key(), { ...body, resourceId: key() }),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      social.report(a, key(), { ...body, context: "together" }),
    ).rejects.toMatchObject({ status: 404 });
  });
});
describe("production sanitized template persistence", () => {
  it("copies immutable sanitized plan once to independently owned private workout and survives revocation", async () => {
    await friends();
    const p = plan();
    const k = key();
    const share = await templates.create(a, k, b, p);
    expect(await templates.create(a, k, b, p)).toEqual(share);
    expect((await templates.list(a)).data).toHaveLength(1);
    const copy = await templates.copy(b, share.shareId, key());
    expect(await templates.copy(b, share.shareId, key())).toEqual(copy);
    const [workout] = await db.select().from(schema.workouts);
    const [ex] = await db.select().from(schema.workoutExercises);
    expect(workout).toMatchObject({
      id: copy.workoutId,
      createdBy: b,
      visibility: "private",
      description: null,
    });
    expect(ex).toMatchObject({
      exerciseId: exercise,
      targetSets: 3,
      targetRepsMin: 8,
      targetRepsMax: 8,
      notes: null,
    });
    await templates.revoke(a, share.shareId, key());
    await expect(templates.get(b, share.shareId)).rejects.toMatchObject({
      status: 403,
    });
    await expect(templates.copy(b, share.shareId, key())).rejects.toMatchObject(
      { status: 403 },
    );
    expect(await db.select().from(schema.workouts)).toHaveLength(1);
    expect((await templates.list(b)).data).toHaveLength(0);
  });
  it("requires accepted unblocked friends and both paid; forbids sender copy and outsider access", async () => {
    await expect(templates.create(a, key(), b, plan())).rejects.toMatchObject({
      status: 403,
    });
    await friends();
    const share = await templates.create(a, key(), b, plan());
    await expect(templates.copy(a, share.shareId, key())).rejects.toMatchObject(
      { status: 403 },
    );
    await expect(templates.get(c, share.shareId)).rejects.toMatchObject({
      status: 404,
    });
    await expect(templates.get(a, key())).rejects.toMatchObject({
      status: 404,
    });
    await expect(
      templates.revoke(b, share.shareId, key()),
    ).rejects.toMatchObject({ status: 403 });
    await db
      .delete(schema.userSubscriptions)
      .where(eq(schema.userSubscriptions.userId, b));
    await expect(templates.copy(b, share.shareId, key())).rejects.toMatchObject(
      { code: "PAID_REQUIRED" },
    );
    await expect(templates.create(a, key(), b, plan())).rejects.toMatchObject({
      code: "PAID_REQUIRED",
    });
  });
  it("rejects unknown exercises and duplicate identities without persisting offers", async () => {
    await friends();
    const p = plan();
    await expect(
      templates.create(a, key(), b, {
        ...p,
        exercises: [{ ...p.exercises[0], exerciseId: key() }],
      }),
    ).rejects.toMatchObject({ code: "INVALID_EXERCISE" });
    await expect(
      templates.create(a, key(), b, {
        ...p,
        exercises: [p.exercises[0], p.exercises[0]],
      }),
    ).rejects.toMatchObject({ code: "INVALID_PLAN" });
    expect((await templates.list(a)).data).toHaveLength(0);
    const share = await templates.create(a, key(), b, {
      name: "Empty",
      exercises: [],
    });
    await templates.copy(b, share.shareId, key());
    expect(await db.select().from(schema.workoutExercises)).toHaveLength(0);
  });
  it("concurrent duplicate copies produce one real workout", async () => {
    await friends();
    const share = await templates.create(a, key(), b, plan());
    const results = await Promise.all([
      templates.copy(b, share.shareId, key()),
      templates.copy(b, share.shareId, key()),
    ]);
    expect(results[0]).toEqual(results[1]);
    expect(await db.select().from(schema.workouts)).toHaveLength(1);
  });
});
describe("authenticated D9 routes with production repositories", () => {
  it("requires authentication, UUID mutation headers, bounded schemas and staff claims", async () => {
    for (const path of [
      "/social/people?q=Al",
      "/together/templates",
      "/places/search?q=Gym",
      "/social/moderation/reports",
    ])
      expect((await http(path, null)).status).toBe(401);
    expect(
      (await http("/social/profile", a, "PUT", { discoverable: true })).status,
    ).toBe(400);
    expect((await http("/social/people?q=A&limit=100", a)).status).toBe(400);
    expect((await http("/social/moderation/reports", a)).status).toBe(403);
    expect(
      (await http("/social/moderation/reports", `admin:${a}`)).status,
    ).toBe(200);
    expect(
      (await http("/places/nearby?latitude=99&longitude=0", a)).status,
    ).toBe(400);
    expect((await http("/places/search?q=Gym", a)).status).toBe(503);
    expect(
      (await http("/places/nearby?latitude=51&longitude=0", a)).status,
    ).toBe(503);
  });
  it("drives friend, sharing, safety and report workflow through authenticated routes", async () => {
    expect(
      (await http("/social/profile", b, "PUT", { discoverable: true }, key()))
        .status,
    ).toBe(200);
    expect((await http("/social/people?q=Al", a)).status).toBe(200);
    const req = (await (
      await http("/social/requests", a, "POST", { userId: b }, key())
    ).json()) as { data: { requestId: string; shareId: string } };
    expect((await http("/social/requests", b)).status).toBe(200);
    expect(
      (
        await http(
          `/social/requests/${req.data.requestId}/decision`,
          b,
          "POST",
          { decision: "accept" },
          key(),
        )
      ).status,
    ).toBe(200);
    expect((await http("/social/friends", a)).status).toBe(200);
    const shared = (await (
      await http(
        "/together/templates",
        a,
        "POST",
        { recipientUserId: b, plan: plan() },
        key(),
      )
    ).json()) as { data: { requestId: string; shareId: string } };
    expect(shared.data.shareId).toBeTruthy();
    expect((await http("/together/templates", a)).status).toBe(200);
    expect(
      (await http(`/together/templates/${shared.data.shareId}`, b)).status,
    ).toBe(200);
    expect(
      (
        await http(
          `/together/templates/${shared.data.shareId}/copy`,
          b,
          "POST",
          {},
          key(),
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await http(
          `/together/templates/${shared.data.shareId}`,
          a,
          "DELETE",
          undefined,
          key(),
        )
      ).status,
    ).toBe(200);
    expect(
      (await http(`/together/templates/${shared.data.shareId}`, b)).status,
    ).toBe(403);
    expect(
      (await http(`/social/friends/${b}`, a, "DELETE", undefined, key()))
        .status,
    ).toBe(200);
    expect(
      (await http(`/social/blocks/${b}`, a, "PUT", {}, key())).status,
    ).toBe(200);
    expect(
      (await http(`/social/blocks/${b}`, a, "DELETE", undefined, key())).status,
    ).toBe(200);
    await db
      .insert(schema.ptClientRelationships)
      .values({ trainerId: b, clientId: a, status: "active" });
    expect(
      (
        await http(
          "/social/reports",
          a,
          "POST",
          { subjectUserId: b, context: "coach", reason: "spam" },
          key(),
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await http(
          "/social/reports",
          c,
          "POST",
          { subjectUserId: b, context: "coach", reason: "spam" },
          key(),
        )
      ).status,
    ).toBe(404);
  });
  it("throttles rejected invite/report attempts, not just successful writes", async () => {
    for (let i = 0; i < 30; i++)
      expect(
        (await http("/social/requests", a, "POST", { userId: b }, key()))
          .status,
      ).toBe(404);
    const limited = await http(
      "/social/requests",
      a,
      "POST",
      { userId: b },
      key(),
    );
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBe("60");
    for (let i = 0; i < 10; i++)
      expect(
        (
          await http(
            "/social/reports",
            c,
            "POST",
            { subjectUserId: b, context: "coach", reason: "spam" },
            key(),
          )
        ).status,
      ).toBe(404);
    expect(
      (
        await http(
          "/social/reports",
          c,
          "POST",
          { subjectUserId: b, context: "coach", reason: "spam" },
          key(),
        )
      ).status,
    ).toBe(429);
  });
});
it("pages every collection, checks expired/malformed cursors and sanitizes direct service input", async () => {
  await social.profile(b, key(), true);
  await social.profile(c, key(), true);
  for (const cursor of ["bad", Buffer.from("null").toString("base64url")])
    await expect(social.people(a, "Al", 1, cursor)).rejects.toMatchObject({
      code: "INVALID_CURSOR",
    });
  const people = await social.people(a, "Al", 1);
  const cursor = decodeCursor(people.nextCursor!);
  cursor.expires = 0;
  await expect(
    social.people(a, "Al", 1, encodeCursor(cursor)),
  ).rejects.toMatchObject({ code: "CURSOR_EXPIRED" });
  await friends();
  await social.request(a, c, key());
  expect((await social.list(a, "pending", 1)).data).toHaveLength(1);
  const req = await social.request(b, c, key());
  const pending = await social.list(c, "pending", 1);
  expect(pending.nextCursor).toBeTruthy();
  expect(
    (await social.list(c, "pending", 1, pending.nextCursor!)).data,
  ).toHaveLength(1);
  await social.decision(c, req.requestId, key(), "reject");
  const p = plan();
  delete (p.exercises[0] as { targetReps?: number }).targetReps;
  const first = await templates.create(a, key(), b, {
    ...p,
    notes: "secret",
    exercises: [{ ...p.exercises[0], sets: [{ reps: 999 }] }],
  } as unknown as typeof p);
  await templates.create(a, key(), b, plan());
  const shares = await templates.list(b, 1);
  expect(shares.nextCursor).toBeTruthy();
  expect((await templates.list(b, 1, shares.nextCursor!)).data).toHaveLength(1);
  expect(JSON.stringify(await templates.get(b, first.shareId))).not.toContain(
    "secret",
  );
  await templates.copy(b, first.shareId, key());
  expect(
    (await db.select().from(schema.workoutExercises))[0].targetRepsMin,
  ).toBe(1);
  await db
    .insert(schema.ptClientRelationships)
    .values({ trainerId: b, clientId: a, status: "active" });
  await social.report(a, key(), {
    subjectUserId: b,
    context: "coach",
    reason: "spam",
  });
  await social.report(a, key(), {
    subjectUserId: b,
    context: "coach",
    reason: "other",
  });
  const reports = await social.moderation(a, 1);
  expect(reports.nextCursor).toBeTruthy();
  expect(
    (await social.moderation(a, 1, reports.nextCursor!)).data,
  ).toHaveLength(1);
});
it("returns structured validation and rate errors on template and place routes", async () => {
  expect(
    (
      await http(
        "/together/templates",
        a,
        "POST",
        { recipientUserId: b, plan: { ...plan(), name: "" } },
        key(),
      )
    ).status,
  ).toBe(400);
  for (let i = 0; i < 30; i++)
    expect(
      (
        await http(
          "/together/templates",
          a,
          "POST",
          { recipientUserId: b, plan: plan() },
          key(),
        )
      ).status,
    ).toBe(403);
  const limited = await http(
    "/together/templates",
    a,
    "POST",
    { recipientUserId: b, plan: plan() },
    key(),
  );
  expect(limited.status).toBe(429);
  expect(limited.headers.get("retry-after")).toBe("60");
  for (let i = 0; i < 30; i++)
    expect((await http("/places/search?q=Gym", b)).status).toBe(503);
  const places = await http("/places/search?q=Gym", b);
  expect(places.status).toBe(429);
  expect(places.headers.get("retry-after")).toBe("60");
});
it("honors legacy blocked friendships in discovery and normalizes without clearing the other athlete's block", async () => {
  await social.profile(b, key(), true);
  await db
    .insert(schema.friendships)
    .values({ userId: a, friendId: b, initiatedBy: b, status: "blocked" });
  expect(await withActors([a, b], (tx) => canInteract(tx, a, b))).toBe(false);
  await db
    .insert(schema.friendships)
    .values({ userId: b, friendId: a, initiatedBy: a, status: "accepted" });
  expect((await social.list(a, "accepted")).data).toHaveLength(0);
  expect((await social.people(a, "Al")).data).toHaveLength(0);
  await social.remove(a, b, key());
  expect(await withActors([a, b], (tx) => canInteract(tx, a, b))).toBe(false);
  await social.block(a, b, key(), false);
  expect(await withActors([a, b], (tx) => canInteract(tx, a, b))).toBe(false);
  await social.block(b, a, key(), false);
  expect(await withActors([a, b], (tx) => canInteract(tx, a, b))).toBe(true);
  await db
    .insert(schema.friendships)
    .values({ userId: b, friendId: a, initiatedBy: b, status: "blocked" });
  await social.block(b, a, key(), false);
  expect(await withActors([a, b], (tx) => canInteract(tx, a, b))).toBe(true);
});
it("cannot remove strangers; accepted removal retries retain authorized receipt", async () => {
  await expect(social.remove(a, b, key())).rejects.toMatchObject({
    code: "NOT_FOUND",
  });
  await friends();
  const k = key();
  expect(await social.remove(a, b, k)).toEqual({ removed: true });
  expect(await social.remove(a, b, k)).toEqual({ removed: true });
  await expect(social.remove(a, b, key())).rejects.toMatchObject({
    code: "NOT_FOUND",
  });
});
it("hides soft-deleted opt-in profiles and rejects requests to them", async () => {
  await social.profile(b, key(), true);
  await db
    .update(schema.profiles)
    .set({ deletedAt: new Date() })
    .where(eq(schema.profiles.id, b));
  expect((await social.people(a, "Al")).data).toHaveLength(0);
  await expect(social.request(a, b, key())).rejects.toMatchObject({
    code: "NOT_FOUND",
  });
});
it("requires existing exercise visibility for BOTH template parties and rechecks before first copy", async () => {
  await friends();
  const custom = key();
  await db
    .insert(schema.exercises)
    .values({ id: custom, name: "Private coach exercise", createdBy: c });
  const p = plan();
  p.exercises[0].exerciseId = custom;
  await expect(templates.create(a, key(), b, p)).rejects.toMatchObject({
    code: "INVALID_EXERCISE",
  });
  // Owning the custom exercise alone cannot grant it to a friend.
  await db
    .update(schema.exercises)
    .set({ createdBy: a })
    .where(eq(schema.exercises.id, custom));
  await expect(templates.create(a, key(), b, p)).rejects.toMatchObject({
    code: "INVALID_EXERCISE",
  });
  const [assignedWorkout] = await db
    .insert(schema.workouts)
    .values({ name: "Coach plan", createdBy: a })
    .returning();
  await db.insert(schema.workoutExercises).values({
    workoutId: assignedWorkout.id,
    exerciseId: custom,
    sortOrder: 0,
  });
  await db.insert(schema.workoutAssignments).values({
    workoutId: assignedWorkout.id,
    clientId: b,
    trainerId: a,
    assignedDate: "2026-09-21",
  });
  const share = await templates.create(a, key(), b, p);
  await db.delete(schema.workoutAssignments);
  await expect(templates.copy(b, share.shareId, key())).rejects.toMatchObject({
    code: "INVALID_EXERCISE",
  });
  expect(await db.select().from(schema.togetherTemplateCopies)).toHaveLength(0);
  await db.insert(schema.workoutAssignments).values({
    workoutId: assignedWorkout.id,
    clientId: b,
    trainerId: a,
    assignedDate: "2026-09-21",
  });
  const copy = await templates.copy(b, share.shareId, key());
  await db.delete(schema.workoutAssignments);
  expect(await templates.copy(b, share.shareId, key())).toEqual(copy);
  const [copiedExercise] = await db
    .select()
    .from(schema.workoutExercises)
    .where(eq(schema.workoutExercises.workoutId, copy.workoutId!));
  expect(copiedExercise.exerciseId).not.toBe(custom);
  const [owned] = await db
    .select()
    .from(schema.exercises)
    .where(eq(schema.exercises.id, copiedExercise.exerciseId));
  expect(owned).toMatchObject({
    createdBy: b,
    isPublic: false,
    name: "Private coach exercise",
    description: null,
    instructions: null,
    clientRequestId: `together-recovery:${custom}`,
  });
  await db.delete(schema.exercises).where(eq(schema.exercises.id, custom));
  expect(
    await db
      .select()
      .from(schema.workoutExercises)
      .where(eq(schema.workoutExercises.workoutId, assignedWorkout.id)),
  ).toHaveLength(0);
  expect(
    await db
      .select()
      .from(schema.workoutExercises)
      .where(eq(schema.workoutExercises.workoutId, copy.workoutId!)),
  ).toHaveLength(1);
});
