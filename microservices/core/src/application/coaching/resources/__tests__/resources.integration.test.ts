import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { PgDialect, getTableConfig, type PgTable } from "drizzle-orm/pg-core";
import { eq, is, SQL } from "drizzle-orm";
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
 * PER-122 (BE-I1) — backend design I's resources tests (1, 2 and 5), run
 * against the REAL migrations on PGlite through the real HTTP handlers,
 * set-up / accept flow and offboarding. Only the edges are stubbed: the JWT
 * (bearer token = user id), push delivery, and S3 (an in-memory bucket behind
 * a real S3Client, so presigned URLs are really signed).
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
vi.mock("../../../notifications/push/notificationDispatcher", () => ({
  NotificationDispatcher: class {
    createAndDispatch = vi.fn(async () => ({}));
    dispatchExisting = vi.fn(async () => {});
  },
}));
// Seats and entitlements have their own suites; the accept flow is the point.
vi.mock("../../../trainers/seats/trainerSeats", async (original) => ({
  ...(await original<object>()),
  evaluateTrainerJoinSeat: async () => ({ allowed: true }),
  evaluateTrainerClientsActiveSeat: async () => ({ allowed: true }),
  assertTrainerCanInvite: async () => {},
  notifyTrainerClientLimitReached: vi.fn(async () => {}),
}));
vi.mock("../../../entitlement/assertEntitlement", async (original) => ({
  ...(await original<object>()),
  evaluateTrainerClientsActiveSeat: async () => ({ allowed: true }),
}));
vi.mock("sst", () => ({
  Resource: { CoachPrivateMedia: { name: "private-media-test" } },
}));

import Elysia from "elysia";
import { coreErrorHandler } from "../../../../shared/errorHandler";
import { coachingRoutes } from "../../../coachingRoutes";
import { trainersAcceptInviteCodeHandler } from "../../../trainers/invite-codes/trainersAcceptInviteCodeHandler";
import { endCoachClientRelationship } from "../../../relationships/endCoachClientRelationship";
import { setS3ClientForTests } from "../../../media/privateMediaStore";
import { purgeStaleMedia } from "../../../media/privateMediaRepository";
import { FakeBucket } from "../../../media/__tests__/fakeS3";
import { currentDeclarationVersion } from "../../declaration";
import { availableSections } from "../../setupSections";
import { bulkAssign, cleanUrl, ownLiveResources } from "../resourceRepository";

const MIGRATIONS = "../../../../../../../supabase/migrations/";
const ROLLBACKS = "../../../../../../../supabase/rollbacks/";
const read = (dir: string, file: string) =>
  readFile(new URL(`${dir}${file}`, import.meta.url), "utf8");
const MIGRATION = "20261125101829_coach_resources.sql";

const dialect = new PgDialect();

const BASE_TABLES = [
  schema.profiles,
  schema.ptClientRelationships,
  // PER-123: offboarding also cancels this relationship's future bookings.
  schema.coachSessions,
  schema.coachSessionAttendees,
  schema.dataSharingConsents,
  schema.trainerClientNotes,
  schema.nutritionTargets,
  schema.notifications,
  schema.trainerActionsAudit,
  schema.workoutPrograms,
  schema.programAssignments,
  schema.workoutAssignments,
  schema.clientAiSummaries,
  schema.nutritionPlans,
  schema.nutritionPlanAssignments,
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
                : String(c.default as number | boolean | bigint));
    }
    return `"${c.name}" ${type}${c.notNull ? " not null" : ""}${c.primary ? " primary key" : ""}${def}`;
  });
  for (const pk of cfg.primaryKeys)
    columns.push(
      `primary key (${pk.columns.map((c) => `"${c.name}"`).join(",")})`,
    );
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

/** A database with designs A, C and F applied, BEFORE this migration. */
async function baseDatabase(): Promise<PGlite> {
  const pg = await PGlite.create();
  await pg.exec(
    "create role anon; create role authenticated; create schema auth; create function auth.uid() returns uuid language sql as 'select null::uuid';",
  );
  for (const table of BASE_TABLES) await pg.exec(ddl(table));
  await pg.exec(
    "alter table pt_client_relationships drop column activated_at, drop column client_profile_id;",
  );
  await pg.exec(
    await read(MIGRATIONS, "20260626110000_trainer_invite_codes.sql"),
  );
  await pg.exec(
    await read(
      MIGRATIONS,
      "20261120120000_coaching_relationships_client_profiles.sql",
    ),
  );
  await pg.exec(await read(MIGRATIONS, "20261120235941_coach_forms.sql"));
  await pg.exec(
    "DO $$ BEGIN CREATE TYPE notification_type AS ENUM ('coach_brief'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;",
  );
  await pg.exec(
    await read(MIGRATIONS, "20261123120117_coach_events_notifications.sql"),
  );
  await pg.exec(
    await read(MIGRATIONS, "20261123230832_progress_photos_private_media.sql"),
  );
  return pg;
}

const ATHLETE_A = randomUUID(); // coached by C and E
const ATHLETE_B = randomUUID(); // coached by C only
const ATHLETE_F = randomUUID(); // invited by C with a personal code
const COACH_C = randomUUID();
const COACH_E = randomUUID();
const COACH_D = randomUUID(); // coaches nobody

const TRUNCATE = [
  "coach_session_attendees",
  "coach_sessions",
  "coach_resource_assignments",
  "coach_resources",
  "private_media_purges",
  "private_media",
  "progress_photos",
  "progress_photo_sets",
  "coach_events",
  "coach_form_responses",
  "coach_form_requests",
  "coach_form_schedule_clients",
  "coach_form_schedules",
  "coach_form_versions",
  "coach_forms",
  "trainer_declarations",
  "coach_client_settings",
  "coach_client_setup_items",
  "trainer_invite_codes",
  "coach_client_profiles",
  ...BASE_TABLES.map((t) => getTableConfig(t).name),
];

let pg: PGlite;
let db: ReturnType<typeof drizzle<typeof schema>>;
let bucket: FakeBucket;

const app = new Elysia()
  .use(coreErrorHandler)
  .use(coachingRoutes)
  .use(trainersAcceptInviteCodeHandler);

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

async function link(coach: string, title = "Mobility routine", key?: string) {
  const res = await http(
    "POST",
    "/trainers/me/resources",
    coach,
    { kind: "link", title, url: "https://example.com/mobility" },
    key,
  );
  expect(res.status).toBe(201);
  return res.json.data as Json;
}

/** Ask for an upload and (unless told not to) play the phone's PUT. */
async function upload(
  coach: string,
  contentType = "application/pdf",
  bytes = 5000,
  put = true,
) {
  const res = await http("POST", "/trainers/me/media/uploads", coach, {
    purpose: "resource",
    contentType,
    bytes,
  });
  expect(res.status).toBe(201);
  const media = res.json.data;
  if (put) {
    const u = media.upload;
    const key = decodeURIComponent(new URL(u.url).pathname.slice(1));
    bucket.put(
      key,
      u.headers["Content-Type"],
      Number(u.headers["Content-Length"]),
    );
  }
  return media as Json;
}

async function file(coach: string, title = "Meal guide") {
  const media = await upload(coach);
  const res = await http("POST", "/trainers/me/resources", coach, {
    kind: "file",
    title,
    mediaId: media.mediaId,
  });
  expect(res.status).toBe(201);
  return res.json.data as Json;
}

const assign = (
  coach: string,
  resourceIds: string[],
  clientIds: string[],
  key?: string,
) =>
  http(
    "POST",
    "/trainers/me/resources/assign",
    coach,
    { resourceIds, clientIds },
    key,
  );

const clientList = (coach: string, client: string) =>
  http("GET", `/trainers/me/clients/${client}/resources`, coach);

const mine = (athlete: string, query = "") =>
  http("GET", `/users/me/resources${query}`, athlete);

const opened = (athlete: string, assignmentId: string) =>
  http("POST", `/users/me/resources/${assignmentId}/opened`, athlete);

const end = (trainerId: string, clientId: string) =>
  endCoachClientRelationship({ trainerId, clientId, initiatedBy: "client" });

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
  bucket = new FakeBucket();
  setS3ClientForTests(bucket.client());
  await pg.exec(`truncate ${TRUNCATE.map((t) => `"${t}"`).join(",")} cascade`);
  await db.insert(schema.profiles).values([
    { id: ATHLETE_A, fullName: "Lena", role: "user" },
    { id: ATHLETE_B, fullName: "Chris", role: "user" },
    { id: ATHLETE_F, fullName: "Frankie", role: "user" },
    { id: COACH_C, fullName: "Ellie", role: "personal_trainer" },
    { id: COACH_E, fullName: "Marcus", role: "physiotherapist" },
    { id: COACH_D, fullName: "Dana", role: "personal_trainer" },
  ]);
  await db.insert(schema.ptClientRelationships).values([
    { trainerId: COACH_C, clientId: ATHLETE_A, status: "active" },
    { trainerId: COACH_E, clientId: ATHLETE_A, status: "active" },
    { trainerId: COACH_C, clientId: ATHLETE_B, status: "active" },
  ]);
});

afterEach(() => setS3ClientForTests(null));

// ─── Design I test 1: isolation ─────────────────────────────────────────────

describe("design I test 1: coaches only see and assign their own; athletes only see active coaches'", () => {
  it("coach B can't see, edit, remove or assign coach A's resources", async () => {
    const res = await link(COACH_C);
    const list = await http("GET", "/trainers/me/resources", COACH_E);
    expect(list.status).toBe(200);
    expect(list.json.data.resources).toEqual([]);

    const patch = await http(
      "PATCH",
      `/trainers/me/resources/${res.id}`,
      COACH_E,
      { title: "Mine now" },
    );
    expect(patch.status).toBe(404);
    expect(patch.json.code).toBe("resource_not_found");

    // Removing someone else's is a no-op (idempotent 204), not a delete.
    const del = await http(
      "DELETE",
      `/trainers/me/resources/${res.id}`,
      COACH_E,
    );
    expect(del.status).toBe(204);

    // E coaches A too, but can't give A coach C's resource.
    const stolen = await assign(COACH_E, [res.id], [ATHLETE_A]);
    expect(stolen.status).toBe(404);
    expect(stolen.json).toMatchObject({
      code: "resource_not_found",
      resourceIds: [res.id],
    });
    const [row] = await db
      .select()
      .from(schema.coachResources)
      .where(eq(schema.coachResources.id, res.id));
    expect(row).toMatchObject({ title: "Mobility routine", archivedAt: null });
    expect(await db.select().from(schema.coachResourceAssignments)).toEqual([]);
  });

  it("assigning to anyone who isn't the caller's active client assigns nothing", async () => {
    const res = await link(COACH_C);
    const refused = await assign(COACH_C, [res.id], [ATHLETE_A, ATHLETE_F]);
    expect(refused.status).toBe(403);
    expect(refused.json).toMatchObject({
      code: "not_your_client",
      clientIds: [ATHLETE_F],
    });
    expect(await db.select().from(schema.coachResourceAssignments)).toEqual([]);
    // A coach with no clients, and the client tab of someone else's client.
    const lonely = await link(COACH_D);
    expect((await assign(COACH_D, [lonely.id], [ATHLETE_A])).status).toBe(403);
    expect((await clientList(COACH_D, ATHLETE_A)).status).toBe(403);
    expect(
      (
        await http(
          "DELETE",
          `/trainers/me/clients/${ATHLETE_A}/resources/${randomUUID()}`,
          COACH_D,
        )
      ).status,
    ).toBe(403);
  });

  it("athletes and anonymous callers can't use the coach routes", async () => {
    const asAthlete = await http("GET", "/trainers/me/resources", ATHLETE_A);
    expect(asAthlete.status).toBe(403);
    expect(asAthlete.json.code).toBe("not_a_trainer");
    const anon = await http("GET", "/trainers/me/resources", null);
    expect(anon.status).toBe(401);
    expect((await mine("")).status).toBe(401);
  });

  it("two coaches of one athlete each see only their own assignments", async () => {
    const fromC = await link(COACH_C, "C's link");
    const fromE = await link(COACH_E, "E's link");
    expect((await assign(COACH_C, [fromC.id], [ATHLETE_A])).status).toBe(201);
    expect((await assign(COACH_E, [fromE.id], [ATHLETE_A])).status).toBe(201);

    const forC = await clientList(COACH_C, ATHLETE_A);
    expect(forC.json.data.resources.map((r: Json) => r.resource.title)).toEqual(
      ["C's link"],
    );
    const forE = await clientList(COACH_E, ATHLETE_A);
    expect(forE.json.data.resources.map((r: Json) => r.resource.title)).toEqual(
      ["E's link"],
    );

    // E can't remove C's assignment.
    const cAssignment = forC.json.data.resources[0].assignmentId;
    expect(
      (
        await http(
          "DELETE",
          `/trainers/me/clients/${ATHLETE_A}/resources/${cAssignment}`,
          COACH_E,
        )
      ).status,
    ).toBe(204);
    expect((await clientList(COACH_C, ATHLETE_A)).json.data.resources).toEqual([
      expect.objectContaining({ assignmentId: cAssignment }),
    ]);

    // The athlete sees both, attributed.
    const athlete = await mine(ATHLETE_A);
    expect(
      athlete.json.data.resources
        .map((r: Json) => [r.title, r.coach.name])
        .sort(),
    ).toEqual([
      ["C's link", "Ellie"],
      ["E's link", "Marcus"],
    ]);
    // Another athlete sees nothing, and can't stamp A's resource.
    expect((await mine(ATHLETE_B)).json.data.resources).toEqual([]);
    expect((await opened(ATHLETE_B, cAssignment)).status).toBe(404);
  });

  it("athletes lose a coach's resources when coaching ends, and a revived relationship doesn't bring them back", async () => {
    const fromC = await link(COACH_C, "C's link");
    const fromE = await link(COACH_E, "E's link");
    await assign(COACH_C, [fromC.id], [ATHLETE_A]);
    await assign(COACH_E, [fromE.id], [ATHLETE_A]);
    const before = await mine(ATHLETE_A);
    const cAssignment = before.json.data.resources.find(
      (r: Json) => r.coach.id === COACH_C,
    ).assignmentId;
    const asOf = before.json.data.asOf;

    expect((await end(COACH_C, ATHLETE_A)).ok).toBe(true);
    const after = await mine(ATHLETE_A);
    expect(after.json.data.resources.map((r: Json) => r.title)).toEqual([
      "E's link",
    ]);
    expect((await opened(ATHLETE_A, cAssignment)).status).toBe(404);
    // The offline cache learns about it through ?since=.
    const changes = await mine(ATHLETE_A, `?since=${encodeURIComponent(asOf)}`);
    expect(changes.json.data.deletedIds).toEqual([cAssignment]);
    // asOf trails the clock by a margin, so E's recent one comes back too.
    expect(changes.json.data.resources.map((r: Json) => r.title)).toEqual([
      "E's link",
    ]);
    // Coach C keeps the resource in their library.
    expect(
      (await http("GET", "/trainers/me/resources", COACH_C)).json.data
        .resources,
    ).toHaveLength(1);

    // Revive the same relationship row (as reconnecting does).
    await db
      .update(schema.ptClientRelationships)
      .set({ status: "active", endDate: null })
      .where(eq(schema.ptClientRelationships.trainerId, COACH_C));
    expect((await mine(ATHLETE_A)).json.data.resources).toHaveLength(1);
    expect((await clientList(COACH_C, ATHLETE_A)).json.data.resources).toEqual(
      [],
    );
  });

  it("a deleted coach account's resources disappear from the athlete's list", async () => {
    const res = await link(COACH_C);
    await assign(COACH_C, [res.id], [ATHLETE_A]);
    const asOf = (await mine(ATHLETE_A)).json.data.asOf;
    const assignmentId = (await mine(ATHLETE_A)).json.data.resources[0]
      .assignmentId;
    await db
      .update(schema.profiles)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(schema.profiles.id, COACH_C));
    // The non-since list filters on the relationship; the profile check
    // still hides it.
    expect((await mine(ATHLETE_A)).json.data.resources).toEqual([]);
    expect(
      (await mine(ATHLETE_A, `?since=${encodeURIComponent(asOf)}`)).json.data
        .deletedIds,
    ).toEqual([assignmentId]);
    expect((await opened(ATHLETE_A, assignmentId)).status).toBe(404);
  });
});

// ─── Design I test 2: https links and upload limits ─────────────────────────

describe("design I test 2: links must be https; upload limits apply", () => {
  it("refuses anything but an absolute https link", async () => {
    for (const url of [
      "http://example.com",
      "javascript:alert(1)",
      "ftp://example.com/file",
      "https:example.com",
      "https://",
      "example.com",
      "",
      `https://example.com/${"a".repeat(2000)}`,
    ]) {
      const res = await http("POST", "/trainers/me/resources", COACH_C, {
        kind: "link",
        title: "Bad",
        url,
      });
      expect([url.slice(0, 30), res.status]).toEqual([url.slice(0, 30), 422]);
      expect(res.json.code).toBe("invalid_resource");
      expect(res.json.errors).toContainEqual({
        at: "url",
        message: "must be an https link",
      });
    }
    const noUrl = await http("POST", "/trainers/me/resources", COACH_C, {
      kind: "link",
      title: "No url",
    });
    expect(noUrl.status).toBe(422);
    expect(await db.select().from(schema.coachResources)).toEqual([]);
    // The scheme's case is normalised for the column's CHECK.
    expect(cleanUrl("HTTPS://Example.com/Path")).toBe(
      "https://Example.com/Path",
    );
  });

  it("refuses a bad title and mixed kinds", async () => {
    const blank = await http("POST", "/trainers/me/resources", COACH_C, {
      kind: "link",
      title: "   ",
      url: "https://example.com",
    });
    expect(blank.status).toBe(422);
    expect(blank.json.errors).toEqual([
      { at: "title", message: "must be 1–120 characters" },
    ]);
    const long = await http("POST", "/trainers/me/resources", COACH_C, {
      kind: "link",
      title: "x".repeat(121),
      url: "https://example.com",
    });
    expect(long.status).toBe(422);
    const linkWithFile = await http("POST", "/trainers/me/resources", COACH_C, {
      kind: "link",
      title: "Mixed",
      url: "https://example.com",
      mediaId: randomUUID(),
    });
    expect(linkWithFile.json.errors).toContainEqual({
      at: "mediaId",
      message: "a link has no file",
    });
    const fileWithUrl = await http("POST", "/trainers/me/resources", COACH_C, {
      kind: "file",
      title: "Mixed",
      url: "https://example.com",
    });
    expect(fileWithUrl.status).toBe(422);
    expect(fileWithUrl.json.errors).toEqual([
      { at: "mediaId", message: "must be your uploaded file" },
      { at: "url", message: "a file has no link" },
    ]);
  });

  it("uploads are PDF, JPEG or PNG and at most 25 MB", async () => {
    const big = await http("POST", "/trainers/me/media/uploads", COACH_C, {
      purpose: "resource",
      contentType: "application/pdf",
      bytes: 25 * 1024 * 1024 + 1,
    });
    expect(big.status).toBe(422);
    const gif = await http("POST", "/trainers/me/media/uploads", COACH_C, {
      purpose: "resource",
      contentType: "image/gif",
      bytes: 100,
    });
    expect(gif.status).toBe(422);
    const ok = await http("POST", "/trainers/me/media/uploads", COACH_C, {
      purpose: "resource",
      contentType: "image/png",
      bytes: 25 * 1024 * 1024,
    });
    expect(ok.status).toBe(201);
    // Athletes can't make resource uploads.
    const athlete = await http(
      "POST",
      "/trainers/me/media/uploads",
      ATHLETE_A,
      {
        purpose: "resource",
        contentType: "application/pdf",
        bytes: 100,
      },
    );
    expect(athlete.status).toBe(403);
  });

  it("a file resource needs the coach's own finished upload; the object's real size is checked", async () => {
    const notUploaded = await upload(COACH_C, "application/pdf", 5000, false);
    const pending = await http("POST", "/trainers/me/resources", COACH_C, {
      kind: "file",
      title: "Guide",
      mediaId: notUploaded.mediaId,
    });
    expect(pending.status).toBe(422);
    expect(pending.json).toMatchObject({
      code: "upload_incomplete",
      reason: "missing",
    });

    // The phone uploaded more bytes than it declared.
    const lying = await upload(COACH_C, "application/pdf", 5000, false);
    const u = lying.upload;
    bucket.put(
      decodeURIComponent(new URL(u.url).pathname.slice(1)),
      "application/pdf",
      26 * 1024 * 1024,
    );
    const tooBig = await http("POST", "/trainers/me/resources", COACH_C, {
      kind: "file",
      title: "Guide",
      mediaId: lying.mediaId,
    });
    expect(tooBig.status).toBe(422);
    expect(tooBig.json.code).toBe("upload_incomplete");

    const others = await upload(COACH_E);
    const stolen = await http("POST", "/trainers/me/resources", COACH_C, {
      kind: "file",
      title: "Guide",
      mediaId: others.mediaId,
    });
    expect(stolen.status).toBe(422);
    expect(stolen.json.errors).toEqual([
      { at: "mediaId", message: "must be your uploaded file" },
    ]);

    const good = await upload(COACH_C, "application/pdf", 5000);
    const created = await http("POST", "/trainers/me/resources", COACH_C, {
      kind: "file",
      title: "  Meal guide ",
      mediaId: good.mediaId,
    });
    expect(created.status).toBe(201);
    expect(created.json.data).toMatchObject({
      kind: "file",
      title: "Meal guide",
      url: null,
      mediaId: good.mediaId,
      mime: "application/pdf",
      bytes: 5000,
      revision: 1,
      archivedAt: null,
    });
  });

  it("athletes get a short-lived signed link for files and the https url for links", async () => {
    const pdf = await file(COACH_C);
    const web = await link(COACH_C);
    await assign(COACH_C, [pdf.id, web.id], [ATHLETE_A]);
    const res = await mine(ATHLETE_A);
    expect(res.status).toBe(200);
    const byKind = Object.fromEntries(
      res.json.data.resources.map((r: Json) => [r.kind, r]),
    );
    const signed = new URL(byKind.file.url);
    expect(signed.pathname).toBe(
      `/resources/${COACH_C}/${pdf.mediaId}/file.pdf`,
    );
    expect(signed.searchParams.get("X-Amz-Expires")).toBe("900");
    expect(byKind.file).toMatchObject({
      resourceId: pdf.id,
      title: "Meal guide",
      mime: "application/pdf",
      bytes: 5000,
      coach: { id: COACH_C, name: "Ellie", avatarUrl: null },
      openedAt: null,
    });
    expect(Date.parse(byKind.file.urlExpiresAt)).toBeGreaterThan(Date.now());
    expect(byKind.link).toMatchObject({
      url: "https://example.com/mobility",
      urlExpiresAt: null,
      mime: null,
    });
  });
});

// ─── Design I test 5: idempotent bulk assign and opened stamp ───────────────

describe("design I test 5: bulk assign and the opened stamp are idempotent", () => {
  it("assigning the same resources to the same clients twice keeps one live assignment each", async () => {
    const one = await link(COACH_C, "One");
    const two = await link(COACH_C, "Two");
    const first = await assign(
      COACH_C,
      [one.id, two.id, one.id],
      [ATHLETE_A, ATHLETE_B],
      "bulk-1",
    );
    expect(first.status).toBe(201);
    expect(first.json.data.created).toBe(4);
    expect(first.json.data.assignments).toHaveLength(4);
    const again = await assign(
      COACH_C,
      [one.id, two.id],
      [ATHLETE_A, ATHLETE_B],
    );
    expect(again.status).toBe(200);
    expect(again.json.data.created).toBe(0);
    expect(
      again.json.data.assignments.map((a: Json) => a.assignmentId).sort(),
    ).toEqual(
      first.json.data.assignments.map((a: Json) => a.assignmentId).sort(),
    );
    // Adding one client later only creates theirs.
    const partial = await assign(COACH_C, [one.id], [ATHLETE_A]);
    expect(partial.json.data.created).toBe(0);
    expect(
      await db.select().from(schema.coachResourceAssignments),
    ).toHaveLength(4);
    const forA = await clientList(COACH_C, ATHLETE_A);
    expect(forA.json.data.resources).toHaveLength(2);
    expect(forA.json.data.resources[0]).toMatchObject({
      clientId: ATHLETE_A,
      openedAt: null,
    });
  });

  it("the first open is stamped once; the coach sees opened / not opened", async () => {
    const res = await link(COACH_C);
    await assign(COACH_C, [res.id], [ATHLETE_A]);
    const [mineRow] = (await mine(ATHLETE_A)).json.data.resources;
    const first = await opened(ATHLETE_A, mineRow.assignmentId);
    expect(first.status).toBe(200);
    expect(first.json.data.assignmentId).toBe(mineRow.assignmentId);
    const stamp = first.json.data.openedAt;
    const second = await opened(ATHLETE_A, mineRow.assignmentId);
    expect(second.json.data.openedAt).toBe(stamp);
    const tab = await clientList(COACH_C, ATHLETE_A);
    expect(tab.json.data.resources[0].openedAt).toBe(stamp);
    expect((await mine(ATHLETE_A)).json.data.resources[0].openedAt).toBe(stamp);
    expect((await opened(ATHLETE_A, randomUUID())).status).toBe(404);
  });

  it("removing an assignment hides it; assigning again is a new, unopened one", async () => {
    const res = await link(COACH_C);
    await assign(COACH_C, [res.id], [ATHLETE_A]);
    const [row] = (await clientList(COACH_C, ATHLETE_A)).json.data.resources;
    await opened(ATHLETE_A, row.assignmentId);
    const path = `/trainers/me/clients/${ATHLETE_A}/resources/${row.assignmentId}`;
    expect((await http("DELETE", path, COACH_C)).status).toBe(204);
    expect((await http("DELETE", path, COACH_C)).status).toBe(204);
    expect((await clientList(COACH_C, ATHLETE_A)).json.data.resources).toEqual(
      [],
    );
    expect((await mine(ATHLETE_A)).json.data.resources).toEqual([]);
    const again = await assign(COACH_C, [res.id], [ATHLETE_A]);
    expect(again.status).toBe(201);
    expect(again.json.data.assignments[0].assignmentId).not.toBe(
      row.assignmentId,
    );
    expect(again.json.data.assignments[0].openedAt).toBeNull();
  });
});

// ─── Library: create, edit, archive, sync ───────────────────────────────────

describe("library", () => {
  it("a retried create with the same Idempotency-Key returns the first resource", async () => {
    const first = await link(COACH_C, "Once", "res-key-1");
    const retry = await http(
      "POST",
      "/trainers/me/resources",
      COACH_C,
      { kind: "link", title: "Once", url: "https://example.com/mobility" },
      "res-key-1",
    );
    expect(retry.status).toBe(200);
    expect(retry.json.data.id).toBe(first.id);
    // Another coach's same key is their own.
    const other = await link(COACH_E, "Theirs", "res-key-1");
    expect(other.id).not.toBe(first.id);
    expect(await db.select().from(schema.coachResources)).toHaveLength(2);
  });

  it("edits carry an optional expectedRevision; stale ones get 409 with the current row", async () => {
    const res = await link(COACH_C);
    const path = `/trainers/me/resources/${res.id}`;
    const ok = await http("PATCH", path, COACH_C, {
      title: "Hip mobility",
      url: "https://example.com/hips",
      expectedRevision: 1,
    });
    expect(ok.status).toBe(200);
    expect(ok.json.data).toMatchObject({
      title: "Hip mobility",
      url: "https://example.com/hips",
      revision: 2,
    });
    const stale = await http("PATCH", path, COACH_C, {
      title: "Old edit",
      expectedRevision: 1,
    });
    expect(stale.status).toBe(409);
    expect(stale.json).toMatchObject({
      code: "revision_conflict",
      current: { title: "Hip mobility", revision: 2 },
    });
    // No revision (older clients): last write wins.
    const lww = await http("PATCH", path, COACH_C, { title: "Latest" });
    expect(lww.json.data).toMatchObject({ title: "Latest", revision: 3 });
    // Bad values.
    const bad = await http("PATCH", path, COACH_C, {
      title: "",
      url: "http://example.com",
    });
    expect(bad.status).toBe(422);
    expect(bad.json.errors.map((e: Json) => e.at)).toEqual(["title", "url"]);
    // A link has no file.
    const media = await upload(COACH_C);
    const mixed = await http("PATCH", path, COACH_C, {
      mediaId: media.mediaId,
    });
    expect(mixed.status).toBe(422);
    expect(mixed.json.errors).toEqual([
      { at: "mediaId", message: "a link has no file" },
    ]);
  });

  it("a file's upload can be replaced, but a file has no link", async () => {
    const pdf = await file(COACH_C);
    const path = `/trainers/me/resources/${pdf.id}`;
    const noLink = await http("PATCH", path, COACH_C, {
      url: "https://example.com",
    });
    expect(noLink.status).toBe(422);
    expect(noLink.json.errors).toEqual([
      { at: "url", message: "a file has no link" },
    ]);
    const png = await upload(COACH_C, "image/png", 777);
    const replaced = await http("PATCH", path, COACH_C, {
      mediaId: png.mediaId,
    });
    expect(replaced.status).toBe(200);
    expect(replaced.json.data).toMatchObject({
      mediaId: png.mediaId,
      mime: "image/png",
      bytes: 777,
    });
    const unfinished = await upload(COACH_C, "image/png", 10, false);
    const refused = await http("PATCH", path, COACH_C, {
      mediaId: unfinished.mediaId,
    });
    expect(refused.status).toBe(422);
    expect(refused.json.code).toBe("upload_incomplete");
    const missing = await http("PATCH", path, COACH_C, {
      mediaId: randomUUID(),
    });
    expect(missing.json.code).toBe("invalid_resource");
    expect(
      (
        await http("PATCH", `/trainers/me/resources/${randomUUID()}`, COACH_C, {
          title: "Nope",
        })
      ).status,
    ).toBe(404);
  });

  it("removing from the library is idempotent and hides it from every client; ?since= reports it", async () => {
    const keep = await link(COACH_C, "Keep");
    const drop = await link(COACH_C, "Drop");
    await assign(COACH_C, [keep.id, drop.id], [ATHLETE_A]);
    const athleteAsOf = (await mine(ATHLETE_A)).json.data.asOf;
    const libraryAsOf = (await http("GET", "/trainers/me/resources", COACH_C))
      .json.data.asOf;
    const dropAssignment = (await mine(ATHLETE_A)).json.data.resources.find(
      (r: Json) => r.title === "Drop",
    ).assignmentId;

    const path = `/trainers/me/resources/${drop.id}`;
    expect((await http("DELETE", path, COACH_C)).status).toBe(204);
    expect((await http("DELETE", path, COACH_C)).status).toBe(204);
    expect((await http("PATCH", path, COACH_C, { title: "x" })).status).toBe(
      404,
    );

    const library = await http("GET", "/trainers/me/resources", COACH_C);
    expect(library.json.data.resources.map((r: Json) => r.title)).toEqual([
      "Keep",
    ]);
    expect(library.json.data.deletedIds).toBeUndefined();
    const libraryChanges = await http(
      "GET",
      `/trainers/me/resources?since=${encodeURIComponent(libraryAsOf)}`,
      COACH_C,
    );
    expect(libraryChanges.json.data.deletedIds).toEqual([drop.id]);
    expect(
      libraryChanges.json.data.resources.map((r: Json) => r.title),
    ).toEqual(["Keep"]);

    expect(
      (await clientList(COACH_C, ATHLETE_A)).json.data.resources.map(
        (r: Json) => r.resource.title,
      ),
    ).toEqual(["Keep"]);
    const athleteChanges = await mine(
      ATHLETE_A,
      `?since=${encodeURIComponent(athleteAsOf)}`,
    );
    expect(athleteChanges.json.data.deletedIds).toEqual([dropAssignment]);
    expect((await opened(ATHLETE_A, dropAssignment)).status).toBe(404);
    // An archived resource can't be assigned.
    const late = await assign(COACH_C, [drop.id], [ATHLETE_B]);
    expect(late.status).toBe(404);
  });

  it("?since= returns what changed: new assignments and opened stamps", async () => {
    const res = await link(COACH_C);
    const asOf = (await mine(ATHLETE_A)).json.data.asOf;
    await assign(COACH_C, [res.id], [ATHLETE_A]);
    const changes = await mine(ATHLETE_A, `?since=${encodeURIComponent(asOf)}`);
    expect(changes.json.data.resources).toHaveLength(1);
    expect(changes.json.data.deletedIds).toEqual([]);
    const later = new Date(Date.now() + 60_000).toISOString();
    expect(
      (await mine(ATHLETE_A, `?since=${encodeURIComponent(later)}`)).json.data
        .resources,
    ).toEqual([]);
  });

  it("refuses a bad ?since=", async () => {
    expect((await mine(ATHLETE_A, "?since=yesterday")).status).toBe(400);
    expect(
      (await http("GET", "/trainers/me/resources?since=nope", COACH_C)).status,
    ).toBe(400);
  });
});

// ─── The `resource` set-up section (BE-A1 hook) ─────────────────────────────

describe("set-up section: resource", () => {
  async function prepared(items: unknown[]) {
    const profile = await http(
      "POST",
      "/trainers/me/client-profiles",
      COACH_C,
      {
        displayName: "Frankie",
      },
    );
    expect(profile.status).toBe(201);
    const id = profile.json.data.id as string;
    const put = await http(
      "PUT",
      `/trainers/me/client-profiles/${id}/setup/resource`,
      COACH_C,
      { items },
    );
    return { id, put };
  }

  it("is live, and only takes the coach's own live resources", async () => {
    expect(availableSections()).toContain("resource");
    const others = await link(COACH_E);
    const own = await link(COACH_C);
    const archived = await link(COACH_C, "Gone");
    await http("DELETE", `/trainers/me/resources/${archived.id}`, COACH_C);
    for (const items of [
      [{ sortOrder: 0, config: {} }],
      [{ sortOrder: 0, refId: others.id, config: {} }],
      [{ sortOrder: 0, refId: archived.id, config: {} }],
    ]) {
      const { put } = await prepared(items);
      expect(put.status).toBe(400);
      expect(put.json.code).toBe("invalid_setup");
    }
    const { put } = await prepared([
      { sortOrder: 0, refId: own.id, config: { extra: "dropped" } },
    ]);
    expect(put.status).toBe(200);
    expect(put.json.data.setup.resource).toEqual([
      expect.objectContaining({ refId: own.id, config: {} }),
    ]);
  });

  it("accepting the invite assigns the resources once; one removed from the library meanwhile is skipped", async () => {
    const one = await link(COACH_C, "One");
    const two = await link(COACH_C, "Two");
    const { id } = await prepared([
      { sortOrder: 0, refId: one.id, config: {} },
      { sortOrder: 1, refId: two.id, config: {} },
    ]);
    await http("DELETE", `/trainers/me/resources/${two.id}`, COACH_C);
    const declared = await http("POST", "/trainers/me/declaration", COACH_C, {
      statementVersion: currentDeclarationVersion(),
    });
    expect(declared.status).toBe(200);
    const invite = await http(
      "POST",
      `/trainers/me/client-profiles/${id}/invite`,
      COACH_C,
    );
    expect(invite.status).toBe(201);
    const accepted = await http(
      "POST",
      "/trainers/accept-invite-code",
      ATHLETE_F,
      {
        code: invite.json.data.code,
        consent: true,
        consentVersion: "v1-2026-07",
      },
    );
    expect(accepted.status).toBe(201);

    const athlete = await mine(ATHLETE_F);
    expect(athlete.json.data.resources.map((r: Json) => r.title)).toEqual([
      "One",
    ]);
    const items = await db
      .select()
      .from(schema.coachClientSetupItems)
      .where(eq(schema.coachClientSetupItems.section, "resource"));
    const byRef = Object.fromEntries(items.map((i) => [i.refId, i]));
    expect(byRef[one.id]!.materialisedRefId).toBe(
      athlete.json.data.resources[0].assignmentId,
    );
    expect(byRef[two.id]!.materialisedAt).not.toBeNull();
    expect(byRef[two.id]!.materialisedRefId).toBeNull();
  });

  it("copy-from takes this coach's live assignments for a client, never another coach's", async () => {
    const mineRes = await link(COACH_C, "Mine");
    const removed = await link(COACH_C, "Removed");
    const theirs = await link(COACH_E, "Theirs");
    await assign(COACH_C, [mineRes.id, removed.id], [ATHLETE_A]);
    await assign(COACH_E, [theirs.id], [ATHLETE_A]);
    const removedRow = (
      await clientList(COACH_C, ATHLETE_A)
    ).json.data.resources.find((r: Json) => r.resource.title === "Removed");
    await http(
      "DELETE",
      `/trainers/me/clients/${ATHLETE_A}/resources/${removedRow.assignmentId}`,
      COACH_C,
    );
    const { id } = await prepared([]);
    const copied = await http(
      "POST",
      `/trainers/me/client-profiles/${id}/setup/copy-from`,
      COACH_C,
      { sourceClientId: ATHLETE_A, sections: ["resource"] },
    );
    expect(copied.status).toBe(200);
    expect(copied.json.data.setup.resource.map((i: Json) => i.refId)).toEqual([
      mineRes.id,
    ]);
  });
});

// ─── Inspector Brad #563 ────────────────────────────────────────────────────

describe("Inspector Brad #563", () => {
  it("a ?since= list re-sends every visible file with a fresh link, but not an unchanged link", async () => {
    const pdf = await file(COACH_C);
    const web = await link(COACH_C);
    await assign(COACH_C, [pdf.id, web.id], [ATHLETE_A]);
    // Nothing changed after this point (asOf trails the clock, so use a
    // time after every write).
    const since = new Date(Date.now() + 60_000).toISOString();
    const res = await mine(ATHLETE_A, `?since=${encodeURIComponent(since)}`);
    expect(res.status).toBe(200);
    expect(res.json.data.deletedIds).toEqual([]);
    expect(res.json.data.resources).toHaveLength(1);
    const [row] = res.json.data.resources;
    expect(row).toMatchObject({ resourceId: pdf.id, kind: "file" });
    expect(new URL(row.url).pathname).toBe(
      `/resources/${COACH_C}/${pdf.mediaId}/file.pdf`,
    );
    expect(Date.parse(row.urlExpiresAt)).toBeGreaterThan(Date.now());
    // Once coaching ends the file isn't re-sent as visible.
    await end(COACH_C, ATHLETE_A);
    const after = await mine(ATHLETE_A, `?since=${encodeURIComponent(since)}`);
    expect(after.json.data.resources).toEqual([]);
  });

  it("bulk assign aborts when a relationship ends between the check and the insert", async () => {
    const res = await link(COACH_C);
    const rels = await db
      .select()
      .from(schema.ptClientRelationships)
      .where(eq(schema.ptClientRelationships.trainerId, COACH_C));
    const target = (clientId: string) => ({
      clientId,
      relationshipId: rels.find((r) => r.clientId === clientId)!.id,
    });
    const targets = [target(ATHLETE_A), target(ATHLETE_B)];
    const resources = await ownLiveResources(COACH_C, [res.id]);
    // The handler's resolveCoachScope passed; then A leaves.
    expect((await end(COACH_C, ATHLETE_A)).ok).toBe(true);
    const result = await bulkAssign(COACH_C, resources, targets, null);
    expect(result).toEqual({ ok: false, endedClientIds: [ATHLETE_A] });
    expect(await db.select().from(schema.coachResourceAssignments)).toEqual([]);
    // Another coach's relationship id is refused the same way.
    const eRel = (
      await db
        .select()
        .from(schema.ptClientRelationships)
        .where(eq(schema.ptClientRelationships.trainerId, COACH_E))
    )[0]!;
    expect(
      await bulkAssign(
        COACH_C,
        resources,
        [{ clientId: ATHLETE_A, relationshipId: eRel.id }],
        null,
      ),
    ).toEqual({ ok: false, endedClientIds: [ATHLETE_A] });
    const ok = await bulkAssign(COACH_C, resources, [target(ATHLETE_B)], null);
    expect(ok).toMatchObject({ ok: true, created: 1 });
  });
});

// ─── PER-150: follow-ups ────────────────────────────────────────────────────

const coaching = async (athlete: string) => {
  const res = await http("GET", "/users/me/coaching", athlete);
  expect(res.status).toBe(200);
  return res.json.data.coaches as Json[];
};

const resourcesSwitch = async (coach: string, client: string, on: boolean) => {
  const res = await http(
    "PATCH",
    `/trainers/me/clients/${client}/settings`,
    coach,
    { features: { resources: on } },
  );
  expect(res.status).toBe(200);
  expect(res.json.data.features.resources).toBe(on);
};

describe("PER-150: /users/me/coaching counts the athlete's visible resources", () => {
  it("counts per coach by the same rule as GET /users/me/resources", async () => {
    const [c1, c2, c3] = [
      await link(COACH_C, "One"),
      await link(COACH_C, "Two"),
      await file(COACH_C, "Three"),
    ];
    const fromE = await link(COACH_E, "E's link");
    await assign(COACH_C, [c1.id, c2.id, c3.id], [ATHLETE_A]);
    await assign(COACH_E, [fromE.id], [ATHLETE_A]);
    await assign(COACH_C, [c1.id], [ATHLETE_B]);

    const count = async (athlete: string) =>
      Object.fromEntries(
        (await coaching(athlete)).map((c) => [c.trainerId, c.resources]),
      );
    expect(await count(ATHLETE_A)).toEqual({ [COACH_C]: 3, [COACH_E]: 1 });
    expect(await count(ATHLETE_B)).toEqual({ [COACH_C]: 1 });

    // Removed from this client, and removed from the library: both drop out.
    const assignmentOfTwo = (
      await clientList(COACH_C, ATHLETE_A)
    ).json.data.resources.find(
      (r: Json) => r.resource.title === "Two",
    ).assignmentId;
    await http(
      "DELETE",
      `/trainers/me/clients/${ATHLETE_A}/resources/${assignmentOfTwo}`,
      COACH_C,
    );
    await http("DELETE", `/trainers/me/resources/${c3.id}`, COACH_C);
    expect(await count(ATHLETE_A)).toEqual({ [COACH_C]: 1, [COACH_E]: 1 });
    expect(
      (await mine(ATHLETE_A)).json.data.resources.filter(
        (r: Json) => r.coach.id === COACH_C,
      ),
    ).toHaveLength(1);
    // Opening doesn't change the count (it's what they have, not what's new).
    const one = (await mine(ATHLETE_A)).json.data.resources.find(
      (r: Json) => r.title === "One",
    );
    await opened(ATHLETE_A, one.assignmentId);
    expect((await count(ATHLETE_A))[COACH_C]).toBe(1);

    // Coaching with E ends: E's entry goes, C's count is untouched.
    await end(COACH_E, ATHLETE_A);
    expect(await count(ATHLETE_A)).toEqual({ [COACH_C]: 1 });
    // An athlete with no coaches.
    expect(await coaching(ATHLETE_F)).toEqual([]);
  });

  it("a coach with nothing assigned counts 0, and the entry keeps its PER-108 shape", async () => {
    const [entry] = await coaching(ATHLETE_B);
    expect(Object.keys(entry).sort()).toEqual(
      [
        "avatarUrl",
        "due",
        "features",
        "name",
        "newPlans",
        "relationshipId",
        "resources",
        "since",
        "trainerId",
      ].sort(),
    );
    expect(entry.resources).toBe(0);
  });
});

describe("PER-150: the C3.9 resources switch is enforced on the server", () => {
  it("while off, the athlete's list, opened stamp and count leave that coach out; on again brings them back", async () => {
    const fromC = await link(COACH_C, "C's link");
    const fileC = await file(COACH_C, "C's file");
    const fromE = await link(COACH_E, "E's link");
    await assign(COACH_C, [fromC.id, fileC.id], [ATHLETE_A]);
    await assign(COACH_E, [fromE.id], [ATHLETE_A]);
    const before = await mine(ATHLETE_A);
    const cIds = before.json.data.resources
      .filter((r: Json) => r.coach.id === COACH_C)
      .map((r: Json) => r.assignmentId)
      .sort();
    expect(cIds).toHaveLength(2);
    const asOf = before.json.data.asOf;

    await resourcesSwitch(COACH_C, ATHLETE_A, false);

    const off = await mine(ATHLETE_A);
    expect(off.json.data.resources.map((r: Json) => r.title)).toEqual([
      "E's link",
    ]);
    for (const id of cIds) {
      const stamp = await opened(ATHLETE_A, id);
      expect(stamp.status).toBe(404);
      expect(stamp.json.code).toBe("assignment_not_found");
    }
    const [row] = await db
      .select()
      .from(schema.coachResourceAssignments)
      .where(eq(schema.coachResourceAssignments.id, cIds[0]));
    expect(row!.openedAt).toBeNull();
    // The offline cache drops them through ?since=.
    const delta = await mine(ATHLETE_A, `?since=${encodeURIComponent(asOf)}`);
    expect([...delta.json.data.deletedIds].sort()).toEqual(cIds);
    expect(delta.json.data.resources.map((r: Json) => r.title)).toEqual([
      "E's link",
    ]);
    // A later delta neither re-sends C's file nor repeats its deletion.
    const offAsOf = new Date(Date.now() + 60_000).toISOString();
    const quiet = await mine(
      ATHLETE_A,
      `?since=${encodeURIComponent(offAsOf)}`,
    );
    expect(quiet.json.data).toMatchObject({ resources: [], deletedIds: [] });
    const coaches = Object.fromEntries(
      (await coaching(ATHLETE_A)).map((c) => [c.trainerId, c]),
    );
    expect(coaches[COACH_C]).toMatchObject({
      features: { resources: false },
      resources: 0,
    });
    expect(coaches[COACH_E].resources).toBe(1);
    // The assignments themselves are kept, not removed.
    expect(
      (await clientList(COACH_C, ATHLETE_A)).json.data.resources,
    ).toHaveLength(2);

    // Switching it back on: the next delta brings them back, links fresh.
    const offList = (await mine(ATHLETE_A)).json.data.asOf;
    await resourcesSwitch(COACH_C, ATHLETE_A, true);
    const back = await mine(ATHLETE_A, `?since=${encodeURIComponent(offList)}`);
    expect(
      back.json.data.resources
        .filter((r: Json) => r.coach.id === COACH_C)
        .map((r: Json) => r.assignmentId)
        .sort(),
    ).toEqual(cIds);
    const backFile = back.json.data.resources.find(
      (r: Json) => r.title === "C's file",
    );
    expect(backFile.url).toContain("X-Amz-Signature");
    expect((await opened(ATHLETE_A, cIds[0])).status).toBe(200);
    expect(
      (await coaching(ATHLETE_A)).find((c) => c.trainerId === COACH_C)
        .resources,
    ).toBe(2);
  });

  it("only the coach who switched it off is affected", async () => {
    const fromE = await link(COACH_E, "E's link");
    await assign(COACH_E, [fromE.id], [ATHLETE_A]);
    await resourcesSwitch(COACH_C, ATHLETE_A, false);
    expect(
      (await mine(ATHLETE_A)).json.data.resources.map((r: Json) => r.title),
    ).toEqual(["E's link"]);
    expect((await assign(COACH_E, [fromE.id], [ATHLETE_A])).status).toBe(200);
    // Another of C's clients is unaffected too.
    const fromC = await link(COACH_C);
    expect((await assign(COACH_C, [fromC.id], [ATHLETE_B])).status).toBe(201);
    expect((await mine(ATHLETE_B)).json.data.resources).toHaveLength(1);
  });

  it("the coach can't assign to that client while it's off: 403 resources_off, and nothing is assigned", async () => {
    const res = await link(COACH_C);
    await resourcesSwitch(COACH_C, ATHLETE_A, false);
    const refused = await assign(COACH_C, [res.id], [ATHLETE_A, ATHLETE_B]);
    expect(refused.status).toBe(403);
    expect(refused.json).toEqual({
      code: "resources_off",
      message: "Resources are switched off for this client",
      clientIds: [ATHLETE_A],
    });
    expect(await db.select().from(schema.coachResourceAssignments)).toEqual([]);
    // Someone who isn't the caller's client is still reported first.
    const notYours = await assign(COACH_C, [res.id], [ATHLETE_A, ATHLETE_F]);
    expect(notYours.status).toBe(403);
    expect(notYours.json).toMatchObject({
      code: "not_your_client",
      clientIds: [ATHLETE_F],
    });
    // On again: assigning works.
    await resourcesSwitch(COACH_C, ATHLETE_A, true);
    expect((await assign(COACH_C, [res.id], [ATHLETE_A])).status).toBe(201);
  });

  it("other switches and settings changes don't hide resources", async () => {
    const res = await link(COACH_C);
    await assign(COACH_C, [res.id], [ATHLETE_A]);
    await http("PATCH", `/trainers/me/clients/${ATHLETE_A}/settings`, COACH_C, {
      features: { photos: false, messages: false },
      alertMode: "mute",
    });
    expect((await mine(ATHLETE_A)).json.data.resources).toHaveLength(1);
    expect((await assign(COACH_C, [res.id], [ATHLETE_A])).status).toBe(200);
  });
});

describe("PER-150: unused resource uploads are purged", () => {
  const ageMedia = (ids: string[], days: number) =>
    pg.exec(
      `update private_media set created_at = now() - interval '${days} days' where id in (${ids
        .map((id) => `'${id}'`)
        .join(",")})`,
    );

  /** A finished upload the coach never saved as a resource. */
  async function unusedUpload(coach: string) {
    const media = await upload(coach);
    // The coach's own preview completes it, as the Add sheet does.
    expect(
      (await http("GET", `/users/me/media/${media.mediaId}`, coach)).status,
    ).toBe(200);
    return media.mediaId as string;
  }

  it("removes week-old uploads no resource uses, with their objects, and keeps the rest", async () => {
    const unused = await unusedUpload(COACH_C);
    const fresh = await unusedUpload(COACH_C);
    const neverPut = (await upload(COACH_C, "application/pdf", 10, false))
      .mediaId as string;
    const saved = await file(COACH_C, "Saved");
    const archived = await file(COACH_C, "Archived");
    await http("DELETE", `/trainers/me/resources/${archived.id}`, COACH_C);
    const swapped = await file(COACH_C, "Swapped");
    const oldFile = swapped.mediaId as string;
    const newFile = await upload(COACH_C, "image/png", 777);
    expect(
      (
        await http("PATCH", `/trainers/me/resources/${swapped.id}`, COACH_C, {
          mediaId: newFile.mediaId,
        })
      ).status,
    ).toBe(200);
    await ageMedia(
      [
        unused,
        neverPut,
        saved.mediaId,
        archived.mediaId,
        oldFile,
        newFile.mediaId,
      ],
      8,
    );
    await ageMedia([fresh], 6);

    expect(await purgeStaleMedia()).toBe(3);
    const left = (await db.select().from(schema.privateMedia))
      .map((m) => m.id)
      .sort();
    expect(left).toEqual(
      [fresh, saved.mediaId, archived.mediaId, newFile.mediaId].sort(),
    );
    expect(bucket.keys(`resources/${COACH_C}/${unused}/`)).toEqual([]);
    expect(bucket.keys(`resources/${COACH_C}/${oldFile}/`)).toEqual([]);
    expect(bucket.keys(`resources/${COACH_C}/${fresh}/`)).toHaveLength(1);
    expect(bucket.keys(`resources/${COACH_C}/${saved.mediaId}/`)).toHaveLength(
      1,
    );
    // Saved resources, archived ones included, keep their files.
    const resources = await db.select().from(schema.coachResources);
    expect(resources.every((r) => r.mediaId !== null)).toBe(true);
    // Idempotent: nothing more to do.
    expect(await purgeStaleMedia()).toBe(0);
  });

  it("the athlete still gets a working link for a saved file after the purge", async () => {
    const saved = await file(COACH_C, "Saved");
    await assign(COACH_C, [saved.id], [ATHLETE_A]);
    await ageMedia([saved.mediaId], 30);
    expect(await purgeStaleMedia()).toBe(0);
    const [res] = (await mine(ATHLETE_A)).json.data.resources;
    expect(res.url).toContain("X-Amz-Signature");
  });

  it("each coach's uploads are judged on their own: E's unused one goes, C's saved one stays", async () => {
    const unusedOfE = await unusedUpload(COACH_E);
    const savedOfC = await file(COACH_C, "C's own");
    await ageMedia([unusedOfE, savedOfC.mediaId], 8);
    expect(await purgeStaleMedia()).toBe(1);
    expect(
      (await db.select().from(schema.privateMedia)).map((m) => m.id),
    ).toEqual([savedOfC.mediaId]);
  });
});

// ─── Migration ──────────────────────────────────────────────────────────────

describe("migration", () => {
  it("applies twice, rolls back and re-applies, with RLS on, no policies and its checks", async () => {
    const fresh = await baseDatabase();
    try {
      const sql = await read(MIGRATIONS, MIGRATION);
      await fresh.exec(sql);
      await fresh.exec(sql);
      await fresh.exec(await read(ROLLBACKS, MIGRATION));
      const gone = await fresh.query<{ n: number }>(
        "select count(*)::int as n from pg_tables where tablename in ('coach_resources','coach_resource_assignments')",
      );
      expect(gone.rows[0]!.n).toBe(0);
      await fresh.exec(sql);
      const tables = await fresh.query<{ tablename: string; rls: boolean }>(
        "select tablename, rowsecurity as rls from pg_tables where tablename in ('coach_resources','coach_resource_assignments') order by 1",
      );
      expect(tables.rows).toEqual(
        ["coach_resource_assignments", "coach_resources"].map((tablename) => ({
          tablename,
          rls: true,
        })),
      );
      const policies = await fresh.query<{ n: number }>(
        "select count(*)::int as n from pg_policies where tablename in ('coach_resources','coach_resource_assignments')",
      );
      expect(policies.rows[0]!.n).toBe(0);

      const coach = randomUUID();
      const client = randomUUID();
      await fresh.exec(
        `insert into profiles (id) values ('${coach}'), ('${client}')`,
      );
      for (const bad of [
        `('${coach}', 'link', 'x', 'http://example.com')`,
        `('${coach}', 'link', 'x', null)`,
        `('${coach}', 'video', 'x', 'https://example.com')`,
        `('${coach}', 'file', 'x', 'https://example.com')`,
        `('${coach}', 'link', '', 'https://example.com')`,
      ]) {
        await expect(
          fresh.exec(
            `insert into coach_resources (trainer_id, kind, title, url) values ${bad}`,
          ),
        ).rejects.toThrow(/check/i);
      }
      const res = await fresh.query<{ id: string }>(
        `insert into coach_resources (trainer_id, kind, title, url) values ('${coach}', 'link', 'ok', 'https://example.com') returning id`,
      );
      const rel = await fresh.query<{ id: string }>(
        `insert into pt_client_relationships (trainer_id, client_id, status) values ('${coach}', '${client}', 'active') returning id`,
      );
      const values = `('${res.rows[0]!.id}', '${coach}', '${client}', '${rel.rows[0]!.id}')`;
      const insert = `insert into coach_resource_assignments (resource_id, trainer_id, client_id, relationship_id) values ${values}`;
      await fresh.exec(insert);
      // One live assignment per resource per relationship.
      await expect(fresh.exec(insert)).rejects.toThrow(/unique|duplicate/i);
      await fresh.exec(
        "update coach_resource_assignments set removed_at = now()",
      );
      await fresh.exec(insert);
    } finally {
      await fresh.close();
    }
  });
});
