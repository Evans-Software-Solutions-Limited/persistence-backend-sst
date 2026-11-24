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
 * PER-121 (BE-F1) — backend design F's tests, run against the REAL migrations
 * on PGlite through the real HTTP handlers, consent helper, offboarding and
 * form-response path. Only the edges are stubbed: the JWT (bearer token =
 * user id), push delivery, and S3 (an in-memory bucket behind a real
 * S3Client, so presigned URLs are really signed).
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
vi.mock("../../notifications/push/notificationDispatcher", () => ({
  NotificationDispatcher: class {
    createAndDispatch = vi.fn(async () => ({}));
    dispatchExisting = vi.fn(async () => {});
  },
}));
vi.mock("sst", () => ({
  Resource: { CoachPrivateMedia: { name: "private-media-test" } },
}));

import Elysia from "elysia";
import { coreErrorHandler } from "../../../shared/errorHandler";
import { coachingRoutes } from "../../coachingRoutes";
import { endCoachClientRelationship } from "../../relationships/endCoachClientRelationship";
import { setS3ClientForTests, deleteAllUserMedia } from "../privateMediaStore";
import { purgeStalePendingSets } from "../progressPhotoRepository";
import { finaliseMedia, purgeStaleMedia } from "../privateMediaRepository";
import {
  PHOTO_SHARING_CONSENT_VERSION,
  PHOTO_SHARING_COPY,
} from "../photoSharing";
import { FakeBucket } from "./fakeS3";

const MIGRATIONS = "../../../../../../supabase/migrations/";
const ROLLBACKS = "../../../../../../supabase/rollbacks/";
const read = (dir: string, file: string) =>
  readFile(new URL(`${dir}${file}`, import.meta.url), "utf8");
const MIGRATION = "20261123230832_progress_photos_private_media.sql";

const dialect = new PgDialect();

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
  schema.nutritionPlans,
  schema.nutritionPlanAssignments,
  schema.bodyMeasurements,
  schema.clientDataAccessLog,
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

/** A database with designs A and C applied, BEFORE this migration. */
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
  return pg;
}

const ATHLETE_A = randomUUID();
const ATHLETE_B = randomUUID();
const COACH_C = randomUUID(); // coaches A
const COACH_E = randomUUID(); // also coaches A (two coaches)
const COACH_D = randomUUID(); // coaches nobody

const NEW_TABLES = ["private_media", "progress_photos", "progress_photo_sets"];
const TRUNCATE = [
  ...NEW_TABLES,
  "coach_events",
  "coach_form_responses",
  "coach_form_requests",
  "coach_form_schedule_clients",
  "coach_form_schedules",
  "coach_form_versions",
  "coach_forms",
  "coach_client_settings",
  "coach_client_setup_items",
  "trainer_invite_codes",
  "coach_client_profiles",
  ...BASE_TABLES.map((t) => getTableConfig(t).name),
];

let pg: PGlite;
let db: ReturnType<typeof drizzle<typeof schema>>;
let bucket: FakeBucket;

const app = new Elysia().use(coreErrorHandler).use(coachingRoutes);

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

const POSES = [
  { pose: "front", bytes: 1000, width: 1536, height: 2048 },
  { pose: "side", bytes: 2000 },
  { pose: "back", bytes: 3000 },
];

const createSet = (
  athlete: string,
  takenOn = "2026-11-20",
  key?: string,
  poses: unknown[] = POSES,
) =>
  http("POST", "/users/me/progress-photos", athlete, { takenOn, poses }, key);

/** The phone's three PUTs, done right. */
function uploadAll(uploads: Json[]) {
  for (const u of uploads) {
    const key = decodeURIComponent(new URL(u.url).pathname.slice(1));
    bucket.put(
      key,
      u.headers["Content-Type"],
      Number(u.headers["Content-Length"]),
    );
  }
}

async function readySet(athlete: string, takenOn = "2026-11-20") {
  const created = await createSet(athlete, takenOn);
  expect(created.status).toBe(201);
  uploadAll(created.json.data.uploads);
  const done = await http(
    "POST",
    `/users/me/progress-photos/${created.json.data.set.id}/complete`,
    athlete,
  );
  expect(done.status).toBe(200);
  return done.json.data as Json;
}

const gallery = (coach: string, client: string, query = "") =>
  http("GET", `/trainers/me/clients/${client}/progress-photos${query}`, coach);

const share = (athlete: string) =>
  http("POST", "/users/me/progress-photos/sharing", athlete);

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
    { id: COACH_C, fullName: "Ellie", role: "personal_trainer" },
    { id: COACH_E, fullName: "Marcus", role: "physiotherapist" },
    { id: COACH_D, fullName: "Dana", role: "personal_trainer" },
  ]);
  await db.insert(schema.ptClientRelationships).values([
    { trainerId: COACH_C, clientId: ATHLETE_A, status: "active" },
    { trainerId: COACH_E, clientId: ATHLETE_A, status: "active" },
  ]);
});

afterEach(() => setS3ClientForTests(null));

// ─── Upload, complete, list ─────────────────────────────────────────────────

describe("design F test 2: uploads are pinned to key, type and size", () => {
  it("create returns a pending set and three presigned PUTs pinned to the set's keys", async () => {
    const res = await createSet(ATHLETE_A);
    expect(res.status).toBe(201);
    const { set, uploads } = res.json.data;
    expect(set).toMatchObject({
      takenOn: "2026-11-20",
      source: "self",
      status: "pending",
      photos: [],
    });
    expect(uploads.map((u: Json) => u.pose)).toEqual(["front", "side", "back"]);
    for (const u of uploads) {
      const url = new URL(u.url);
      expect(url.pathname).toBe(
        `/pending/progress/${ATHLETE_A}/${set.id}/${u.pose}.jpg`,
      );
      expect(url.searchParams.get("X-Amz-SignedHeaders")).toBe(
        "content-length;content-type;host",
      );
      expect(url.searchParams.get("X-Amz-Expires")).toBe("600");
      expect(u.method).toBe("PUT");
      expect(u.headers["Content-Type"]).toBe("image/jpeg");
    }
    expect(uploads.map((u: Json) => u.headers["Content-Length"])).toEqual([
      "1000",
      "2000",
      "3000",
    ]);
    // Nothing shows in the gallery until complete.
    const list = await http("GET", "/users/me/progress-photos", ATHLETE_A);
    expect(list.json.data.sets).toEqual([]);
  });

  it("refuses a set without all three poses, a repeated pose, a file over 10 MB or a bad date", async () => {
    const missing = await createSet(
      ATHLETE_A,
      "2026-11-20",
      undefined,
      POSES.slice(0, 2),
    );
    expect(missing.status).toBe(422);
    expect(missing.json.code).toBe("invalid_photo_set");
    expect(missing.json.errors).toContainEqual({
      at: "poses",
      message: "back is missing",
    });
    const repeated = await createSet(ATHLETE_A, "2026-11-20", undefined, [
      POSES[0],
      POSES[0],
      POSES[2],
    ]);
    expect(repeated.status).toBe(422);
    expect(repeated.json.errors).toContainEqual({
      at: "poses.1.pose",
      message: "each pose only once",
    });
    const big = await createSet(ATHLETE_A, "2026-11-20", undefined, [
      { pose: "front", bytes: 10 * 1024 * 1024 + 1 },
      POSES[1],
      POSES[2],
    ]);
    expect(big.status).toBe(422);
    expect(big.json.errors[0].at).toBe("poses.0.bytes");
    const zero = await createSet(ATHLETE_A, "2026-11-20", undefined, [
      { pose: "front", bytes: 0 },
      POSES[1],
      POSES[2],
    ]);
    expect(zero.status).toBe(422);
    for (const takenOn of [
      "2026-02-30",
      "20-11-2026",
      "1969-12-31",
      "2999-01-01",
    ]) {
      const bad = await createSet(ATHLETE_A, takenOn);
      expect([takenOn, bad.status]).toEqual([takenOn, 422]);
    }
    expect(await db.select().from(schema.progressPhotoSets)).toEqual([]);
  });

  it("complete fails while a pose is missing, then succeeds once it's uploaded", async () => {
    const created = (await createSet(ATHLETE_A)).json.data;
    uploadAll(created.uploads.slice(0, 2));
    const first = await http(
      "POST",
      `/users/me/progress-photos/${created.set.id}/complete`,
      ATHLETE_A,
    );
    expect(first.status).toBe(422);
    expect(first.json).toMatchObject({
      code: "upload_incomplete",
      poses: [{ pose: "back", reason: "missing" }],
    });
    // The two good poses were checked and promoted out of pending/.
    expect(bucket.keys(`progress/${ATHLETE_A}/${created.set.id}/`)).toEqual([
      `progress/${ATHLETE_A}/${created.set.id}/front.jpg`,
      `progress/${ATHLETE_A}/${created.set.id}/side.jpg`,
    ]);
    expect(bucket.keys("pending/")).toEqual([]);
    uploadAll(created.uploads.slice(2));
    const second = await http(
      "POST",
      `/users/me/progress-photos/${created.set.id}/complete`,
      ATHLETE_A,
    );
    expect(second.status).toBe(200);
    expect(second.json.data.status).toBe("ready");
    expect(second.json.data.photos.map((p: Json) => p.pose)).toEqual([
      "front",
      "side",
      "back",
    ]);
    // Idempotent: completing again changes nothing and needs no S3 checks.
    const heads = bucket.sent.filter((s) => s === "HeadObjectCommand").length;
    const again = await http(
      "POST",
      `/users/me/progress-photos/${created.set.id}/complete`,
      ATHLETE_A,
    );
    expect(again.status).toBe(200);
    expect(again.json.data.id).toBe(created.set.id);
    expect(bucket.sent.filter((s) => s === "HeadObjectCommand").length).toBe(
      heads,
    );
  });

  it("complete refuses an object that is too large, not a JPEG or not the pinned size, and deletes it", async () => {
    const created = (await createSet(ATHLETE_A)).json.data;
    const key = (pose: string) =>
      `pending/progress/${ATHLETE_A}/${created.set.id}/${pose}.jpg`;
    bucket.put(key("front"), "image/jpeg", 10 * 1024 * 1024 + 5);
    bucket.put(key("side"), "image/heic", 2000);
    bucket.put(key("back"), "image/jpeg", 2999);
    const res = await http(
      "POST",
      `/users/me/progress-photos/${created.set.id}/complete`,
      ATHLETE_A,
    );
    expect(res.status).toBe(422);
    expect(res.json.poses).toEqual([
      { pose: "front", reason: "too_large" },
      { pose: "side", reason: "wrong_type" },
      { pose: "back", reason: "size_mismatch" },
    ]);
    expect(bucket.keys()).toEqual([]);
    const [set] = await db.select().from(schema.progressPhotoSets);
    expect(set!.status).toBe("pending");
  });

  it("complete of an unknown or deleted set is 404", async () => {
    const res = await http(
      "POST",
      `/users/me/progress-photos/${randomUUID()}/complete`,
      ATHLETE_A,
    );
    expect(res.status).toBe(404);
    expect(res.json.code).toBe("set_not_found");
  });

  it("a ready set lists with signed 15-minute view links, never the raw key, newest date first", async () => {
    await readySet(ATHLETE_A, "2026-11-01");
    const newer = await readySet(ATHLETE_A, "2026-11-15");
    const res = await http("GET", "/users/me/progress-photos", ATHLETE_A);
    expect(res.status).toBe(200);
    const { sets, asOf } = res.json.data;
    expect(sets.map((s: Json) => s.takenOn)).toEqual([
      "2026-11-15",
      "2026-11-01",
    ]);
    expect(sets[0].id).toBe(newer.id);
    expect(res.json.data).not.toHaveProperty("deletedIds");
    expect(typeof asOf).toBe("string");
    const front = sets[0].photos[0];
    expect(front).toMatchObject({
      pose: "front",
      bytes: 1000,
      width: 1536,
      height: 2048,
    });
    expect(new URL(front.url).searchParams.get("X-Amz-Expires")).toBe("900");
    expect(JSON.stringify(sets)).not.toContain('"s3Key"');
  });
});

describe("Inspector Brad #553 sweep 1", () => {
  it("a late duplicate PUT after complete can't get a ready photo deleted by the lifecycle rule", async () => {
    const created = (await createSet(ATHLETE_A)).json.data;
    uploadAll(created.uploads);
    const id = created.set.id;
    expect(
      (
        await http(
          "POST",
          `/users/me/progress-photos/${id}/complete`,
          ATHLETE_A,
        )
      ).status,
    ).toBe(200);
    // The phone's first, timed-out PUT lands late through the same links.
    uploadAll(created.uploads);
    bucket.expireLifecycle();
    for (const pose of ["front", "side", "back"]) {
      expect(
        bucket.objects.has(`progress/${ATHLETE_A}/${id}/${pose}.jpg`),
      ).toBe(true);
    }
  });

  it("a complete racing the stale-set sweep answers 404 once the set is gone", async () => {
    const created = (await createSet(ATHLETE_A)).json.data;
    uploadAll(created.uploads);
    let removal: Promise<unknown> | null = null;
    bucket.onDelete = () => {
      bucket.onDelete = null;
      removal = pg.exec(
        `delete from progress_photo_sets where id = '${created.set.id}'`,
      );
    };
    const res = await http(
      "POST",
      `/users/me/progress-photos/${created.set.id}/complete`,
      ATHLETE_A,
    );
    await removal;
    expect(res.status).toBe(404);
    expect(res.json.code).toBe("set_not_found");
  });

  it("the stale-upload sweep never deletes the object of a photo attached while it runs", async () => {
    const req = await (async () => {
      const form = await http("POST", "/trainers/me/forms", COACH_C, {
        title: "Check-in",
        questions: [
          { id: "mood", type: "scale", prompt: "Mood", required: true },
        ],
      });
      await http("POST", "/trainers/me/form-schedules", COACH_C, {
        formId: form.json.data.id,
        trigger: "once",
        audience: "selected",
        clientIds: [ATHLETE_A],
      });
      const list = await http("GET", "/users/me/form-requests", ATHLETE_A);
      return list.json.data.requests[0];
    })();
    const response = await http(
      "POST",
      `/users/me/form-requests/${req.id}/response`,
      ATHLETE_A,
      { answers: { mood: 3 } },
    );
    const media = (
      await http("POST", "/users/me/media/uploads", ATHLETE_A, {
        purpose: "form_answer",
        contentType: "image/jpeg",
        bytes: 10,
      })
    ).json.data;
    await http("GET", `/users/me/media/${media.mediaId}`, ATHLETE_A); // 409
    bucket.put(`forms/${ATHLETE_A}/${media.mediaId}.jpg`, "image/jpeg", 10, {
      upload: "complete",
    });
    await pg.exec(
      `update private_media set status = 'ready', created_at = now() - interval '8 days' where id = '${media.mediaId}'`,
    );
    // A submit attaches the photo while the sweep is deleting objects.
    let attach: Promise<unknown> | null = null;
    bucket.onDelete = () => {
      bucket.onDelete = null;
      attach = db
        .update(schema.privateMedia)
        .set({ formResponseId: response.json.data.id })
        .where(eq(schema.privateMedia.id, media.mediaId))
        .execute(); // drizzle builders are lazy: start it now
    };
    await purgeStaleMedia();
    await attach;
    const rows = await db.select().from(schema.privateMedia);
    // Either the row went with its object, or both are still there.
    if (rows.length > 0) {
      expect(
        bucket.objects.has(`forms/${ATHLETE_A}/${media.mediaId}.jpg`),
      ).toBe(true);
    }
  });
});

describe("design F test 3: a retried create returns the same set", () => {
  it("same Idempotency-Key → same set, fresh links only for poses not yet completed", async () => {
    const first = await createSet(ATHLETE_A, "2026-11-20", "photos-key-1");
    expect(first.status).toBe(201);
    const id = first.json.data.set.id;
    uploadAll(first.json.data.uploads.slice(0, 1));
    await http("POST", `/users/me/progress-photos/${id}/complete`, ATHLETE_A);

    const retry = await createSet(ATHLETE_A, "2026-11-20", "photos-key-1");
    expect(retry.status).toBe(200);
    expect(retry.json.data.set.id).toBe(id);
    expect(retry.json.data.uploads.map((u: Json) => u.pose)).toEqual([
      "side",
      "back",
    ]);
    expect(await db.select().from(schema.progressPhotoSets)).toHaveLength(1);

    // The same key from another athlete is a different set.
    const other = await createSet(ATHLETE_B, "2026-11-20", "photos-key-1");
    expect(other.status).toBe(201);
    expect(other.json.data.set.id).not.toBe(id);
  });

  it("a retry after the set is ready returns it with no uploads; after delete it's 409", async () => {
    const created = await createSet(ATHLETE_A, "2026-11-20", "k2");
    uploadAll(created.json.data.uploads);
    const id = created.json.data.set.id;
    await http("POST", `/users/me/progress-photos/${id}/complete`, ATHLETE_A);
    const retry = await createSet(ATHLETE_A, "2026-11-20", "k2");
    expect(retry.status).toBe(200);
    expect(retry.json.data.uploads).toEqual([]);
    expect(retry.json.data.set.status).toBe("ready");
    expect(retry.json.data.set.photos).toHaveLength(3);
    await http("DELETE", `/users/me/progress-photos/${id}`, ATHLETE_A);
    const gone = await createSet(ATHLETE_A, "2026-11-20", "k2");
    expect(gone.status).toBe(409);
    expect(gone.json.code).toBe("set_deleted");
  });

  it("two racing creates with one key make one set", async () => {
    const [a, b] = await Promise.all([
      createSet(ATHLETE_A, "2026-11-20", "race"),
      createSet(ATHLETE_A, "2026-11-20", "race"),
    ]);
    expect(a.json.data.set.id).toBe(b.json.data.set.id);
    expect(await db.select().from(schema.progressPhotoSets)).toHaveLength(1);
    expect(await db.select().from(schema.progressPhotos)).toHaveLength(3);
  });
});

describe("design F test 4: deleting removes the files; the purge removes everything", () => {
  it("delete removes the objects and photo rows, leaves a tombstone for ?since=, and is idempotent", async () => {
    const before = new Date(Date.now() - 1000).toISOString();
    const set = await readySet(ATHLETE_A);
    const keep = await readySet(ATHLETE_A, "2026-11-10");
    expect(bucket.keys(`progress/${ATHLETE_A}/${set.id}/`)).toHaveLength(3);
    const del = await http(
      "DELETE",
      `/users/me/progress-photos/${set.id}`,
      ATHLETE_A,
    );
    expect(del.status).toBe(204);
    expect(bucket.keys(`progress/${ATHLETE_A}/${set.id}/`)).toEqual([]);
    expect(bucket.keys(`progress/${ATHLETE_A}/${keep.id}/`)).toHaveLength(3);
    expect(
      await db
        .select()
        .from(schema.progressPhotos)
        .where(eq(schema.progressPhotos.setId, set.id)),
    ).toEqual([]);
    const again = await http(
      "DELETE",
      `/users/me/progress-photos/${set.id}`,
      ATHLETE_A,
    );
    expect(again.status).toBe(204);
    const unknown = await http(
      "DELETE",
      `/users/me/progress-photos/${randomUUID()}`,
      ATHLETE_A,
    );
    expect(unknown.status).toBe(204);

    const full = await http("GET", "/users/me/progress-photos", ATHLETE_A);
    expect(full.json.data.sets.map((s: Json) => s.id)).toEqual([keep.id]);
    const changes = await http(
      "GET",
      `/users/me/progress-photos?since=${encodeURIComponent(before)}`,
      ATHLETE_A,
    );
    expect(changes.json.data.deletedIds).toEqual([set.id]);
    expect(changes.json.data.sets.map((s: Json) => s.id)).toEqual([keep.id]);
    const bad = await http(
      "GET",
      "/users/me/progress-photos?since=nope",
      ATHLETE_A,
    );
    expect(bad.status).toBe(400);
  });

  it("a delete whose S3 call fails keeps the set, so the retry can finish it", async () => {
    const set = await readySet(ATHLETE_A);
    bucket.failures.set("DeleteObjectsCommand", new Error("S3 down"));
    const res = await http(
      "DELETE",
      `/users/me/progress-photos/${set.id}`,
      ATHLETE_A,
    );
    expect(res.status).toBe(500);
    bucket.failures.clear();
    const list = await http("GET", "/users/me/progress-photos", ATHLETE_A);
    expect(list.json.data.sets).toHaveLength(1);
    expect(
      (await http("DELETE", `/users/me/progress-photos/${set.id}`, ATHLETE_A))
        .status,
    ).toBe(204);
    expect(bucket.keys()).toEqual([]);
  });

  it("the account purge removes every object under the user's prefixes", async () => {
    await readySet(ATHLETE_A);
    await readySet(ATHLETE_B);
    const media = await http("POST", "/users/me/media/uploads", ATHLETE_A, {
      purpose: "form_answer",
      contentType: "image/jpeg",
      bytes: 10,
    });
    bucket.put(
      `forms/${ATHLETE_A}/${media.json.data.mediaId}.jpg`,
      "image/jpeg",
      10,
    );
    bucket.put(`resources/${ATHLETE_A}/x/file.pdf`, "application/pdf", 10);
    await deleteAllUserMedia(ATHLETE_A);
    expect(bucket.keys().filter((k) => k.includes(ATHLETE_A))).toEqual([]);
    expect(bucket.keys(`progress/${ATHLETE_B}/`)).toHaveLength(3);
  });

  it("the nightly clean-up removes sets and uploads never completed, with their objects", async () => {
    const stale = (await createSet(ATHLETE_A)).json.data;
    uploadAll(stale.uploads.slice(0, 1));
    await http(
      "POST",
      `/users/me/progress-photos/${stale.set.id}/complete`,
      ATHLETE_A,
    );
    const fresh = (await createSet(ATHLETE_A, "2026-11-21")).json.data;
    const ready = await readySet(ATHLETE_A, "2026-11-01");
    const unused = (
      await http("POST", "/users/me/media/uploads", ATHLETE_A, {
        purpose: "form_answer",
        contentType: "image/jpeg",
        bytes: 10,
      })
    ).json.data;
    await pg.exec(
      `update progress_photo_sets set created_at = now() - interval '3 days' where id in ('${stale.set.id}', '${ready.id}');
       update private_media set created_at = now() - interval '3 days' where id = '${unused.mediaId}';`,
    );
    expect(await purgeStalePendingSets()).toBe(1);
    expect(await purgeStaleMedia()).toBe(1);
    const ids = (await db.select().from(schema.progressPhotoSets)).map(
      (s) => s.id,
    );
    expect(ids.sort()).toEqual([fresh.set.id, ready.id].sort());
    expect(bucket.keys(`progress/${ATHLETE_A}/${stale.set.id}/`)).toEqual([]);
    expect(await db.select().from(schema.privateMedia)).toEqual([]);
    expect(await purgeStalePendingSets()).toBe(0);
    expect(await purgeStaleMedia()).toBe(0);
  });
});

describe("design F test 5: nearest weight and body fat within 7 days", () => {
  it("picks the nearest measurement with each value, within 7 days, or nothing", async () => {
    const at = (iso: string) => new Date(iso);
    await db.insert(schema.bodyMeasurements).values([
      {
        userId: ATHLETE_A,
        weightKg: "80.00",
        measuredAt: at("2026-11-14T08:00:00Z"),
      },
      {
        userId: ATHLETE_A,
        weightKg: "79.50",
        measuredAt: at("2026-11-18T08:00:00Z"),
      },
      {
        userId: ATHLETE_A,
        bodyFatPercentage: "18.50",
        measuredAt: at("2026-11-26T08:00:00Z"),
      },
      // Out of the window for 2026-11-20, and another athlete's.
      {
        userId: ATHLETE_A,
        bodyFatPercentage: "30.00",
        measuredAt: at("2026-12-10T08:00:00Z"),
      },
      {
        userId: ATHLETE_B,
        weightKg: "60.00",
        measuredAt: at("2026-11-20T08:00:00Z"),
      },
    ]);
    await readySet(ATHLETE_A, "2026-11-20");
    await readySet(ATHLETE_A, "2026-10-01");
    const res = await http("GET", "/users/me/progress-photos", ATHLETE_A);
    const [nov, oct] = res.json.data.sets;
    expect(nov.weight).toEqual({
      kg: 79.5,
      measuredAt: "2026-11-18T08:00:00.000Z",
    });
    expect(nov.bodyFat).toEqual({
      percentage: 18.5,
      measuredAt: "2026-11-26T08:00:00.000Z",
    });
    expect(oct.weight).toBeNull();
    expect(oct.bodyFat).toBeNull();
  });
});

// ─── Isolation ──────────────────────────────────────────────────────────────

describe("design F test 1: isolation", () => {
  it("athlete B can't see, complete or delete athlete A's sets", async () => {
    const pending = (await createSet(ATHLETE_A)).json.data.set;
    const ready = await readySet(ATHLETE_A, "2026-11-01");
    const list = await http("GET", "/users/me/progress-photos", ATHLETE_B);
    expect(list.json.data.sets).toEqual([]);
    const complete = await http(
      "POST",
      `/users/me/progress-photos/${pending.id}/complete`,
      ATHLETE_B,
    );
    expect(complete.status).toBe(404);
    const del = await http(
      "DELETE",
      `/users/me/progress-photos/${ready.id}`,
      ATHLETE_B,
    );
    expect(del.status).toBe(204);
    expect(bucket.keys(`progress/${ATHLETE_A}/${ready.id}/`)).toHaveLength(3);
    const mine = await http("GET", "/users/me/progress-photos", ATHLETE_A);
    expect(mine.json.data.sets.map((s: Json) => s.id)).toEqual([ready.id]);
  });

  it("unauthenticated requests are refused", async () => {
    expect((await http("GET", "/users/me/progress-photos", null)).status).toBe(
      401,
    );
    expect((await gallery("", ATHLETE_A)).status).toBe(401);
  });

  it("coach D (not their coach) gets 403", async () => {
    await readySet(ATHLETE_A);
    await share(ATHLETE_A);
    const res = await gallery(COACH_D, ATHLETE_A);
    expect(res.status).toBe(403);
    expect(res.json.code).toBe("not_your_client");
  });

  it("an athlete calling the coach route gets 403", async () => {
    const res = await gallery(ATHLETE_B, ATHLETE_A);
    expect(res.status).toBe(403);
    expect(res.json.code).toBe("not_a_trainer");
  });

  it("a coach without the photo-sharing consent gets 403; with it, 5-minute links", async () => {
    await readySet(ATHLETE_A);
    const refused = await gallery(COACH_C, ATHLETE_A);
    expect(refused.status).toBe(403);
    expect(refused.json.code).toBe("photo_sharing_not_granted");

    await share(ATHLETE_A);
    const res = await gallery(COACH_C, ATHLETE_A);
    expect(res.status).toBe(200);
    expect(res.json.data.sets).toHaveLength(1);
    const url = new URL(res.json.data.sets[0].photos[0].url);
    expect(url.searchParams.get("X-Amz-Expires")).toBe("300");
    // Offline sync for the coach: changes since, with deletes.
    const since = new Date(Date.now() - 60_000).toISOString();
    const set = res.json.data.sets[0];
    await http("DELETE", `/users/me/progress-photos/${set.id}`, ATHLETE_A);
    const changes = await gallery(
      COACH_C,
      ATHLETE_A,
      `?since=${encodeURIComponent(since)}`,
    );
    expect(changes.json.data).toMatchObject({ sets: [], deletedIds: [set.id] });
    expect((await gallery(COACH_C, ATHLETE_A, "?since=nope")).status).toBe(400);
    // The read is audited.
    const audit = await db.select().from(schema.clientDataAccessLog);
    expect(audit).toMatchObject([
      {
        trainerId: COACH_C,
        clientId: ATHLETE_A,
        dataCategory: "progress_photos",
      },
    ]);
  });

  it("two coaches: a consent given before coach E joined doesn't cover E", async () => {
    await db
      .update(schema.ptClientRelationships)
      .set({ status: "pending" })
      .where(eq(schema.ptClientRelationships.trainerId, COACH_E));
    await readySet(ATHLETE_A);
    const shared = await share(ATHLETE_A);
    expect(shared.json.data.coaches).toEqual([
      { trainerId: COACH_C, name: "Ellie", sharing: true },
    ]);
    // E becomes a coach later.
    await db
      .update(schema.ptClientRelationships)
      .set({ status: "active" })
      .where(eq(schema.ptClientRelationships.trainerId, COACH_E));
    expect((await gallery(COACH_C, ATHLETE_A)).status).toBe(200);
    expect((await gallery(COACH_E, ATHLETE_A)).status).toBe(403);
    const status = await http(
      "GET",
      "/users/me/progress-photos/sharing",
      ATHLETE_A,
    );
    expect(status.json.data.needsPrompt).toBe(true);
    await share(ATHLETE_A);
    expect((await gallery(COACH_E, ATHLETE_A)).status).toBe(200);
  });

  it("a coach with the photos switch off gets 403", async () => {
    await readySet(ATHLETE_A);
    await share(ATHLETE_A);
    const off = await http(
      "PATCH",
      `/trainers/me/clients/${ATHLETE_A}/settings`,
      COACH_C,
      { features: { photos: false } },
    );
    expect(off.status).toBe(200);
    const res = await gallery(COACH_C, ATHLETE_A);
    expect(res.status).toBe(403);
    expect(res.json.code).toBe("photos_off");
    // Coach E's own switch is still on.
    expect((await gallery(COACH_E, ATHLETE_A)).status).toBe(200);
  });

  it("after coaching ends the coach's next request gets 403, and re-joining needs a new consent", async () => {
    await readySet(ATHLETE_A);
    await share(ATHLETE_A);
    expect((await gallery(COACH_C, ATHLETE_A)).status).toBe(200);
    await endCoachClientRelationship({
      trainerId: COACH_C,
      clientId: ATHLETE_A,
      initiatedBy: "client",
    });
    const ended = await gallery(COACH_C, ATHLETE_A);
    expect(ended.status).toBe(403);
    // Coach E is unaffected.
    expect((await gallery(COACH_E, ATHLETE_A)).status).toBe(200);

    // Coaching starts again: the old grant doesn't come back.
    await db
      .update(schema.ptClientRelationships)
      .set({ status: "active" })
      .where(eq(schema.ptClientRelationships.trainerId, COACH_C));
    const again = await gallery(COACH_C, ATHLETE_A);
    expect(again.status).toBe(403);
    expect(again.json.code).toBe("photo_sharing_not_granted");
  });
});

describe("the one-time photo-sharing consent", () => {
  it("writes one grant per active coach with source photo_sharing_prompt, once", async () => {
    const before = await http(
      "GET",
      "/users/me/progress-photos/sharing",
      ATHLETE_A,
    );
    expect(before.json.data).toEqual({
      needsPrompt: true,
      coaches: [
        { trainerId: COACH_C, name: "Ellie", sharing: false },
        { trainerId: COACH_E, name: "Marcus", sharing: false },
      ],
      consentVersion: PHOTO_SHARING_CONSENT_VERSION,
      copy: PHOTO_SHARING_COPY,
    });
    const first = await share(ATHLETE_A);
    expect(first.json.data.needsPrompt).toBe(false);
    await share(ATHLETE_A);
    const rows = await db.select().from(schema.dataSharingConsents);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.action === "grant")).toBe(true);
    expect(rows.every((r) => r.source === "photo_sharing_prompt")).toBe(true);
    expect(
      rows.every((r) => r.consentVersion === PHOTO_SHARING_CONSENT_VERSION),
    ).toBe(true);
    // The gallery list carries the same status for the app's prompt.
    const list = await http("GET", "/users/me/progress-photos", ATHLETE_A);
    expect(list.json.data.photoSharing.needsPrompt).toBe(false);
  });

  it("an athlete with no coaches has nothing to confirm; AI coaches are never offered", async () => {
    await db.insert(schema.ptClientRelationships).values({
      trainerId: COACH_D,
      clientId: ATHLETE_B,
      status: "active",
      isAiTrainer: true,
    });
    const res = await share(ATHLETE_B);
    expect(res.json.data).toMatchObject({ needsPrompt: false, coaches: [] });
    expect(
      await db
        .select()
        .from(schema.dataSharingConsents)
        .where(eq(schema.dataSharingConsents.clientId, ATHLETE_B)),
    ).toEqual([]);
  });
});

// ─── Private media ──────────────────────────────────────────────────────────

describe("POST /users/me/media/uploads and /trainers/me/media/uploads", () => {
  it("a form photo upload is JPEG only and ≤ 10 MB, pinned to forms/<user>/<mediaId>.jpg", async () => {
    const res = await http(
      "POST",
      "/users/me/media/uploads",
      ATHLETE_A,
      { purpose: "form_answer", contentType: "image/jpeg", bytes: 4096 },
      "media-1",
    );
    expect(res.status).toBe(201);
    const media = res.json.data;
    expect(media).toMatchObject({
      purpose: "form_answer",
      contentType: "image/jpeg",
      bytes: 4096,
      status: "pending",
    });
    const url = new URL(media.upload.url);
    expect(url.pathname).toBe(
      `/pending/forms/${ATHLETE_A}/${media.mediaId}.jpg`,
    );
    expect(url.searchParams.get("X-Amz-SignedHeaders")).toBe(
      "content-length;content-type;host",
    );
    const replay = await http(
      "POST",
      "/users/me/media/uploads",
      ATHLETE_A,
      { purpose: "form_answer", contentType: "image/jpeg", bytes: 4096 },
      "media-1",
    );
    expect(replay.status).toBe(200);
    expect(replay.json.data.mediaId).toBe(media.mediaId);

    for (const body of [
      { purpose: "form_answer", contentType: "image/png", bytes: 10 },
      {
        purpose: "form_answer",
        contentType: "image/jpeg",
        bytes: 10 * 1024 * 1024 + 1,
      },
    ]) {
      const bad = await http(
        "POST",
        "/users/me/media/uploads",
        ATHLETE_A,
        body,
      );
      expect(bad.status).toBe(422);
      expect(bad.json.code).toBe("invalid_upload");
    }
    const wrongPurpose = await http(
      "POST",
      "/users/me/media/uploads",
      ATHLETE_A,
      {
        purpose: "resource",
        contentType: "image/jpeg",
        bytes: 10,
      },
    );
    expect(wrongPurpose.status).toBe(422);
  });

  it("a coach resource upload takes PDF, JPEG or PNG up to 25 MB; only trainers can call it", async () => {
    const res = await http("POST", "/trainers/me/media/uploads", COACH_C, {
      purpose: "resource",
      contentType: "application/pdf",
      bytes: 20 * 1024 * 1024,
    });
    expect(res.status).toBe(201);
    expect(new URL(res.json.data.upload.url).pathname).toBe(
      `/pending/resources/${COACH_C}/${res.json.data.mediaId}/file.pdf`,
    );
    const png = await http("POST", "/trainers/me/media/uploads", COACH_C, {
      purpose: "resource",
      contentType: "image/png",
      bytes: 10,
    });
    expect(new URL(png.json.data.upload.url).pathname).toMatch(/file\.png$/);
    const big = await http("POST", "/trainers/me/media/uploads", COACH_C, {
      purpose: "resource",
      contentType: "application/pdf",
      bytes: 25 * 1024 * 1024 + 1,
    });
    expect(big.status).toBe(422);
    const athlete = await http(
      "POST",
      "/trainers/me/media/uploads",
      ATHLETE_A,
      {
        purpose: "resource",
        contentType: "application/pdf",
        bytes: 10,
      },
    );
    expect(athlete.status).toBe(403);
  });

  it("the owner views their upload (15 minutes); nobody else can", async () => {
    const media = (
      await http("POST", "/users/me/media/uploads", ATHLETE_A, {
        purpose: "form_answer",
        contentType: "image/jpeg",
        bytes: 50,
      })
    ).json.data;
    const early = await http(
      "GET",
      `/users/me/media/${media.mediaId}`,
      ATHLETE_A,
    );
    expect(early.status).toBe(409);
    expect(early.json).toMatchObject({
      code: "upload_incomplete",
      reason: "missing",
    });
    bucket.put(
      `pending/forms/${ATHLETE_A}/${media.mediaId}.jpg`,
      "image/jpeg",
      50,
    );
    const view = await http(
      "GET",
      `/users/me/media/${media.mediaId}`,
      ATHLETE_A,
    );
    expect(view.status).toBe(200);
    expect(new URL(view.json.data.url).searchParams.get("X-Amz-Expires")).toBe(
      "900",
    );
    const other = await http(
      "GET",
      `/users/me/media/${media.mediaId}`,
      ATHLETE_B,
    );
    expect(other.status).toBe(404);
    const row = await db.select().from(schema.privateMedia);
    expect(row[0]!.status).toBe("ready");
    // A second view needs no S3 check.
    const heads = bucket.sent.filter((s) => s === "HeadObjectCommand").length;
    expect(
      (await http("GET", `/users/me/media/${media.mediaId}`, ATHLETE_A)).status,
    ).toBe(200);
    expect(bucket.sent.filter((s) => s === "HeadObjectCommand").length).toBe(
      heads,
    );
  });

  it("a retried upload request returns the same media; once ready it carries no upload link", async () => {
    const body = {
      purpose: "form_answer",
      contentType: "image/jpeg",
      bytes: 50,
    };
    const [a, b] = await Promise.all([
      http("POST", "/users/me/media/uploads", ATHLETE_A, body, "race-media"),
      http("POST", "/users/me/media/uploads", ATHLETE_A, body, "race-media"),
    ]);
    expect(a.json.data.mediaId).toBe(b.json.data.mediaId);
    expect([a.status, b.status].sort()).toEqual([200, 201]);
    expect(await db.select().from(schema.privateMedia)).toHaveLength(1);
    bucket.put(
      `forms/${ATHLETE_A}/${a.json.data.mediaId}.jpg`,
      "image/jpeg",
      50,
    );
    expect(
      await finaliseMedia(ATHLETE_A, a.json.data.mediaId, "form_answer"),
    ).toMatchObject({
      ok: true,
    });
    const again = await http(
      "POST",
      "/users/me/media/uploads",
      ATHLETE_A,
      body,
      "race-media",
    );
    expect(again.json.data).toMatchObject({ status: "ready", upload: null });
    // BE-I1's entry point: another owner's, or the wrong purpose, isn't found.
    expect(
      await finaliseMedia(ATHLETE_B, a.json.data.mediaId, "form_answer"),
    ).toEqual({
      ok: false,
      reason: "not_found",
    });
    expect(
      await finaliseMedia(ATHLETE_A, a.json.data.mediaId, "resource"),
    ).toEqual({
      ok: false,
      reason: "not_found",
    });
  });

  it("an upload of the wrong size is deleted on check, so the phone starts again", async () => {
    const media = (
      await http("POST", "/users/me/media/uploads", ATHLETE_A, {
        purpose: "form_answer",
        contentType: "image/jpeg",
        bytes: 50,
      })
    ).json.data;
    bucket.put(
      `pending/forms/${ATHLETE_A}/${media.mediaId}.jpg`,
      "image/jpeg",
      49,
    );
    const view = await http(
      "GET",
      `/users/me/media/${media.mediaId}`,
      ATHLETE_A,
    );
    expect(view.status).toBe(409);
    expect(view.json.reason).toBe("size_mismatch");
    expect(bucket.keys()).toEqual([]);
    expect(await db.select().from(schema.privateMedia)).toEqual([]);
  });
});

describe("form photo answers (lifts PER-116's 422)", () => {
  async function photoRequest(coach = COACH_C, required = false) {
    const form = await http("POST", "/trainers/me/forms", coach, {
      title: "Check-in",
      questions: [
        { id: "mood", type: "scale", prompt: "Mood", required: true },
        { id: "front", type: "photo", prompt: "Front photo", required },
      ],
    });
    expect(form.status).toBe(201);
    const rule = await http("POST", "/trainers/me/form-schedules", coach, {
      formId: form.json.data.id,
      trigger: "once",
      audience: "selected",
      clientIds: [ATHLETE_A],
      dueAfterHours: 24,
    });
    expect(rule.status).toBe(201);
    const list = await http("GET", "/users/me/form-requests", ATHLETE_A);
    return (list.json.data.requests as Json[]).find(
      (r) => r.formId === form.json.data.id,
    );
  }

  async function uploadedPhoto(athlete = ATHLETE_A, upload = true) {
    const media = (
      await http("POST", "/users/me/media/uploads", athlete, {
        purpose: "form_answer",
        contentType: "image/jpeg",
        bytes: 777,
      })
    ).json.data;
    if (upload)
      bucket.put(
        `pending/forms/${athlete}/${media.mediaId}.jpg`,
        "image/jpeg",
        777,
      );
    return media.mediaId as string;
  }

  const submit = (requestId: string, answers: unknown) =>
    http("POST", `/users/me/form-requests/${requestId}/response`, ATHLETE_A, {
      answers,
    });

  it("a photo question is answered with an uploaded media id; the coach views it for 5 minutes", async () => {
    const req = await photoRequest();
    const mediaId = await uploadedPhoto();
    const res = await submit(req.id, { mood: 4, front: { mediaId } });
    expect(res.status).toBe(201);
    expect(res.json.data.answers).toEqual({ mood: 4, front: { mediaId } });
    const [row] = await db.select().from(schema.privateMedia);
    expect(row).toMatchObject({
      status: "ready",
      formResponseId: res.json.data.id,
    });

    const view = await http(
      "GET",
      `/trainers/me/clients/${ATHLETE_A}/media/${mediaId}`,
      COACH_C,
    );
    expect(view.status).toBe(200);
    expect(new URL(view.json.data.url).searchParams.get("X-Amz-Expires")).toBe(
      "300",
    );
    // Coach E (also A's coach) didn't send this form, and D isn't a coach.
    expect(
      (
        await http(
          "GET",
          `/trainers/me/clients/${ATHLETE_A}/media/${mediaId}`,
          COACH_E,
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await http(
          "GET",
          `/trainers/me/clients/${ATHLETE_A}/media/${mediaId}`,
          COACH_D,
        )
      ).status,
    ).toBe(403);

    // After coaching ends, coach C's next view is refused.
    await endCoachClientRelationship({
      trainerId: COACH_C,
      clientId: ATHLETE_A,
      initiatedBy: "client",
    });
    expect(
      (
        await http(
          "GET",
          `/trainers/me/clients/${ATHLETE_A}/media/${mediaId}`,
          COACH_C,
        )
      ).status,
    ).toBe(403);
  });

  it("Inspector Brad #553: a photo answer from a past coaching cycle stays hidden after the coach is re-accepted", async () => {
    const req = await photoRequest();
    const mediaId = await uploadedPhoto();
    expect((await submit(req.id, { mood: 4, front: { mediaId } })).status).toBe(
      201,
    );
    await endCoachClientRelationship({
      trainerId: COACH_C,
      clientId: ATHLETE_A,
      initiatedBy: "client",
    });
    // Coaching starts again: a new cycle (activated_at moves on).
    await db
      .update(schema.ptClientRelationships)
      .set({ status: "active" })
      .where(eq(schema.ptClientRelationships.trainerId, COACH_C));
    // The response list hides the old cycle, and so must the photo.
    const responses = await http(
      "GET",
      `/trainers/me/clients/${ATHLETE_A}/form-responses`,
      COACH_C,
    );
    expect(JSON.stringify(responses.json)).not.toContain(mediaId);
    const view = await http(
      "GET",
      `/trainers/me/clients/${ATHLETE_A}/media/${mediaId}`,
      COACH_C,
    );
    expect(view.status).toBe(404);
  });

  it("a bare media id is accepted and stored as { mediaId }", async () => {
    const req = await photoRequest();
    const mediaId = await uploadedPhoto();
    const res = await submit(req.id, { mood: 3, front: mediaId });
    expect(res.status).toBe(201);
    expect(res.json.data.answers.front).toEqual({ mediaId });
  });

  it("refuses someone else's photo, an unfinished upload, a reused photo and a non-id", async () => {
    const otherPhoto = await uploadedPhoto(ATHLETE_B);
    const req = await photoRequest();
    const theirs = await submit(req.id, {
      mood: 3,
      front: { mediaId: otherPhoto },
    });
    expect(theirs.status).toBe(422);
    expect(theirs.json).toMatchObject({
      code: "invalid_answers",
      errors: [{ at: "front", message: "must be a photo you uploaded" }],
    });
    const unfinished = await uploadedPhoto(ATHLETE_A, false);
    const notUp = await submit(req.id, {
      mood: 3,
      front: { mediaId: unfinished },
    });
    expect(notUp.status).toBe(422);
    expect(notUp.json.errors).toEqual([
      { at: "front", message: "must be a finished upload" },
    ]);
    const junk = await submit(req.id, { mood: 3, front: { mediaId: "nope" } });
    expect(junk.status).toBe(422);
    expect(junk.json.errors[0].at).toBe("front");

    const used = await uploadedPhoto();
    expect(
      (await submit(req.id, { mood: 3, front: { mediaId: used } })).status,
    ).toBe(201);
    const second = await photoRequest(COACH_E);
    const reuse = await submit(second.id, {
      mood: 3,
      front: { mediaId: used },
    });
    expect(reuse.status).toBe(422);
    expect(reuse.json.errors).toEqual([
      { at: "front", message: "must not be used in another response" },
    ]);
  });

  it("one photo can't answer two questions", async () => {
    const form = await http("POST", "/trainers/me/forms", COACH_C, {
      title: "Two photos",
      questions: [
        { id: "front", type: "photo", prompt: "Front" },
        { id: "side", type: "photo", prompt: "Side" },
      ],
    });
    await http("POST", "/trainers/me/form-schedules", COACH_C, {
      formId: form.json.data.id,
      trigger: "once",
      audience: "selected",
      clientIds: [ATHLETE_A],
    });
    const list = await http("GET", "/users/me/form-requests", ATHLETE_A);
    const req = (list.json.data.requests as Json[]).find(
      (r) => r.formId === form.json.data.id,
    );
    const mediaId = await uploadedPhoto();
    const res = await submit(req.id, { front: { mediaId }, side: mediaId });
    expect(res.status).toBe(422);
    expect(res.json.errors).toEqual([
      { at: "front", message: "must be a different photo for each question" },
    ]);
  });

  it("a required photo left blank is an ordinary 'required' error", async () => {
    const req = await photoRequest(COACH_C, true);
    const res = await submit(req.id, { mood: 3 });
    expect(res.status).toBe(422);
    expect(res.json).toMatchObject({
      code: "invalid_answers",
      errors: [{ at: "front", message: "required" }],
    });
  });
});

// ─── Design F test 6 lives in noAiPhotos.test.ts ───────────────────────────

describe("migration", () => {
  it("applies twice, rolls back and re-applies, with RLS on and no policies", async () => {
    const fresh = await baseDatabase();
    try {
      const sql = await read(MIGRATIONS, MIGRATION);
      await fresh.exec(sql);
      await fresh.exec(sql);
      await fresh.exec(await read(ROLLBACKS, MIGRATION));
      const gone = await fresh.query<{ n: number }>(
        "select count(*)::int as n from pg_tables where tablename in ('progress_photo_sets','progress_photos','private_media')",
      );
      expect(gone.rows[0]!.n).toBe(0);
      await fresh.exec(sql);
      const tables = await fresh.query<{ tablename: string; rls: boolean }>(
        "select tablename, rowsecurity as rls from pg_tables where tablename in ('progress_photo_sets','progress_photos','private_media') order by 1",
      );
      expect(tables.rows).toEqual(
        ["private_media", "progress_photo_sets", "progress_photos"].map(
          (tablename) => ({ tablename, rls: true }),
        ),
      );
      const policies = await fresh.query<{ n: number }>(
        "select count(*)::int as n from pg_policies where tablename in ('progress_photo_sets','progress_photos','private_media')",
      );
      expect(policies.rows[0]!.n).toBe(0);
      const user = randomUUID();
      await fresh.exec(`insert into profiles (id) values ('${user}')`);
      await expect(
        fresh.exec(
          `insert into progress_photo_sets (user_id, taken_on, source) values ('${user}', '2026-11-20', 'ai')`,
        ),
      ).rejects.toThrow(/check/i);
      await expect(
        fresh.exec(
          `insert into private_media (owner_id, purpose, s3_key, content_type, bytes) values ('${user}', 'avatar', 'k', 'image/jpeg', 1)`,
        ),
      ).rejects.toThrow(/check/i);
    } finally {
      await fresh.close();
    }
  });
});
