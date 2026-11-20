import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { PgDialect, getTableConfig, type PgTable } from "drizzle-orm/pg-core";
import { and, eq, is, SQL } from "drizzle-orm";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import * as schema from "@persistence/db/schema";

/**
 * PER-108 (BE-A1) — design A's D7 tests, run against the REAL migration on
 * PGlite through the real HTTP handlers. Only the edges are stubbed: the JWT
 * (bearer token = user id), push delivery, and the subscription seat
 * evaluator (its own suite covers the tier maths; here a coach is either
 * "full" or not).
 */

const holder = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("@persistence/db/client", () => ({
  getDb: () => holder.db,
  createDb: () => holder.db,
}));
vi.mock("@persistence/db", async (original) => ({
  ...(await original<object>()),
  getDb: () => holder.db,
}));

vi.mock("@persistence/api-utils/auth/supabaseAuth", async (original) => ({
  ...(await original<object>()),
  getAuthUser: async (header?: string) =>
    header?.startsWith("Bearer ") ? { sub: header.slice(7) } : null,
}));

const push = vi.hoisted(() => ({
  createAndDispatch: null as unknown as ReturnType<typeof vi.fn>,
  dispatchExisting: null as unknown as ReturnType<typeof vi.fn>,
}));
vi.mock("../../notifications/push/notificationDispatcher", () => {
  push.createAndDispatch = vi.fn(async () => ({}));
  push.dispatchExisting = vi.fn(async () => {});
  return {
    NotificationDispatcher: class {
      createAndDispatch = push.createAndDispatch;
      dispatchExisting = push.dispatchExisting;
    },
  };
});

const seats = vi.hoisted(() => ({ full: new Set<string>() }));
vi.mock("../../trainers/seats/trainerSeats", async (original) => {
  const { EntitlementError } =
    await import("../../entitlement/assertEntitlement");
  const deny = {
    allowed: false as const,
    reason: "limit" as const,
    currentTier: "individual_trainer" as const,
    upgradeTo: "coach" as const,
    upgradePriceMonthly: 30,
  };
  return {
    ...(await original<object>()),
    evaluateTrainerJoinSeat: async (id: string) =>
      seats.full.has(id) ? deny : { allowed: true },
    assertTrainerCanInvite: async (id: string) => {
      if (seats.full.has(id))
        throw new EntitlementError(deny, "trainer_clients");
    },
    notifyTrainerClientLimitReached: vi.fn(async () => {}),
  };
});

// The roster's `data` comes from TrainerRepository.getClients (its own suite).
// Pinned here to prove `data` passes through byte-for-byte (D5).
const ROSTER = vi.hoisted(() => [
  {
    clientId: "11111111-1111-4111-8111-111111111111",
    name: "Lena",
    status: "active",
    adherence: 0.8,
  },
]);
vi.mock("../../repositories/trainerService", async () => {
  const { default: Elysia } = await import("elysia");
  return {
    TrainerService: new Elysia({ name: "TrainerServiceMock" }).decorate(
      "TrainerRepository",
      {
        isTrainer: async () => true,
        getClients: async () => ROSTER,
      },
    ),
  };
});

import Elysia from "elysia";
import { coreErrorHandler } from "../../../shared/errorHandler";
import { coachingRoutes } from "../../coachingRoutes";
import { trainersAcceptInviteCodeHandler } from "../../trainers/invite-codes/trainersAcceptInviteCodeHandler";
import { trainersInviteCodeCreateHandler } from "../../trainers/invite-codes/trainersInviteCodeCreateHandler";
import { trainersClientsListHandler } from "../../trainers/clients/trainersClientsListHandler";
import { endCoachClientRelationship } from "../../relationships/endCoachClientRelationship";
import { resolveCoachScope } from "../../relationships/resolveCoachScope";
import { resetRateLimits } from "../../leads/rateLimit";
import {
  ClientProfileRepository,
  isUniqueViolation,
} from "../clientProfileRepository";
import {
  DEFAULT_COACH_DECLARATION_VERSION,
  currentDeclarationVersion,
} from "../declaration";
import {
  registerSetupSectionHandler,
  type SetupSectionHandler,
} from "../setupSections";
import contract from "./fixtures/contract-1.2.0.json";

const MIGRATIONS = "../../../../../../supabase/migrations/";
const ROLLBACKS = "../../../../../../supabase/rollbacks/";
const read = (dir: string, file: string) =>
  readFile(new URL(`${dir}${file}`, import.meta.url), "utf8");
const MIGRATION = "20261120120000_coaching_relationships_client_profiles.sql";

const dialect = new PgDialect();

/** Tables the migration builds on, created from the Drizzle mirror. */
const BASE_TABLES = [
  schema.profiles,
  schema.ptClientRelationships,
  schema.dataSharingConsents,
  schema.trainerClientNotes,
  schema.nutritionTargets,
  schema.notifications,
  schema.trainerActionsAudit,
  schema.workoutPrograms,
  schema.programAssignments,
  schema.workoutAssignments,
  schema.clientAiSummaries,
];

function ddl(table: PgTable): string {
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
  // Plain unique indexes only; partial ones come from the real SQL.
  for (const idx of cfg.indexes.filter(
    (i) => i.config.unique && !i.config.where,
  )) {
    const cols = idx.config.columns.map((c) =>
      "name" in c ? `"${c.name}"` : "",
    );
    if (cols.every(Boolean)) columns.push(`unique (${cols.join(",")})`);
  }
  return `create table "${cfg.name}" (${columns.join(",")});`;
}

/** A database as it was BEFORE this migration, then (optionally) after it. */
async function baseDatabase(): Promise<PGlite> {
  const pg = await PGlite.create();
  await pg.exec(
    "create role anon; create role authenticated; create schema auth; create function auth.uid() returns uuid language sql as 'select null::uuid';",
  );
  for (const table of BASE_TABLES) await pg.exec(ddl(table));
  // The Drizzle mirror already carries this migration's two columns.
  await pg.exec(
    "alter table pt_client_relationships drop column activated_at, drop column client_profile_id;",
  );
  await pg.exec(
    await read(MIGRATIONS, "20260626110000_trainer_invite_codes.sql"),
  );
  return pg;
}

const COACH_A = randomUUID();
const COACH_B = randomUUID();
const COACH_D = randomUUID();
const ATHLETE_C = randomUUID();
const ATHLETE_E = randomUUID();
const ATHLETE_F = randomUUID();

const TRUNCATE = [
  "trainer_declarations",
  "coach_client_settings",
  "coach_client_setup_items",
  "trainer_invite_codes",
  "coach_client_profiles",
  ...BASE_TABLES.map((t) => getTableConfig(t).name),
];

let pg: PGlite;
let db: ReturnType<typeof drizzle<typeof schema>>;

const app = new Elysia()
  .use(coreErrorHandler)
  .use(coachingRoutes)
  .use(trainersAcceptInviteCodeHandler)
  .use(trainersInviteCodeCreateHandler)
  .use(trainersClientsListHandler);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;

async function http(
  method: string,
  path: string,
  actor: string | null,
  body?: unknown,
  key?: string,
): Promise<{ status: number; json: Json }> {
  const res = await app.handle(
    new Request(`http://localhost${path}`, {
      method,
      headers: {
        ...(actor ? { authorization: `Bearer ${actor}` } : {}),
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
        ...(key ? { "idempotency-key": key } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : null };
}

const TARGET = { dailyKcal: 2200, proteinG: 160, carbsG: 220, fatG: 70 };

async function newProfile(coach: string, extra: object = {}) {
  const res = await http("POST", "/trainers/me/client-profiles", coach, {
    displayName: "Lena",
    goal: "Run a 10k",
    privateNotes: "Knee niggle — go easy on lunges",
    ...extra,
  });
  expect(res.status).toBe(201);
  return res.json.data as Json;
}

async function declare(coach: string) {
  const res = await http("POST", "/trainers/me/declaration", coach, {
    statementVersion: currentDeclarationVersion(),
  });
  expect(res.status).toBe(200);
}

async function setUp(coach: string, profileId: string) {
  let res = await http(
    "PUT",
    `/trainers/me/client-profiles/${profileId}/setup/nutrition_target`,
    coach,
    { items: [{ config: TARGET, sortOrder: 0 }] },
  );
  expect(res.status).toBe(200);
  res = await http(
    "PUT",
    `/trainers/me/client-profiles/${profileId}/setup/welcome_message`,
    coach,
    { items: [{ config: { text: "Welcome aboard!" }, sortOrder: 0 }] },
  );
  expect(res.status).toBe(200);
  return res.json.data as Json;
}

async function invite(coach: string, profileId: string, key?: string) {
  const res = await http(
    "POST",
    `/trainers/me/client-profiles/${profileId}/invite`,
    coach,
    undefined,
    key,
  );
  expect(res.status).toBe(201);
  return res.json.data as { code: string; link: string; expiresAt: string };
}

const accept = (athlete: string, code: string) =>
  http("POST", "/trainers/accept-invite-code", athlete, {
    code,
    consent: true,
    consentVersion: "v1-2026-07",
  });

/** A ready-to-accept personal code from coach A. */
async function readyCode(coach = COACH_A) {
  const profile = await newProfile(coach);
  await setUp(coach, profile.id);
  await declare(coach);
  const { code } = await invite(coach, profile.id);
  return { profile, code };
}

const relationship = async (trainerId: string, clientId: string) =>
  (
    await db
      .select()
      .from(schema.ptClientRelationships)
      .where(
        and(
          eq(schema.ptClientRelationships.trainerId, trainerId),
          eq(schema.ptClientRelationships.clientId, clientId),
        ),
      )
  )[0];

beforeAll(async () => {
  pg = await baseDatabase();
  await pg.exec(await read(MIGRATIONS, MIGRATION));
  db = drizzle(pg, { schema });
  holder.db = db;
});

afterAll(async () => {
  await pg.close();
});

beforeEach(async () => {
  vi.unstubAllEnvs();
  resetRateLimits();
  seats.full.clear();
  push.createAndDispatch.mockClear();
  push.dispatchExisting.mockClear();
  await pg.exec(`truncate ${TRUNCATE.map((t) => `"${t}"`).join(",")} cascade`);
  await db.insert(schema.profiles).values([
    { id: COACH_A, fullName: "Ellie", role: "personal_trainer" },
    { id: COACH_B, fullName: "Marcus", role: "physiotherapist" },
    { id: COACH_D, fullName: "Dana", role: "personal_trainer" },
    { id: ATHLETE_C, fullName: "Chris", role: "user" },
    { id: ATHLETE_E, fullName: "Lena Park", role: "user" },
    { id: ATHLETE_F, fullName: "Frankie", role: "user" },
  ]);
  // A and B both coach C. D coaches nobody.
  await db.insert(schema.ptClientRelationships).values([
    { trainerId: COACH_A, clientId: ATHLETE_C, status: "active" },
    { trainerId: COACH_B, clientId: ATHLETE_C, status: "active" },
  ]);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

// ─── D7.1 Isolation ──────────────────────────────────────────────────────────

describe("isolation (two coaches, one athlete; a coach with nobody)", () => {
  it("an invited profile ID from A is a 404 to B on every profile route", async () => {
    const profile = await newProfile(COACH_A);
    const base = `/trainers/me/client-profiles/${profile.id}`;
    const calls: [string, string, unknown?][] = [
      ["GET", base],
      ["PATCH", base, { goal: "x" }],
      ["PUT", `${base}/setup/welcome_message`, { items: [] }],
      ["POST", `${base}/setup/copy-from`, { sourceProfileId: profile.id }],
      ["GET", `${base}/preview`],
      ["DELETE", `${base}/invite`],
      ["DELETE", base],
    ];
    await declare(COACH_B);
    calls.push(["POST", `${base}/invite`]);
    for (const [method, path, body] of calls) {
      const res = await http(method, path, COACH_B, body);
      expect([method, path, res.status]).toEqual([method, path, 404]);
    }
    const list = await http("GET", "/trainers/me/client-profiles", COACH_B);
    expect(list.json.data).toEqual([]);
    // And A's profile is untouched.
    const mine = await http("GET", base, COACH_A);
    expect(mine.json.data).toMatchObject({ goal: "Run a 10k", revision: 1 });
  });

  it("each coach reads and writes only their own settings for the shared athlete", async () => {
    const a = await http(
      "PATCH",
      `/trainers/me/clients/${ATHLETE_C}/settings`,
      COACH_A,
      { trackCalories: true, alertMode: "mute", features: { photos: false } },
    );
    expect(a.status).toBe(200);
    const b = await http(
      "GET",
      `/trainers/me/clients/${ATHLETE_C}/settings`,
      COACH_B,
    );
    expect(b.status).toBe(200);
    expect(b.json.data).toMatchObject({
      trackCalories: false,
      alertMode: "default",
      features: { photos: true },
      updatedAt: null,
    });
    expect(b.json.data.relationshipId).not.toBe(a.json.data.relationshipId);
  });

  it("a coach with no relationship gets 403 on every client route", async () => {
    for (const method of ["GET", "PATCH"]) {
      const res = await http(
        method,
        `/trainers/me/clients/${ATHLETE_C}/settings`,
        COACH_D,
        method === "PATCH" ? { trackTraining: true } : undefined,
      );
      expect(res.status).toBe(403);
      expect(res.json.code).toBe("not_your_client");
    }
  });

  it("copy-from never copies another coach's items", async () => {
    // C's target was set by B, so A copying from C gets nothing for it.
    await db.insert(schema.nutritionTargets).values({
      userId: ATHLETE_C,
      dailyKcal: "2000",
      proteinG: "150",
      carbsG: "200",
      fatG: "60",
      setByUserId: COACH_B,
    });
    const profile = await newProfile(COACH_A);
    const fromC = await http(
      "POST",
      `/trainers/me/client-profiles/${profile.id}/setup/copy-from`,
      COACH_A,
      { sourceClientId: ATHLETE_C },
    );
    expect(fromC.status).toBe(200);
    expect(fromC.json.data.setup).toEqual({});

    // B copying from B's own client does get it.
    const bProfile = await newProfile(COACH_B);
    const bCopy = await http(
      "POST",
      `/trainers/me/client-profiles/${bProfile.id}/setup/copy-from`,
      COACH_B,
      { sourceClientId: ATHLETE_C, sections: ["nutrition_target"] },
    );
    expect(bCopy.json.data.setup.nutrition_target[0].config).toMatchObject({
      dailyKcal: 2000,
      fatG: 60,
    });

    // A can't copy from a client who isn't A's, nor from B's profile.
    const notMine = await http(
      "POST",
      `/trainers/me/client-profiles/${profile.id}/setup/copy-from`,
      COACH_A,
      { sourceClientId: ATHLETE_E },
    );
    expect(notMine.status).toBe(403);
    const bad = await http(
      "POST",
      `/trainers/me/client-profiles/${profile.id}/setup/copy-from`,
      COACH_A,
      { sourceClientId: "not-a-uuid" },
    );
    expect(bad.status).toBe(403);
    const othersProfile = await http(
      "POST",
      `/trainers/me/client-profiles/${profile.id}/setup/copy-from`,
      COACH_A,
      { sourceProfileId: bProfile.id },
    );
    expect(othersProfile.status).toBe(404);
  });

  it("resolveCoachScope returns the caller's own relationship and settings", async () => {
    const a = await resolveCoachScope(COACH_A, ATHLETE_C);
    const b = await resolveCoachScope(COACH_B, ATHLETE_C);
    const d = await resolveCoachScope(COACH_D, ATHLETE_C);
    expect(a.allowed && b.allowed).toBe(true);
    if (!a.allowed || !b.allowed) return;
    expect(a.scope.relationshipId).not.toBe(b.scope.relationshipId);
    expect(a.scope.activatedAt).not.toBeNull();
    expect(d).toMatchObject({ allowed: false, status: 403 });
  });
});

// ─── D7.2 Wrong role ─────────────────────────────────────────────────────────

describe("wrong role", () => {
  it("an athlete gets 403 on every client-profile and declaration route", async () => {
    const profile = await newProfile(COACH_A);
    const base = `/trainers/me/client-profiles/${profile.id}`;
    const calls: [string, string, unknown?][] = [
      ["POST", "/trainers/me/client-profiles", { displayName: "x" }],
      ["GET", "/trainers/me/client-profiles"],
      ["GET", base],
      ["PATCH", base, { goal: "x" }],
      ["PUT", `${base}/setup/welcome_message`, { items: [] }],
      ["POST", `${base}/setup/copy-from`, { sourceProfileId: profile.id }],
      ["GET", `${base}/preview`],
      ["POST", `${base}/invite`],
      ["DELETE", `${base}/invite`],
      ["DELETE", base],
      ["GET", "/trainers/me/declaration"],
      ["POST", "/trainers/me/declaration", { statementVersion: "x" }],
    ];
    for (const [method, path, body] of calls) {
      const res = await http(method, path, ATHLETE_C, body);
      expect([method, path, res.status]).toEqual([method, path, 403]);
    }
  });

  it("a soft-deleted coach is refused too, and no token is a 401", async () => {
    await db
      .update(schema.profiles)
      .set({ deletedAt: new Date() })
      .where(eq(schema.profiles.id, COACH_D));
    const res = await http("GET", "/trainers/me/client-profiles", COACH_D);
    expect(res.status).toBe(403);
    const anon = await http("GET", "/trainers/me/client-profiles", null);
    expect(anon.status).toBe(401);
  });
});

// ─── D7.3 Accept ─────────────────────────────────────────────────────────────

describe("accepting a personal code", () => {
  it("creates an active relationship and materialises every section exactly once", async () => {
    const { profile, code } = await readyCode();
    const res = await accept(ATHLETE_E, code);
    expect(res.status).toBe(201);
    expect(res.json.data).toMatchObject({
      success: true,
      trainerName: "Ellie",
      relationshipStatus: "active",
      message: "You're now connected with Ellie",
      ready: {
        sections: [
          { section: "nutrition_target", count: 1 },
          { section: "welcome_message", count: 1 },
        ],
        welcomeMessage: "Welcome aboard!",
      },
    });

    const rel = await relationship(COACH_A, ATHLETE_E);
    expect(rel).toMatchObject({
      id: res.json.data.relationshipId,
      status: "active",
      initiatedBy: "trainer",
      clientProfileId: profile.id,
      consentVersion: "v1-2026-07",
    });
    expect(rel!.activatedAt).toBeInstanceOf(Date);

    const consents = await db.select().from(schema.dataSharingConsents);
    expect(consents).toEqual([
      expect.objectContaining({
        trainerId: COACH_A,
        clientId: ATHLETE_E,
        action: "grant",
        source: "personal_invite_redeem",
      }),
    ]);
    const target = await db.select().from(schema.nutritionTargets);
    expect(target).toEqual([
      expect.objectContaining({
        userId: ATHLETE_E,
        dailyKcal: "2200",
        setByUserId: COACH_A,
      }),
    ]);
    const notes = await db.select().from(schema.trainerClientNotes);
    expect(notes).toEqual([
      expect.objectContaining({
        trainerId: COACH_A,
        clientId: ATHLETE_E,
        isPrivate: true,
        content: "Knee niggle — go easy on lunges",
      }),
    ]);
    const welcome = await db.select().from(schema.notifications);
    expect(welcome).toEqual([
      expect.objectContaining({
        userId: ATHLETE_E,
        type: "coach_brief",
        title: "Welcome from Coach Ellie",
        message: "Welcome aboard!",
      }),
    ]);
    const settings = await db.select().from(schema.coachClientSettings);
    expect(settings).toEqual([
      expect.objectContaining({
        relationshipId: rel!.id,
        trackCalories: true,
        trackTraining: false,
      }),
    ]);
    const items = await db.select().from(schema.coachClientSetupItems);
    expect(items.every((i) => i.materialisedAt !== null)).toBe(true);
    expect(
      items.find((i) => i.section === "welcome_message")!.materialisedRefId,
    ).toBe(welcome[0]!.id);

    const after = await http(
      "GET",
      `/trainers/me/client-profiles/${profile.id}`,
      COACH_A,
    );
    expect(after.json.data).toMatchObject({
      status: "active",
      clientId: ATHLETE_E,
      relationshipId: rel!.id,
      invite: { status: "used" },
    });

    // Post-commit: the coach hears about it, the welcome push goes out.
    expect(push.createAndDispatch).toHaveBeenCalledWith(
      COACH_A,
      expect.objectContaining({
        type: "pt_accepted",
        message: "Lena Park accepted your invite",
      }),
    );
    expect(push.dispatchExisting).toHaveBeenCalledTimes(1);
  });

  it("a replay with the same request returns the first result and duplicates nothing", async () => {
    const { code } = await readyCode();
    const first = await accept(ATHLETE_E, code);
    const replay = await accept(ATHLETE_E, code);
    expect(replay.status).toBe(200);
    expect(replay.json.data.relationshipId).toBe(
      first.json.data.relationshipId,
    );
    expect(replay.json.data.ready).toEqual(first.json.data.ready);
    expect(await db.select().from(schema.notifications)).toHaveLength(1);
    expect(await db.select().from(schema.trainerClientNotes)).toHaveLength(1);
    expect(await db.select().from(schema.dataSharingConsents)).toHaveLength(1);
    expect(push.createAndDispatch).toHaveBeenCalledTimes(1);
  });

  it("a second request racing the first creates no duplicates", async () => {
    const { code } = await readyCode();
    const results = await Promise.all([
      accept(ATHLETE_E, code),
      accept(ATHLETE_E, code),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 201]);
    expect(
      await db
        .select()
        .from(schema.ptClientRelationships)
        .where(eq(schema.ptClientRelationships.clientId, ATHLETE_E)),
    ).toHaveLength(1);
    expect(await db.select().from(schema.notifications)).toHaveLength(1);
  });

  it("another athlete can't reuse a code that was already redeemed", async () => {
    const { code } = await readyCode();
    await accept(ATHLETE_E, code);
    const res = await accept(ATHLETE_F, code);
    expect(res.status).toBe(404);
    expect(res.json.code).toBe("invalid_code");
  });

  it("an expired, resent-old or cancelled code is 404 invalid_code", async () => {
    const { profile, code } = await readyCode();
    await db
      .update(schema.trainerInviteCodes)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(schema.trainerInviteCodes.code, code));
    expect((await accept(ATHLETE_E, code)).json.code).toBe("invalid_code");

    const resent = await invite(COACH_A, profile.id);
    const old = await accept(ATHLETE_E, code);
    expect(old.status).toBe(404);

    const cancel = await http(
      "DELETE",
      `/trainers/me/client-profiles/${profile.id}/invite`,
      COACH_A,
    );
    expect(cancel.status).toBe(204);
    const cancelled = await accept(ATHLETE_E, resent.code);
    expect(cancelled.status).toBe(404);
    expect(cancelled.json.code).toBe("invalid_code");
    expect(await relationship(COACH_A, ATHLETE_E)).toBeUndefined();
  });

  it("an athlete already active with this coach gets 409 exists", async () => {
    const { code } = await readyCode();
    const res = await accept(ATHLETE_C, code);
    expect(res.status).toBe(409);
    expect(res.json.code).toBe("exists");
  });

  it("a coach who soft-deleted their account can't be joined, and nothing is written", async () => {
    const { profile, code } = await readyCode();
    await db
      .update(schema.profiles)
      .set({ deletedAt: new Date() })
      .where(eq(schema.profiles.id, COACH_A));
    const res = await accept(ATHLETE_E, code);
    expect(res.status).toBe(404);
    expect(res.json.code).toBe("invalid_code");
    expect(await relationship(COACH_A, ATHLETE_E)).toBeUndefined();
    expect(await db.select().from(schema.dataSharingConsents)).toEqual([]);
    expect(await db.select().from(schema.nutritionTargets)).toEqual([]);

    // Restoring the account brings the code back.
    await db
      .update(schema.profiles)
      .set({ deletedAt: null })
      .where(eq(schema.profiles.id, COACH_A));
    expect((await accept(ATHLETE_E, code)).status).toBe(201);
    expect((await relationship(COACH_A, ATHLETE_E))!.clientProfileId).toBe(
      profile.id,
    );
  });

  it("the coach can't redeem their own personal code", async () => {
    const { code } = await readyCode();
    const res = await accept(COACH_A, code);
    expect(res.status).toBe(400);
    expect(res.json.code).toBe("self_invite");
  });

  it("with the seat cap full: 409 coach_client_limit_reached, nothing materialised", async () => {
    const { profile, code } = await readyCode();
    seats.full.add(COACH_A);
    const res = await accept(ATHLETE_E, code);
    expect(res.status).toBe(409);
    expect(res.json).toEqual({
      code: "coach_client_limit_reached",
      message: "This coach's client list is full.",
    });
    expect(await relationship(COACH_A, ATHLETE_E)).toBeUndefined();
    expect(await db.select().from(schema.nutritionTargets)).toEqual([]);
    expect(await db.select().from(schema.notifications)).toEqual([]);
    const items = await db.select().from(schema.coachClientSetupItems);
    expect(items.every((i) => i.materialisedAt === null)).toBe(true);
    const detail = await http(
      "GET",
      `/trainers/me/client-profiles/${profile.id}`,
      COACH_A,
    );
    expect(detail.json.data).toMatchObject({
      status: "invited",
      invite: { status: "active" },
    });
  });

  it("revives a dormant relationship as active", async () => {
    await db.insert(schema.ptClientRelationships).values({
      trainerId: COACH_A,
      clientId: ATHLETE_E,
      status: "terminated",
      initiatedBy: "client",
      endDate: "2026-01-01",
    });
    const { profile, code } = await readyCode();
    const res = await accept(ATHLETE_E, code);
    expect(res.status).toBe(201);
    expect(await relationship(COACH_A, ATHLETE_E)).toMatchObject({
      status: "active",
      initiatedBy: "trainer",
      endDate: null,
      clientProfileId: profile.id,
    });
  });

  it("a section that lands later plugs in through the hook and runs once", async () => {
    const materialise = vi.fn(async () => ({ refId: null }));
    const handler: SetupSectionHandler = {
      validate: async (_db, _t, item) => ({ ok: true, item }),
      materialise,
      preview: async () => ({
        programmes: [{ name: "Strength block", workouts: 3 }],
        plans: [{ name: "Cut" }],
        forms: [{ title: "Starter" }],
      }),
    };
    const restore = registerSetupSectionHandler("programme", handler);
    try {
      const profile = await newProfile(COACH_A, { privateNotes: null });
      const put = await http(
        "PUT",
        `/trainers/me/client-profiles/${profile.id}/setup/programme`,
        COACH_A,
        { items: [{ config: { sessionsPerWeek: 4 }, sortOrder: 0 }] },
      );
      expect(put.status).toBe(200);
      await declare(COACH_A);
      const { code } = await invite(COACH_A, profile.id);
      const res = await accept(ATHLETE_E, code);
      expect(res.json.data.ready).toMatchObject({
        programmes: [{ name: "Strength block", workouts: 3 }],
        plans: [{ name: "Cut" }],
        forms: [{ title: "Starter" }],
      });
      await accept(ATHLETE_E, code);
      expect(materialise).toHaveBeenCalledTimes(1);
      const settings = await db.select().from(schema.coachClientSettings);
      expect(settings[0]).toMatchObject({
        trackTraining: true,
        sessionsPerWeek: 4,
        trackCalories: false,
      });
      expect(await db.select().from(schema.trainerClientNotes)).toEqual([]);
    } finally {
      restore();
    }
  });

  it("a post-commit failure never fails the accept", async () => {
    const { code } = await readyCode();
    push.createAndDispatch.mockRejectedValueOnce(new Error("push down"));
    push.dispatchExisting.mockRejectedValueOnce(new Error("push down"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await accept(ATHLETE_E, code);
    spy.mockRestore();
    expect(res.status).toBe(201);
  });
});

// ─── D7.4 Second coach ───────────────────────────────────────────────────────

describe("a second coach", () => {
  it("accepting B while active with A leaves A untouched, and ending B leaves A intact", async () => {
    await http("PATCH", `/trainers/me/clients/${ATHLETE_C}/settings`, COACH_A, {
      trackTraining: true,
      sessionsPerWeek: 3,
    });
    const before = await relationship(COACH_A, ATHLETE_C);
    const aSettings = await db.select().from(schema.coachClientSettings);

    // B's existing relationship with C is ended so B can invite them afresh.
    await endCoachClientRelationship({
      trainerId: COACH_B,
      clientId: ATHLETE_C,
      initiatedBy: "trainer",
    });
    const { profile, code } = await readyCode(COACH_B);
    const res = await accept(ATHLETE_C, code);
    expect(res.status).toBe(201);

    expect(await relationship(COACH_A, ATHLETE_C)).toEqual(before);
    const allSettings = await db.select().from(schema.coachClientSettings);
    expect(allSettings.find((s) => s.trainerId === COACH_A)).toEqual(
      aSettings[0],
    );

    const coaching = await http("GET", "/users/me/coaching", ATHLETE_C);
    expect(
      coaching.json.data.coaches.map((c: Json) => c.trainerId).sort(),
    ).toEqual([COACH_A, COACH_B].sort());

    const ended = await endCoachClientRelationship({
      trainerId: COACH_B,
      clientId: ATHLETE_C,
      initiatedBy: "client",
    });
    expect(ended.ok).toBe(true);
    expect(await relationship(COACH_A, ATHLETE_C)).toEqual(before);
    const bProfile = await http(
      "GET",
      `/trainers/me/client-profiles/${profile.id}`,
      COACH_B,
    );
    expect(bProfile.json.data.status).toBe("ended");
    expect((await resolveCoachScope(COACH_A, ATHLETE_C)).allowed).toBe(true);
  });
});

// ─── D7.5 Old-client contract ────────────────────────────────────────────────

describe("1.2.0 contract fixtures", () => {
  const checkFields = (data: Json, fields: Record<string, string>) => {
    for (const [key, type] of Object.entries(fields)) {
      if (type === "boolean:true") expect(data[key]).toBe(true);
      else expect(typeof data[key]).toBe(type);
    }
  };

  it("a 1.2.0 accept request for a GENERAL code still gets the 1.2.0 response", async () => {
    const created = await http("POST", "/trainers/me/invite-codes", COACH_D);
    expect(created.status).toBe(201);
    const { body } = contract.acceptInviteCode.request;
    const res = await http(
      "POST",
      contract.acceptInviteCode.request.path,
      ATHLETE_E,
      { ...body, code: created.json.data.code },
    );
    expect(res.status).toBe(201);
    checkFields(res.json.data, contract.acceptInviteCode.successFields);
    expect(res.json.data.message).toBe("Training request sent to Dana");
    expect(res.json.data.relationshipStatus).toBe("pending");
    expect(res.json.data.ready).toBeNull();
    expect((await relationship(COACH_D, ATHLETE_E))!.status).toBe("pending");
  });

  it("a 1.2.0 accept request for a PERSONAL code passes the same shape", async () => {
    const { code } = await readyCode();
    const res = await http(
      "POST",
      contract.acceptInviteCode.request.path,
      ATHLETE_E,
      { ...contract.acceptInviteCode.request.body, code },
    );
    const [lo, hi] = contract.acceptInviteCode.successStatusRange;
    expect(res.status).toBeGreaterThanOrEqual(lo!);
    expect(res.status).toBeLessThanOrEqual(hi!);
    checkFields(res.json.data, contract.acceptInviteCode.successFields);
  });

  it("every error keeps the 1.2.0 { code, message } shape and known codes", async () => {
    const { code } = await readyCode();
    const errors = [
      await accept(ATHLETE_E, "ZZZZZZ"),
      await accept(ATHLETE_C, code),
      await accept(COACH_A, code),
      await http("POST", "/trainers/accept-invite-code", ATHLETE_E, { code }),
    ];
    for (const res of errors) {
      checkFields(res.json, contract.acceptInviteCode.errorFields);
      expect(contract.acceptInviteCode.errorCodes).toContain(res.json.code);
    }
  });

  it("GET /trainers/me/clients keeps `data` byte-for-byte and adds `invited`", async () => {
    const profile = await newProfile(COACH_A);
    await setUp(COACH_A, profile.id);
    await newProfile(COACH_A, { displayName: "Sam" }).then((p) =>
      http("DELETE", `/trainers/me/client-profiles/${p.id}`, COACH_A),
    );
    const before = await http(
      "GET",
      contract.trainerClients.request.path,
      COACH_A,
    );
    expect(before.json.data).toEqual(ROSTER);
    expect(before.json.invited).toEqual([
      {
        profileId: profile.id,
        displayName: "Lena",
        goal: "Run a 10k",
        inviteExpiresAt: null,
        inviteStatus: "not_sent",
        readyCount: 2,
      },
    ]);
    await declare(COACH_A);
    const { expiresAt } = await invite(COACH_A, profile.id);
    const after = await http("GET", "/trainers/me/clients", COACH_A);
    expect(after.json.invited[0]).toMatchObject({
      inviteStatus: "active",
      inviteExpiresAt: expiresAt,
    });
    const none = await http("GET", "/trainers/me/clients", COACH_D);
    expect(none.json).toEqual({ data: ROSTER, invited: [] });
  });
});

// ─── D7.6 Code lifecycle ─────────────────────────────────────────────────────

describe("personal code lifecycle", () => {
  it("resend expires the old code, and only one active personal code exists per profile", async () => {
    const { profile, code } = await readyCode();
    const second = await invite(COACH_A, profile.id);
    expect(second.code).not.toBe(code);
    expect(second.link).toBe(
      `persistencemobile://accept-invite?code=${second.code}`,
    );
    const rows = await db
      .select()
      .from(schema.trainerInviteCodes)
      .where(eq(schema.trainerInviteCodes.clientProfileId, profile.id));
    expect(rows.map((r) => r.status).sort()).toEqual(["active", "expired"]);
    await expect(
      db.insert(schema.trainerInviteCodes).values({
        trainerId: COACH_A,
        code: "QQQQQQ",
        status: "active",
        expiresAt: new Date(Date.now() + 1000),
        clientProfileId: profile.id,
      }),
    ).rejects.toSatisfy(isUniqueViolation);
  });

  it("resend, cancel and delete lock the code before the profile, like accept", async () => {
    // PGlite is one connection, so a real deadlock can't be staged. What
    // prevents one is that every path takes the two row locks in ONE order:
    // trainer_invite_codes, then coach_client_profiles. Record the order.
    const locks: string[] = [];
    const logged = drizzle(pg, {
      schema,
      logger: {
        logQuery: (query: string) => {
          const m =
            /from "(trainer_invite_codes|coach_client_profiles)"[\s\S]*for update/i.exec(
              query,
            );
          if (m) locks.push(m[1]!);
        },
      },
    });
    const lockOrder = async (run: () => Promise<unknown>) => {
      locks.length = 0;
      holder.db = logged;
      try {
        await run();
      } finally {
        holder.db = db;
      }
      return locks.slice(0, 2);
    };
    const codeFirst = ["trainer_invite_codes", "coach_client_profiles"];

    const { profile } = await readyCode();
    const path = `/trainers/me/client-profiles/${profile.id}`;
    expect(
      await lockOrder(() => http("POST", `${path}/invite`, COACH_A)),
    ).toEqual(codeFirst);
    expect(
      await lockOrder(() => http("DELETE", `${path}/invite`, COACH_A)),
    ).toEqual(codeFirst);
    const { code } = await invite(COACH_A, profile.id);
    expect(await lockOrder(() => http("DELETE", path, COACH_A))).toEqual(
      codeFirst,
    );

    const other = await readyCode();
    expect(await lockOrder(() => accept(ATHLETE_E, other.code))).toEqual(
      codeFirst,
    );
    expect(code).toBeTruthy();
  });

  it("expires 7 days after issue, enforced on the server", async () => {
    const profile = await newProfile(COACH_A);
    await declare(COACH_A);
    const before = Date.now();
    const { expiresAt } = await invite(COACH_A, profile.id);
    const ms = new Date(expiresAt).getTime() - before;
    expect(ms).toBeGreaterThan(7 * 86400_000 - 5000);
    expect(ms).toBeLessThanOrEqual(7 * 86400_000 + 5000);
  });

  it("a replayed Idempotency-Key returns the same code", async () => {
    const profile = await newProfile(COACH_A);
    await declare(COACH_A);
    const one = await invite(COACH_A, profile.id, "invite-key-1");
    const two = await invite(COACH_A, profile.id, "invite-key-1");
    expect(two.code).toBe(one.code);
  });

  it("a coach keeps a general code alongside personal codes", async () => {
    const { code } = await readyCode();
    const general = await http("POST", "/trainers/me/invite-codes", COACH_A);
    expect(general.status).toBe(201);
    expect(general.json.data.isExisting).toBe(false);
    expect(general.json.data.code).not.toBe(code);
    const again = await http("POST", "/trainers/me/invite-codes", COACH_A);
    expect(again.json.data).toMatchObject({
      isExisting: true,
      code: general.json.data.code,
    });
  });

  it("cancel is idempotent, and a cancelled profile can be invited again", async () => {
    const { profile } = await readyCode();
    const path = `/trainers/me/client-profiles/${profile.id}/invite`;
    expect((await http("DELETE", path, COACH_A)).status).toBe(204);
    expect((await http("DELETE", path, COACH_A)).status).toBe(204);
    const detail = await http(
      "GET",
      `/trainers/me/client-profiles/${profile.id}`,
      COACH_A,
    );
    expect(detail.json.data).toMatchObject({
      status: "cancelled",
      invite: { status: "expired" },
    });
    const { code } = await invite(COACH_A, profile.id);
    expect((await accept(ATHLETE_E, code)).status).toBe(201);
    // Accepted: no more invite changes.
    expect((await http("DELETE", path, COACH_A)).status).toBe(409);
    const reissue = await http("POST", path, COACH_A);
    expect(reissue.json.code).toBe("profile_not_editable");
  });

  it("the invite route is seat-capped (402) for a full coach", async () => {
    const profile = await newProfile(COACH_A);
    await declare(COACH_A);
    seats.full.add(COACH_A);
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await http(
      "POST",
      `/trainers/me/client-profiles/${profile.id}/invite`,
      COACH_A,
    );
    spy.mockRestore();
    expect(res.status).toBe(402);
  });
});

// ─── Invite preview (athlete) ────────────────────────────────────────────────

describe("GET /invites/:code/preview", () => {
  it("shows the coach and the prepared set-up for a personal code", async () => {
    const { profile, code } = await readyCode();
    const res = await http(
      "GET",
      `/invites/${code.toLowerCase()}/preview`,
      ATHLETE_E,
    );
    expect(res.status).toBe(200);
    const coachView = await http(
      "GET",
      `/trainers/me/client-profiles/${profile.id}/preview`,
      COACH_A,
    );
    expect(res.json.data).toMatchObject({
      kind: "personal",
      coach: { name: "Ellie", avatarUrl: null },
    });
    // One projection for both sides.
    expect(res.json.data.ready).toEqual(coachView.json.data);
  });

  it("shows only the coach for a general code", async () => {
    const created = await http("POST", "/trainers/me/invite-codes", COACH_D);
    const res = await http(
      "GET",
      `/invites/${created.json.data.code}/preview`,
      ATHLETE_E,
    );
    expect(res.json.data).toMatchObject({ kind: "general", ready: null });
  });

  it("is 404 invalid_code for unknown, cancelled or garbage codes", async () => {
    const { profile, code } = await readyCode();
    await http(
      "DELETE",
      `/trainers/me/client-profiles/${profile.id}/invite`,
      COACH_A,
    );
    for (const c of [code, "NOPE99", "!!"]) {
      const res = await http("GET", `/invites/${c}/preview`, ATHLETE_E);
      expect(res.status).toBe(404);
    }
    // A code whose profile was cancelled behind its back is also refused.
    const p2 = await newProfile(COACH_A);
    const { code: code2 } = await invite(COACH_A, p2.id);
    await db
      .update(schema.coachClientProfiles)
      .set({ status: "cancelled" })
      .where(eq(schema.coachClientProfiles.id, p2.id));
    expect(
      (await http("GET", `/invites/${code2}/preview`, ATHLETE_E)).status,
    ).toBe(404);
  });

  it("is rate-limited to 30 per user per hour", async () => {
    for (let i = 0; i < 30; i++) {
      await http("GET", "/invites/NOPE99/preview", ATHLETE_E);
    }
    const res = await http("GET", "/invites/NOPE99/preview", ATHLETE_E);
    expect(res.status).toBe(429);
    const other = await http("GET", "/invites/NOPE99/preview", ATHLETE_F);
    expect(other.status).toBe(404);
  });
});

// ─── D7.7 Revision ───────────────────────────────────────────────────────────

describe("revision (offline contract)", () => {
  it("a stale expectedRevision on a profile returns 409 with the current row", async () => {
    const profile = await newProfile(COACH_A);
    const path = `/trainers/me/client-profiles/${profile.id}`;
    const ok = await http("PATCH", path, COACH_A, {
      goal: "Half marathon",
      expectedRevision: 1,
    });
    expect(ok.json.data.revision).toBe(2);
    const stale = await http("PATCH", path, COACH_A, {
      goal: "Something else",
      expectedRevision: 1,
    });
    expect(stale.status).toBe(409);
    expect(stale.json).toMatchObject({
      code: "revision_conflict",
      current: { goal: "Half marathon", revision: 2 },
    });
    const staleSetup = await http(
      "PUT",
      `${path}/setup/welcome_message`,
      COACH_A,
      {
        items: [],
        expectedRevision: 1,
      },
    );
    expect(staleSetup.status).toBe(409);
    // Missing expectedRevision: last write wins.
    const lww = await http("PATCH", path, COACH_A, {
      displayName: "  Lena P ",
      contactEmail: "lena@example.com",
    });
    expect(lww.json.data).toMatchObject({
      displayName: "Lena P",
      contactEmail: "lena@example.com",
      goal: "Half marathon",
      revision: 3,
    });
  });

  it("a stale expectedRevision on settings returns 409 with the current row", async () => {
    const path = `/trainers/me/clients/${ATHLETE_C}/settings`;
    const first = await http("PATCH", path, COACH_A, {
      sessionsPerWeek: 4,
      features: { photos: false, bogus: true },
    });
    expect(first.json.data).toMatchObject({
      revision: 2,
      sessionsPerWeek: 4,
      features: {
        nutrition: true,
        checkIns: true,
        photos: false,
        habits: true,
        messages: true,
        resources: true,
      },
    });
    const stored = await db.select().from(schema.coachClientSettings);
    expect(stored[0]!.features).toEqual({ photos: false });

    const stale = await http("PATCH", path, COACH_A, {
      trackTraining: true,
      expectedRevision: 1,
    });
    expect(stale.status).toBe(409);
    expect(stale.json.current).toMatchObject({
      revision: 2,
      trackTraining: false,
    });

    const fresh = await http("PATCH", path, COACH_A, {
      sessionsPerWeek: null,
      features: { habits: false },
      expectedRevision: 2,
    });
    expect(fresh.json.data).toMatchObject({
      revision: 3,
      sessionsPerWeek: null,
      features: { photos: false, habits: false },
    });
    const get = await http("GET", path, COACH_A);
    expect(get.json.data).toEqual(fresh.json.data);
  });
});

// ─── D7.8 Declaration ────────────────────────────────────────────────────────

describe("coach declaration", () => {
  it("blocks the new invite route until the current version is accepted", async () => {
    const profile = await newProfile(COACH_A);
    const path = `/trainers/me/client-profiles/${profile.id}/invite`;
    const status = await http("GET", "/trainers/me/declaration", COACH_A);
    expect(status.json.data).toEqual({
      currentVersion: DEFAULT_COACH_DECLARATION_VERSION,
      acceptedVersion: null,
      acceptedAt: null,
    });
    const blocked = await http("POST", path, COACH_A);
    expect(blocked.status).toBe(403);
    expect(blocked.json.code).toBe("declaration_required");

    const hash = "a".repeat(64);
    const accepted = await http(
      "POST",
      "/trainers/me/declaration",
      COACH_A,
      {
        statementVersion: DEFAULT_COACH_DECLARATION_VERSION,
        statementTextHash: hash,
      },
      "decl-1",
    );
    expect(accepted.json.data.acceptedVersion).toBe(
      DEFAULT_COACH_DECLARATION_VERSION,
    );
    // Idempotent.
    await http("POST", "/trainers/me/declaration", COACH_A, {
      statementVersion: DEFAULT_COACH_DECLARATION_VERSION,
    });
    const rows = await db.select().from(schema.trainerDeclarations);
    expect(rows).toEqual([
      expect.objectContaining({
        statementTextHash: hash,
        clientRequestId: "decl-1",
      }),
    ]);
    expect((await http("POST", path, COACH_A)).status).toBe(201);

    // Nothing in the response claims verification.
    expect(JSON.stringify(accepted.json)).not.toMatch(/verif/i);
  });

  it("a version bump asks again, and a stale version is refused", async () => {
    const profile = await newProfile(COACH_A);
    await declare(COACH_A);
    vi.stubEnv("COACH_DECLARATION_VERSION", "2027-01-v2");
    const path = `/trainers/me/client-profiles/${profile.id}/invite`;
    expect((await http("POST", path, COACH_A)).status).toBe(403);
    const status = await http("GET", "/trainers/me/declaration", COACH_A);
    expect(status.json.data).toMatchObject({
      currentVersion: "2027-01-v2",
      acceptedVersion: DEFAULT_COACH_DECLARATION_VERSION,
    });
    const stale = await http("POST", "/trainers/me/declaration", COACH_A, {
      statementVersion: DEFAULT_COACH_DECLARATION_VERSION,
    });
    expect(stale.status).toBe(409);
    expect(stale.json).toMatchObject({
      code: "declaration_version_mismatch",
      currentVersion: "2027-01-v2",
    });
    await declare(COACH_A);
    expect((await http("POST", path, COACH_A)).status).toBe(201);
  });

  it("today's invite-code creation is not gated", async () => {
    const res = await http("POST", "/trainers/me/invite-codes", COACH_A);
    expect(res.status).toBe(201);
  });
});

// ─── Profiles: create, list, set-up validation, delete ──────────────────────

describe("invited profiles", () => {
  it("create is idempotent on Idempotency-Key", async () => {
    const one = await http(
      "POST",
      "/trainers/me/client-profiles",
      COACH_A,
      { displayName: "Lena" },
      "profile-key-1",
    );
    const two = await http(
      "POST",
      "/trainers/me/client-profiles",
      COACH_A,
      { displayName: "Lena again" },
      "profile-key-1",
    );
    expect(one.status).toBe(201);
    expect(two.status).toBe(200);
    expect(two.json.data.id).toBe(one.json.data.id);
    expect(two.json.data.displayName).toBe("Lena");
    // The same key from another coach is a different profile.
    const other = await http(
      "POST",
      "/trainers/me/client-profiles",
      COACH_B,
      { displayName: "Lena" },
      "profile-key-1",
    );
    expect(other.status).toBe(201);
  });

  it("rejects a blank name", async () => {
    const res = await http("POST", "/trainers/me/client-profiles", COACH_A, {
      displayName: "   ",
    });
    expect(res.status).toBe(400);
    const profile = await newProfile(COACH_A);
    const patch = await http(
      "PATCH",
      `/trainers/me/client-profiles/${profile.id}`,
      COACH_A,
      { displayName: " " },
    );
    expect(patch.status).toBe(400);
  });

  it("lists with status and since, reporting deletions", async () => {
    const keep = await newProfile(COACH_A);
    const gone = await newProfile(COACH_A, { displayName: "Gone" });
    const t0 = new Date(Date.now() - 1000).toISOString();
    expect(
      (await http("DELETE", `/trainers/me/client-profiles/${gone.id}`, COACH_A))
        .status,
    ).toBe(204);
    // Deleting twice is still 204.
    expect(
      (await http("DELETE", `/trainers/me/client-profiles/${gone.id}`, COACH_A))
        .status,
    ).toBe(204);
    const all = await http(
      "GET",
      "/trainers/me/client-profiles?status=invited",
      COACH_A,
    );
    expect(all.json.data.map((p: Json) => p.id)).toEqual([keep.id]);
    expect(all.json.deletedIds).toEqual([]);
    expect(typeof all.json.asOf).toBe("string");
    const since = await http(
      "GET",
      `/trainers/me/client-profiles?since=${encodeURIComponent(t0)}`,
      COACH_A,
    );
    expect(since.json.deletedIds).toEqual([gone.id]);
    const later = await http(
      "GET",
      `/trainers/me/client-profiles?since=${encodeURIComponent(all.json.asOf)}`,
      COACH_A,
    );
    expect(later.json.data).toEqual([]);
    const bad = await http(
      "GET",
      "/trainers/me/client-profiles?since=nope",
      COACH_A,
    );
    expect(bad.status).toBe(400);
    expect(
      (await http("GET", `/trainers/me/client-profiles/${gone.id}`, COACH_A))
        .status,
    ).toBe(404);
    expect(
      (await http("GET", "/trainers/me/client-profiles/not-a-uuid", COACH_A))
        .status,
    ).toBe(404);
    expect(
      (await http("DELETE", "/trainers/me/client-profiles/not-a-uuid", COACH_A))
        .status,
    ).toBe(404);
  });

  it("an accepted profile can't be edited or deleted", async () => {
    const { profile, code } = await readyCode();
    await accept(ATHLETE_E, code);
    const path = `/trainers/me/client-profiles/${profile.id}`;
    const patch = await http("PATCH", path, COACH_A, { goal: "x" });
    expect(patch.status).toBe(409);
    expect(patch.json).toMatchObject({
      code: "profile_not_editable",
      status: "active",
    });
    expect((await http("DELETE", path, COACH_A)).status).toBe(409);
  });

  it("validates set-up sections", async () => {
    const profile = await newProfile(COACH_A);
    const put = (section: string, items: unknown[]) =>
      http(
        "PUT",
        `/trainers/me/client-profiles/${profile.id}/setup/${section}`,
        COACH_A,
        { items },
      );
    for (const section of [
      "programme",
      "meal_plan",
      "starter_form",
      "repeating_form",
      "resource",
    ]) {
      const res = await put(section, [{ sortOrder: 0, config: {} }]);
      expect(res.status).toBe(422);
      expect(res.json).toMatchObject({ code: "section_unavailable", section });
    }
    const cases: [string, unknown[]][] = [
      ["bogus", []],
      ["nutrition_target", [{ sortOrder: 0, config: { ...TARGET, fatG: -1 } }]],
      [
        "nutrition_target",
        [{ sortOrder: 0, config: { ...TARGET, waterCups: 1.5 } }],
      ],
      [
        "nutrition_target",
        [{ sortOrder: 0, config: { ...TARGET, preset: 7 } }],
      ],
      [
        "nutrition_target",
        [{ sortOrder: 0, refId: randomUUID(), config: TARGET }],
      ],
      [
        "nutrition_target",
        [
          { sortOrder: 0, config: TARGET },
          { sortOrder: 1, config: TARGET },
        ],
      ],
      ["welcome_message", [{ sortOrder: 0, config: { text: "" } }]],
      [
        "welcome_message",
        [{ sortOrder: 0, config: { text: "x".repeat(1001) } }],
      ],
      [
        "welcome_message",
        [{ sortOrder: 0, refId: randomUUID(), config: { text: "hi" } }],
      ],
    ];
    for (const [section, items] of cases) {
      const res = await put(section, items);
      expect([section, res.status]).toEqual([section, 400]);
      expect(res.json.code).toBe("invalid_setup");
    }
    const ok = await put("nutrition_target", [
      { sortOrder: 0, config: { ...TARGET, preset: "cut", extra: "dropped" } },
    ]);
    expect(ok.json.data.setup.nutrition_target[0].config).toEqual({
      ...TARGET,
      waterCups: 8,
      preset: "cut",
    });
    expect(ok.json.data.revision).toBe(2);
    // Emptying a section removes it.
    const cleared = await put("nutrition_target", []);
    expect(cleared.json.data.setup).toEqual({});
  });

  it("rejects duplicate refIds within a section", async () => {
    const restore = registerSetupSectionHandler("resource", {
      validate: async (_db, _t, item) => ({ ok: true, item }),
      materialise: async () => ({ refId: null }),
    });
    try {
      const profile = await newProfile(COACH_A);
      const ref = randomUUID();
      const res = await http(
        "PUT",
        `/trainers/me/client-profiles/${profile.id}/setup/resource`,
        COACH_A,
        {
          items: [
            { sortOrder: 0, refId: ref },
            { sortOrder: 1, refId: ref },
          ],
        },
      );
      expect(res.status).toBe(400);
    } finally {
      restore();
    }
  });

  it("copies set-up from another of the caller's profiles", async () => {
    const source = await newProfile(COACH_A);
    await setUp(COACH_A, source.id);
    const target = await newProfile(COACH_A, { displayName: "Sam" });
    const path = `/trainers/me/client-profiles/${target.id}/setup/copy-from`;
    const onlyWelcome = await http("POST", path, COACH_A, {
      sourceProfileId: source.id,
      sections: ["welcome_message", "nonsense"],
    });
    expect(Object.keys(onlyWelcome.json.data.setup)).toEqual([
      "welcome_message",
    ]);
    const all = await http("POST", path, COACH_A, {
      sourceProfileId: source.id,
    });
    expect(Object.keys(all.json.data.setup).sort()).toEqual([
      "nutrition_target",
      "welcome_message",
    ]);
    const self = await http("POST", path, COACH_A, {
      sourceProfileId: target.id,
    });
    expect(self.status).toBe(404);
    const both = await http("POST", path, COACH_A, {
      sourceProfileId: source.id,
      sourceClientId: ATHLETE_C,
    });
    expect(both.status).toBe(400);
  });

  it("a physio's welcome message is titled with their name", async () => {
    const { code } = await readyCode(COACH_B);
    await accept(ATHLETE_E, code);
    const [welcome] = await db.select().from(schema.notifications);
    expect(welcome!.title).toBe("Welcome from Marcus");
    expect(push.createAndDispatch).toHaveBeenCalledWith(
      COACH_B,
      expect.objectContaining({ type: "physio_accepted" }),
    );
  });
});

// ─── Fallbacks: unnamed people, ended replays, odd set-up rows ───────────────

describe("fallbacks", () => {
  const COACH_G = randomUUID();
  const ATHLETE_H = randomUUID();

  beforeEach(async () => {
    await db.insert(schema.profiles).values([
      { id: COACH_G, fullName: null, role: "personal_trainer" },
      { id: ATHLETE_H, fullName: null, role: "user" },
    ]);
  });

  it("an unnamed coach and athlete get neutral copy everywhere", async () => {
    const { code } = await readyCode(COACH_G);
    const preview = await http("GET", `/invites/${code}/preview`, ATHLETE_H);
    expect(preview.json.data.coach.name).toBe("Your coach");
    const res = await accept(ATHLETE_H, code);
    expect(res.json.data.trainerName).toBe("Your trainer");
    const [welcome] = await db.select().from(schema.notifications);
    expect(welcome!.title).toBe("Welcome from your coach");
    // The coach is told using the name they typed for the profile.
    expect(push.createAndDispatch).toHaveBeenCalledWith(
      COACH_G,
      expect.objectContaining({ message: "Lena accepted your invite" }),
    );
    await db
      .update(schema.ptClientRelationships)
      .set({ activatedAt: null })
      .where(eq(schema.ptClientRelationships.clientId, ATHLETE_H));
    const coaching = await http("GET", "/users/me/coaching", ATHLETE_H);
    expect(coaching.json.data.coaches[0]).toMatchObject({
      name: "Your coach",
      since: expect.any(String),
    });
    await db
      .update(schema.ptClientRelationships)
      .set({ createdAt: null })
      .where(eq(schema.ptClientRelationships.clientId, ATHLETE_H));
    const undated = await http("GET", "/users/me/coaching", ATHLETE_H);
    expect(undated.json.data.coaches[0].since).toBeNull();
    const scope = await resolveCoachScope(COACH_G, ATHLETE_H);
    expect(scope.allowed && scope.scope.activatedAt).toBeNull();
  });

  it("a replay after the relationship ended is refused", async () => {
    const { code } = await readyCode();
    await accept(ATHLETE_E, code);
    await endCoachClientRelationship({
      trainerId: COACH_A,
      clientId: ATHLETE_E,
      initiatedBy: "client",
    });
    const replay = await accept(ATHLETE_E, code);
    expect(replay.status).toBe(404);
    expect(replay.json.code).toBe("invalid_code");
  });

  it("skips rows with no live handler or already materialised, and ignores a bad sessions target", async () => {
    const materialise = vi.fn(async () => ({ refId: null }));
    const restore = registerSetupSectionHandler("programme", {
      validate: async (_db, _t, item) => ({ ok: true, item }),
      materialise,
    });
    try {
      const profile = await newProfile(COACH_A, { privateNotes: null });
      await http(
        "PUT",
        `/trainers/me/client-profiles/${profile.id}/setup/programme`,
        COACH_A,
        { items: [{ config: { sessionsPerWeek: 20 }, sortOrder: 0 }] },
      );
      // Rows a later build might leave behind.
      await db.insert(schema.coachClientSetupItems).values([
        { profileId: profile.id, section: "meal_plan", sortOrder: 0 },
        {
          profileId: profile.id,
          section: "resource",
          sortOrder: 0,
          materialisedAt: new Date(0),
        },
      ]);
      await declare(COACH_A);
      const { code } = await invite(COACH_A, profile.id);
      expect((await accept(ATHLETE_E, code)).status).toBe(201);
      expect(materialise).toHaveBeenCalledTimes(1);
      const items = await db.select().from(schema.coachClientSetupItems);
      expect(
        items.find((i) => i.section === "meal_plan")!.materialisedAt,
      ).toBeNull();
      const [settings] = await db.select().from(schema.coachClientSettings);
      expect(settings).toMatchObject({
        trackTraining: true,
        sessionsPerWeek: null,
      });
    } finally {
      restore();
    }
  });
});

// ─── /users/me/coaching ──────────────────────────────────────────────────────

describe("GET /users/me/coaching", () => {
  it("lists each active coach with their switches, and nothing for others", async () => {
    await http("PATCH", `/trainers/me/clients/${ATHLETE_C}/settings`, COACH_A, {
      features: { messages: false },
    });
    const res = await http("GET", "/users/me/coaching", ATHLETE_C);
    expect(res.status).toBe(200);
    const byCoach = Object.fromEntries(
      res.json.data.coaches.map((c: Json) => [c.trainerId, c]),
    );
    expect(byCoach[COACH_A]).toMatchObject({
      name: "Ellie",
      features: { messages: false, photos: true },
      due: { forms: 0 },
      newPlans: 0,
      resources: 0,
    });
    expect(byCoach[COACH_B].features.messages).toBe(true);
    expect(typeof byCoach[COACH_B].since).toBe("string");
    const none = await http("GET", "/users/me/coaching", ATHLETE_E);
    expect(none.json.data.coaches).toEqual([]);
  });
});

// ─── D7.10 Retention ─────────────────────────────────────────────────────────

describe("retention purge", () => {
  it("deletes never-accepted profiles after 90 days and never accepted ones", async () => {
    const repo = new ClientProfileRepository();
    const { profile: accepted, code } = await readyCode();
    await accept(ATHLETE_E, code);
    const cancelled = await newProfile(COACH_A, { displayName: "Cancelled" });
    await http(
      "DELETE",
      `/trainers/me/client-profiles/${cancelled.id}/invite`,
      COACH_A,
    );
    const neverSent = await newProfile(COACH_A, { displayName: "Never sent" });
    const expired = await newProfile(COACH_A, { displayName: "Expired" });
    await invite(COACH_A, expired.id);
    const fresh = await newProfile(COACH_A, { displayName: "Fresh" });

    const old = new Date(Date.now() - 100 * 86400_000);
    for (const id of [accepted.id, cancelled.id, neverSent.id, expired.id]) {
      await db
        .update(schema.coachClientProfiles)
        .set({ createdAt: old, cancelledAt: id === cancelled.id ? old : null })
        .where(eq(schema.coachClientProfiles.id, id));
    }
    await db
      .update(schema.trainerInviteCodes)
      .set({ expiresAt: old, createdAt: old });

    expect(await repo.purgeUnaccepted(new Date())).toBe(3);
    const left = (await db.select().from(schema.coachClientProfiles)).map(
      (p) => p.id,
    );
    expect(left.sort()).toEqual([accepted.id, fresh.id].sort());
  });
});

// ─── D7.9 Migration ──────────────────────────────────────────────────────────

describe(MIGRATION, () => {
  it("applies twice, backfills active relationships only, then runs down and up", async () => {
    const m = await baseDatabase();
    const mig = await read(MIGRATIONS, MIGRATION);
    const down = await read(ROLLBACKS, MIGRATION);
    const trainer = randomUUID();
    const [c1, c2, c3] = [randomUUID(), randomUUID(), randomUUID()];
    const programme = randomUUID();
    await m.exec(`
      insert into profiles (id, role) values
        ('${trainer}', 'personal_trainer'), ('${c1}', 'user'), ('${c2}', 'user'), ('${c3}', 'user');
      insert into pt_client_relationships (trainer_id, client_id, status, consent_given_at, updated_at) values
        ('${trainer}', '${c1}', 'active', '2026-08-01T00:00:00Z', now()),
        ('${trainer}', '${c2}', 'pending', null, now()),
        ('${trainer}', '${c3}', 'terminated', null, now());
      insert into nutrition_targets (user_id, daily_kcal, protein_g, carbs_g, fat_g, set_by_user_id)
        values ('${c1}', 2000, 150, 200, 60, '${trainer}');
      insert into workout_programs (id, name, days_per_week, created_by) values ('${programme}', 'Block', 4, '${trainer}');
      insert into program_assignments (program_id, client_id, assigned_by, start_date, status)
        values ('${programme}', '${c1}', '${trainer}', '2026-08-01', 'started');
      insert into trainer_invite_codes (trainer_id, code, status, expires_at)
        values ('${trainer}', 'GENRL1', 'active', now() + interval '1 day');
    `);

    await m.exec(mig);
    const snapshot = async () => ({
      rels: (
        await m.query(
          "select client_id, status, activated_at from pt_client_relationships order by client_id",
        )
      ).rows,
      settings: (
        await m.query(
          "select client_id, track_training, track_calories, sessions_per_week, revision from coach_client_settings",
        )
      ).rows,
    });
    const first = await snapshot();
    expect(first.settings).toEqual([
      {
        client_id: c1,
        track_training: true,
        track_calories: true,
        sessions_per_week: 4,
        revision: 1,
      },
    ]);
    const activated = first.rels as {
      client_id: string;
      activated_at: Date | null;
    }[];
    expect(activated.find((r) => r.client_id === c1)!.activated_at).toEqual(
      new Date("2026-08-01T00:00:00Z"),
    );
    expect(
      activated
        .filter((r) => r.client_id !== c1)
        .every((r) => r.activated_at === null),
    ).toBe(true);

    // Twice: a no-op.
    await m.exec(mig);
    expect(await snapshot()).toEqual(first);

    // RLS on, no policies, on every new table.
    const rls = await m.query<{ relname: string; relrowsecurity: boolean }>(
      `select relname, relrowsecurity from pg_class where relname in
       ('coach_client_profiles','coach_client_setup_items','coach_client_settings','trainer_declarations')
       order by relname`,
    );
    expect(rls.rows.every((r) => r.relrowsecurity)).toBe(true);

    // The trigger stamps activated_at when a pending row becomes active.
    await m.exec(
      `update pt_client_relationships set status = 'active' where client_id = '${c2}'`,
    );
    const promoted = await m.query<{ activated_at: Date | null }>(
      `select activated_at from pt_client_relationships where client_id = '${c2}'`,
    );
    expect(promoted.rows[0]!.activated_at).not.toBeNull();

    // General codes: still one active per trainer; personal codes don't count.
    await expect(
      m.exec(
        `insert into trainer_invite_codes (trainer_id, code, status, expires_at) values ('${trainer}', 'GENRL2', 'active', now() + interval '1 day')`,
      ),
    ).rejects.toThrow();
    await m.exec(`
      insert into coach_client_profiles (id, trainer_id, display_name)
        values ('${programme}', '${trainer}', 'Lena');
      insert into trainer_invite_codes (trainer_id, code, status, expires_at, client_profile_id)
        values ('${trainer}', 'PERSN1', 'active', now() + interval '7 days', '${programme}');
    `);
    // CHECKs hold.
    await expect(
      m.exec(
        `insert into coach_client_profiles (trainer_id, display_name, status) values ('${trainer}', 'x', 'bogus')`,
      ),
    ).rejects.toThrow();
    await expect(
      m.exec(
        `insert into coach_client_settings (relationship_id, trainer_id, client_id, sessions_per_week)
         select id, trainer_id, client_id, 15 from pt_client_relationships where client_id = '${c2}'`,
      ),
    ).rejects.toThrow();

    // Down, then up again.
    await m.exec(down);
    const tables = await m.query<{ n: number }>(
      `select count(*)::int as n from pg_class where relname in
       ('coach_client_profiles','coach_client_setup_items','coach_client_settings','trainer_declarations')`,
    );
    expect(tables.rows[0]!.n).toBe(0);
    const cols = await m.query<{ column_name: string }>(
      `select column_name from information_schema.columns
       where table_name in ('pt_client_relationships','trainer_invite_codes')
         and column_name in ('activated_at','client_profile_id','client_request_id')`,
    );
    expect(cols.rows).toEqual([]);
    const general = await m.query<{ code: string }>(
      "select code from trainer_invite_codes",
    );
    expect(general.rows).toEqual([{ code: "GENRL1" }]);

    await m.exec(mig);
    expect((await snapshot()).settings).toHaveLength(2);
    await m.close();
  });
});
