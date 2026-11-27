import { readFile } from "node:fs/promises";
import { createHmac, randomUUID } from "node:crypto";
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
 * PER-120 (BE-E1b) — backend design E's tests, run against the REAL
 * migrations on PGlite through the real HTTP handlers, accept flows,
 * offboarding, scheduler job and webhook. Only the edges are stubbed: the JWT
 * (bearer token = user id), Expo push delivery, and Stream itself — an
 * in-memory fake behind the real `StreamChatClient` (./fakeStream.ts), so
 * every Stream request is really built and signed. Stream's real API is never
 * called.
 */

const holder = vi.hoisted(() => ({
  db: null as unknown,
  pushes: [] as { userId: string; payload: Record<string, unknown> }[],
}));
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
    createAndDispatch = vi.fn(
      async (userId: string, payload: Record<string, unknown>) => {
        holder.pushes.push({ userId, payload });
        return {};
      },
    );
    dispatchExisting = vi.fn(async () => {});
  },
}));
vi.mock("../../trainers/seats/trainerSeats", async (original) => ({
  ...(await original<object>()),
  evaluateTrainerJoinSeat: async () => ({ allowed: true }),
  evaluateTrainerClientsActiveSeat: async () => ({ allowed: true }),
  assertTrainerCanInvite: async () => {},
  notifyTrainerClientLimitReached: vi.fn(async () => {}),
}));
vi.mock("../../entitlement/assertEntitlement", async (original) => ({
  ...(await original<object>()),
  evaluateTrainerClientsActiveSeat: async () => ({ allowed: true }),
}));
vi.mock("sst", () => ({
  Resource: { CoachPrivateMedia: { name: "private-media-test" } },
}));
// The bucket side of the post-purge erasure has its own suite (PER-121).
vi.mock("../../media/privateMediaStore", async (original) => ({
  ...(await original<object>()),
  deleteAllUserMedia: vi.fn(async () => 0),
}));

import Elysia from "elysia";
import { coreErrorHandler } from "../../../shared/errorHandler";
import { coachingRoutes } from "../../coachingRoutes";
import { trainersAcceptInviteCodeHandler } from "../../trainers/invite-codes/trainersAcceptInviteCodeHandler";
import { trainersRespondToRequestHandler } from "../../trainers/relationships/trainersRespondToRequestHandler";
import { trainersRespondToClientRequestHandler } from "../../trainers/relationships/trainersRespondToClientRequestHandler";
import { endCoachClientRelationship } from "../../relationships/endCoachClientRelationship";
import { currentDeclarationVersion } from "../../coaching/declaration";
import { runCoachScheduler } from "../../coaching/scheduler/coachScheduler";
import { COACH_SCHEDULER_JOBS } from "../../coaching/scheduler/jobs";
import { chatChannelsJob } from "../../coaching/scheduler/jobs/chatChannels";
import { sessionRemindersJob } from "../../coaching/scheduler/jobs/sessionReminders";
import { NotificationDispatcher } from "../../notifications/push/notificationDispatcher";
import {
  channelIdFor,
  eraseChatUser,
  freezeChatChannel,
  provisionChatChannel,
  reconcileChatChannels,
  RECONCILE_DEADLINE_MS,
  RECONCILE_MAX_FAILURES,
  safeFreezeChatChannel,
  safeProvisionChatChannel,
  setStreamClientForTests,
  StreamDeletePendingError,
} from "../chatChannels";
import { COACHING_GRANTS, StreamChatClient } from "../streamClient";
import { accountPurgeCron } from "../../account/purge/accountPurgeCron";
import {
  ERASE_DEADLINE_MS,
  eraseAfterPurge,
  MAX_CHAT_ERASURES_PER_RUN,
  MAX_CHAT_FAILURES_PER_RUN,
} from "../../account/purge/eraseAfterPurge";
import {
  drainPrivateMediaPurges,
  queuePrivateMediaPurge,
} from "../../media/privateMediaPurge";
import { deleteAllUserMedia } from "../../media/privateMediaStore";
import {
  handleStreamWebhook,
  isValidStreamSignature,
  messageDedupeKey,
} from "../streamWebhookHandler";
import {
  FakeStream,
  TEST_STREAM_KEY,
  TEST_STREAM_SECRET,
  verifyHs256,
} from "./fakeStream";

const MIGRATIONS = "../../../../../../supabase/migrations/";
const ROLLBACKS = "../../../../../../supabase/rollbacks/";
const read = (dir: string, file: string) =>
  readFile(new URL(`${dir}${file}`, import.meta.url), "utf8");
const MIGRATION = "20261125162525_chat_channels.sql";

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

/** Designs A, C, F and I applied, BEFORE this migration. */
async function baseDatabase(): Promise<PGlite> {
  const pg = await PGlite.create();
  await pg.exec(
    "create role anon; create role authenticated; create schema auth; create function auth.uid() returns uuid language sql as 'select null::uuid';",
  );
  for (const table of BASE_TABLES) await pg.exec(ddl(table));
  await pg.exec(
    "alter table pt_client_relationships drop column activated_at, drop column client_profile_id;",
  );
  for (const file of [
    "20260626110000_trainer_invite_codes.sql",
    "20261120120000_coaching_relationships_client_profiles.sql",
    "20261120235941_coach_forms.sql",
  ]) {
    await pg.exec(await read(MIGRATIONS, file));
  }
  await pg.exec(
    "DO $$ BEGIN CREATE TYPE notification_type AS ENUM ('coach_brief'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;",
  );
  for (const file of [
    "20261123120117_coach_events_notifications.sql",
    "20261123230832_progress_photos_private_media.sql",
    "20261125101829_coach_resources.sql",
  ]) {
    await pg.exec(await read(MIGRATIONS, file));
  }
  return pg;
}

const ATHLETE_A = randomUUID(); // coached by C and E
const ATHLETE_B = randomUUID(); // a pending request to C
const ATHLETE_F = randomUUID(); // invited by C with a personal code
const COACH_C = randomUUID();
const COACH_E = randomUUID();
const STRANGER = randomUUID(); // no relationships at all

let REL_CA: string;
let REL_EA: string;

const TRUNCATE = [
  "chat_channels",
  "coach_scheduler_runs",
  "coach_resource_assignments",
  "coach_resources",
  "private_media_purges",
  "private_media",
  "progress_photos",
  "progress_photo_sets",
  "coach_events",
  "coach_notification_settings",
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
const stream = new FakeStream();

const app = new Elysia()
  .use(coreErrorHandler)
  .use(coachingRoutes)
  .use(trainersAcceptInviteCodeHandler)
  .use(trainersRespondToRequestHandler)
  .use(trainersRespondToClientRequestHandler);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;

async function http(
  method: string,
  path: string,
  actor: string | null,
  body?: unknown,
): Promise<{ status: number; json: Json }> {
  const res = await app.handle(
    new Request(`http://localhost${path}`, {
      method,
      headers: {
        ...(actor ? { authorization: `Bearer ${actor}` } : {}),
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : null };
}

const configure = () =>
  setStreamClientForTests(
    new StreamChatClient(
      { apiKey: TEST_STREAM_KEY, apiSecret: TEST_STREAM_SECRET },
      stream.fetch,
    ),
  );

const channelRow = async (relationshipId: string) =>
  (
    await db
      .select()
      .from(schema.chatChannels)
      .where(eq(schema.chatChannels.relationshipId, relationshipId))
  )[0];

const end = (trainerId: string, clientId: string) =>
  endCoachClientRelationship({ trainerId, clientId, initiatedBy: "client" });

function sign(body: string, secret = TEST_STREAM_SECRET): string {
  return createHmac("sha256", secret).update(body).digest("hex");
}

function webhook(
  event: unknown,
  signature: string | null | "auto" = "auto",
): Promise<Response> {
  const body = typeof event === "string" ? event : JSON.stringify(event);
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (signature === "auto") headers["x-signature"] = sign(body);
  else if (signature !== null) headers["x-signature"] = signature;
  return handleStreamWebhook(
    new Request("http://localhost/chat/stream-webhook", {
      method: "POST",
      headers,
      body,
    }),
  );
}

const messageNew = (
  relationshipId: string,
  senderId: string,
  messageId: string = randomUUID(),
  extra: Record<string, unknown> = {},
) => ({
  type: "message.new",
  cid: `coaching:${channelIdFor(relationshipId)}`,
  channel_type: "coaching",
  channel_id: channelIdFor(relationshipId),
  message: {
    id: messageId,
    text: "Can we move tomorrow's session?",
    type: "regular",
    user: { id: senderId },
    created_at: new Date().toISOString(),
    ...extra,
  },
  user: { id: senderId },
});

const messageEvents = () =>
  db
    .select()
    .from(schema.coachEvents)
    .where(eq(schema.coachEvents.kind, "message_received"));

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
  stream.reset();
  holder.pushes = [];
  process.env.STREAM_API_KEY = TEST_STREAM_KEY;
  process.env.STREAM_API_SECRET = TEST_STREAM_SECRET;
  configure();
  await pg.exec(`truncate ${TRUNCATE.map((t) => `"${t}"`).join(",")} cascade`);
  await db.insert(schema.profiles).values([
    {
      id: ATHLETE_A,
      fullName: "Lena",
      role: "user",
      avatarUrl: "https://cdn.example/lena.png",
    },
    { id: ATHLETE_B, fullName: "Chris", role: "user" },
    { id: ATHLETE_F, fullName: "Frankie", role: "user" },
    { id: COACH_C, fullName: "Ellie", role: "personal_trainer" },
    { id: COACH_E, fullName: "Marcus", role: "physiotherapist" },
    { id: STRANGER, fullName: "Sam", role: "user" },
  ]);
  const rels = await db
    .insert(schema.ptClientRelationships)
    .values([
      { trainerId: COACH_C, clientId: ATHLETE_A, status: "active" },
      { trainerId: COACH_E, clientId: ATHLETE_A, status: "active" },
    ])
    .returning();
  REL_CA = rels.find((r) => r.trainerId === COACH_C)!.id;
  REL_EA = rels.find((r) => r.trainerId === COACH_E)!.id;
});

afterEach(() => {
  setStreamClientForTests(undefined);
  delete process.env.STREAM_API_KEY;
  delete process.env.STREAM_API_SECRET;
  vi.restoreAllMocks();
});

// ─── Design E test 2: provisioning is idempotent and retries from pending ───

describe("design E test 2: channel provisioning", () => {
  it("creates one channel with both members, and running it again changes nothing", async () => {
    expect(await provisionChatChannel(REL_CA)).toBe("provisioned");
    expect(await provisionChatChannel(REL_CA)).toBe("provisioned");
    expect(stream.channels.size).toBe(1);
    const ch = stream.channels.get(channelIdFor(REL_CA))!;
    expect([...ch.members].sort()).toEqual([COACH_C, ATHLETE_A].sort());
    expect(ch.createdBy).toBe(COACH_C);
    expect(ch.frozen).toBe(false);
    expect(stream.users.get(ATHLETE_A)).toEqual({
      id: ATHLETE_A,
      name: "Lena",
      image: "https://cdn.example/lena.png",
    });
    expect(stream.users.get(COACH_C)).toEqual({ id: COACH_C, name: "Ellie" });
    const rows = await db.select().from(schema.chatChannels);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      relationshipId: REL_CA,
      streamChannelType: "coaching",
      streamChannelId: `coach-${REL_CA}`,
      trainerId: COACH_C,
      clientId: ATHLETE_A,
      state: "active",
      frozenAt: null,
    });
  });

  it("a Stream failure leaves the channel pending, and the scheduler job provisions it", async () => {
    stream.down = true;
    await safeProvisionChatChannel(REL_CA); // never throws
    await expect(provisionChatChannel(REL_CA)).rejects.toThrow(/500/);
    expect((await channelRow(REL_CA))!.state).toBe("pending");

    stream.down = false;
    const result = await chatChannelsJob.run({
      now: new Date(),
      dispatcher: new NotificationDispatcher(),
    });
    // Both of A's coaches (C was pending; E had no row yet) are provisioned.
    expect(result).toMatchObject({ provisioned: 2, provisionFailed: 0 });
    expect((await channelRow(REL_CA))!.state).toBe("active");
    expect((await channelRow(REL_EA))!.state).toBe("active");
    // Nothing left to do: the next run calls Stream for nothing.
    stream.calls = [];
    expect(await reconcileChatChannels()).toMatchObject({
      provisioned: 0,
      frozen: 0,
    });
    expect(stream.calls).toEqual([]);
  });

  it("a failure for one relationship never stops the others", async () => {
    stream.failOn(new RegExp(`coach-${REL_CA}/query`));
    const summary = await reconcileChatChannels();
    expect(summary).toMatchObject({ provisioned: 1, provisionFailed: 1 });
    expect((await channelRow(REL_CA))!.state).toBe("pending");
    expect((await channelRow(REL_EA))!.state).toBe("active");
  });

  it("runs after the coach pushes job, claimed once per tick", async () => {
    // It writes no coach events, so it runs after coachPushesJob. PER-123's
    // session reminders job (also no coach events) runs after it.
    const names = COACH_SCHEDULER_JOBS.map((j) => j.name);
    expect(names.indexOf("chat_channels")).toBeGreaterThan(
      names.indexOf("coach_pushes"),
    );
    const now = new Date();
    const first = await runCoachScheduler([chatChannelsJob], {
      now,
      dispatcher: new NotificationDispatcher(),
    });
    expect(first.jobs.chat_channels).toMatchObject({
      status: "ran",
      summary: { provisioned: 2 },
    });
    const again = await runCoachScheduler([chatChannelsJob], {
      now,
      dispatcher: new NotificationDispatcher(),
    });
    expect(again.jobs.chat_channels).toEqual({
      status: "skipped",
      reason: "already_ran",
    });
  });

  it("skips AI, ended and deleted-account relationships", async () => {
    const [ai] = await db
      .insert(schema.ptClientRelationships)
      .values({
        trainerId: COACH_C,
        clientId: STRANGER,
        status: "active",
        isAiTrainer: true,
      })
      .returning();
    expect(await provisionChatChannel(ai!.id)).toBe("not_active");
    expect(await provisionChatChannel(randomUUID())).toBe("not_active");
    await db
      .update(schema.profiles)
      .set({ deletedAt: new Date() })
      .where(eq(schema.profiles.id, COACH_E));
    expect(await provisionChatChannel(REL_EA)).toBe("not_active");
    expect(await reconcileChatChannels()).toMatchObject({ provisioned: 1 });
    expect(stream.channels.has(channelIdFor(ai!.id))).toBe(false);
    expect(stream.channels.has(channelIdFor(REL_EA))).toBe(false);
  });

  it("coaching that ends while Stream is being called is frozen straight away", async () => {
    // The relationship ends between the read and the final write.
    const original = stream.fetch;
    stream.fetch = async (input, init) => {
      if ((init.body as string).includes('frozen":false')) {
        await db
          .update(schema.ptClientRelationships)
          .set({ status: "terminated" })
          .where(eq(schema.ptClientRelationships.id, REL_CA));
      }
      return original(input, init);
    };
    configure();
    expect(await provisionChatChannel(REL_CA)).toBe("ended_meanwhile");
    stream.fetch = original;
    expect((await channelRow(REL_CA))!.state).toBe("frozen");
    const ch = stream.channels.get(channelIdFor(REL_CA))!;
    expect(ch.frozen).toBe(true);
    expect([...ch.members]).toEqual([COACH_C]);
  });
});

// ─── Provisioning hooks on the accept paths, and the welcome message ────────

describe("provisioning when a relationship becomes active", () => {
  it("an athlete accepting a coach's invite gets the channel", async () => {
    const [rel] = await db
      .insert(schema.ptClientRelationships)
      .values({
        trainerId: COACH_C,
        clientId: ATHLETE_B,
        status: "pending",
        initiatedBy: "trainer",
      })
      .returning();
    const res = await http(
      "POST",
      `/clients/me/relationships/${rel!.id}/respond`,
      ATHLETE_B,
      { action: "accept", consent: true, consentVersion: "v1-2026-07" },
    );
    expect(res.status).toBe(200);
    expect((await channelRow(rel!.id))!.state).toBe("active");
    expect([...stream.channels.get(channelIdFor(rel!.id))!.members]).toContain(
      ATHLETE_B,
    );
  });

  it("a coach accepting a client's request gets the channel; a decline doesn't", async () => {
    const [accepted, declined] = await db
      .insert(schema.ptClientRelationships)
      .values([
        {
          trainerId: COACH_C,
          clientId: ATHLETE_B,
          status: "pending",
          initiatedBy: "client",
        },
        {
          trainerId: COACH_E,
          clientId: ATHLETE_B,
          status: "pending",
          initiatedBy: "client",
        },
      ])
      .returning();
    const res = await http(
      "POST",
      `/trainers/me/relationships/${accepted!.id}/respond`,
      COACH_C,
      { action: "accept" },
    );
    expect(res.status).toBe(200);
    expect((await channelRow(accepted!.id))!.state).toBe("active");
    const no = await http(
      "POST",
      `/trainers/me/relationships/${declined!.id}/respond`,
      COACH_E,
      { action: "decline" },
    );
    expect(no.status).toBe(200);
    expect(await channelRow(declined!.id)).toBeUndefined();
  });

  it("a personal-code accept posts the set-up welcome message as the first message, once", async () => {
    const profile = await http(
      "POST",
      "/trainers/me/client-profiles",
      COACH_C,
      { displayName: "Frankie" },
    );
    expect(profile.status).toBe(201);
    const id = profile.json.data.id as string;
    const put = await http(
      "PUT",
      `/trainers/me/client-profiles/${id}/setup/welcome_message`,
      COACH_C,
      {
        items: [{ sortOrder: 0, config: { text: "Welcome aboard, Frankie!" } }],
      },
    );
    expect(put.status).toBe(200);
    await http("POST", "/trainers/me/declaration", COACH_C, {
      statementVersion: currentDeclarationVersion(),
    });
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
    const relationshipId = accepted.json.data.relationshipId as string;
    expect((await channelRow(relationshipId))!.state).toBe("active");

    const [item] = await db
      .select()
      .from(schema.coachClientSetupItems)
      .where(eq(schema.coachClientSetupItems.section, "welcome_message"));
    const ch = stream.channels.get(channelIdFor(relationshipId))!;
    expect(ch.messages).toEqual([
      {
        id: `welcome-${item!.id}`,
        text: "Welcome aboard, Frankie!",
        userId: COACH_C,
      },
    ]);
    // A re-run (the scheduler, a retry) never posts it twice.
    await db
      .update(schema.chatChannels)
      .set({ state: "pending" })
      .where(eq(schema.chatChannels.relationshipId, relationshipId));
    expect(await provisionChatChannel(relationshipId)).toBe("provisioned");
    expect(ch.messages).toHaveLength(1);
  });
});

// ─── Design E test 3: ending coaching ───────────────────────────────────────

describe("design E test 3: ending coaching removes the client and freezes the channel", () => {
  it("coach C's channel freezes without A; coach E's channel with A is untouched", async () => {
    await reconcileChatChannels();
    const result = await end(COACH_C, ATHLETE_A);
    expect(result.ok).toBe(true);

    const frozen = stream.channels.get(channelIdFor(REL_CA))!;
    expect(frozen.frozen).toBe(true);
    expect([...frozen.members]).toEqual([COACH_C]);
    const row = await channelRow(REL_CA);
    expect(row).toMatchObject({ state: "frozen" });
    expect(row!.frozenAt).toBeInstanceOf(Date);

    const other = stream.channels.get(channelIdFor(REL_EA))!;
    expect(other.frozen).toBe(false);
    expect([...other.members].sort()).toEqual([COACH_E, ATHLETE_A].sort());
    expect((await channelRow(REL_EA))!.state).toBe("active");

    // The coach still lists it (read-only); the athlete only sees E's.
    const coach = await http("GET", "/chat/channels", COACH_C);
    expect(coach.json.data).toEqual([
      {
        relationshipId: REL_CA,
        channelId: `coach-${REL_CA}`,
        otherParty: {
          id: ATHLETE_A,
          name: "Lena",
          avatarUrl: "https://cdn.example/lena.png",
        },
        state: "frozen",
      },
    ]);
    const athlete = await http("GET", "/chat/channels", ATHLETE_A);
    expect(athlete.json.data.map((c: Json) => c.relationshipId)).toEqual([
      REL_EA,
    ]);
  });

  it("a Stream failure at the end keeps the athlete out of the list, and the scheduler freezes it", async () => {
    await reconcileChatChannels();
    stream.down = true;
    expect((await end(COACH_C, ATHLETE_A)).ok).toBe(true); // never fails
    expect((await channelRow(REL_CA))!.state).toBe("active");
    // Already hidden from the athlete: the relationship decides.
    const athlete = await http("GET", "/chat/channels", ATHLETE_A);
    expect(athlete.json.data.map((c: Json) => c.relationshipId)).toEqual([
      REL_EA,
    ]);
    const failing = await reconcileChatChannels();
    expect(failing).toMatchObject({ freezeFailed: 1, frozen: 0 });

    stream.down = false;
    expect(await reconcileChatChannels()).toMatchObject({ frozen: 1 });
    expect((await channelRow(REL_CA))!.state).toBe("frozen");
    expect(stream.channels.get(channelIdFor(REL_CA))!.frozen).toBe(true);
  });

  it("a channel never created in Stream is simply marked frozen", async () => {
    stream.failOn(/\/users$/, 1); // provisioning stops before the channel
    await safeProvisionChatChannel(REL_CA);
    expect(stream.channels.size).toBe(0);
    await db
      .update(schema.ptClientRelationships)
      .set({ status: "terminated" })
      .where(eq(schema.ptClientRelationships.id, REL_CA));
    expect(await freezeChatChannel(REL_CA)).toBe("frozen");
    expect((await channelRow(REL_CA))!.state).toBe("frozen");
  });

  it("a pending half-provisioned channel on an ended relationship is frozen by the next tick", async () => {
    // A set-up welcome message, so provisioning has a step after the channel.
    const [profile] = await db
      .insert(schema.coachClientProfiles)
      .values({
        trainerId: COACH_C,
        displayName: "Lena",
        status: "active",
        clientId: ATHLETE_A,
        relationshipId: REL_CA,
      })
      .returning();
    await db.insert(schema.coachClientSetupItems).values({
      profileId: profile!.id,
      section: "welcome_message",
      config: { text: "Welcome!" },
      sortOrder: 0,
    });
    // The welcome message fails after the channel was created, both members
    // in, unfrozen: the row stays pending.
    stream.failOn(/\/message$/);
    await safeProvisionChatChannel(REL_CA);
    expect((await channelRow(REL_CA))!.state).toBe("pending");
    const ch = stream.channels.get(channelIdFor(REL_CA))!;
    expect(ch.members.has(ATHLETE_A)).toBe(true);
    expect(ch.frozen).toBe(false);

    // Coaching ends and the immediate freeze fails too.
    stream.down = true;
    expect((await end(COACH_C, ATHLETE_A)).ok).toBe(true);
    expect((await channelRow(REL_CA))!.state).toBe("pending");
    stream.down = false;

    const summary = await reconcileChatChannels();
    expect(summary).toMatchObject({ frozen: 1, freezeFailed: 0 });
    expect(ch.frozen).toBe(true);
    expect(ch.members.has(ATHLETE_A)).toBe(false);
    expect((await channelRow(REL_CA))!.state).toBe("frozen");
  });

  it("a pending row whose channel Stream never created is frozen by the tick without an error", async () => {
    stream.failOn(/\/users$/, 1); // provisioning stops before the channel
    await safeProvisionChatChannel(REL_CA);
    expect(stream.channels.has(channelIdFor(REL_CA))).toBe(false);
    await db
      .update(schema.ptClientRelationships)
      .set({ status: "terminated" })
      .where(eq(schema.ptClientRelationships.id, REL_CA));
    const summary = await reconcileChatChannels();
    expect(summary).toMatchObject({ frozen: 1, freezeFailed: 0 });
    expect((await channelRow(REL_CA))!.state).toBe("frozen");
    // A frozen row is never picked up again.
    stream.calls = [];
    expect(await reconcileChatChannels()).toMatchObject({ frozen: 0 });
    expect(
      stream.calls.some((c) => c.path.includes(channelIdFor(REL_CA))),
    ).toBe(false);
  });

  it("freezing refuses an active relationship and a missing channel", async () => {
    await provisionChatChannel(REL_CA);
    expect(await freezeChatChannel(REL_CA)).toBe("still_active");
    expect(await freezeChatChannel(randomUUID())).toBe("no_channel");
    stream.down = true;
    await db
      .update(schema.ptClientRelationships)
      .set({ status: "terminated" })
      .where(eq(schema.ptClientRelationships.id, REL_CA));
    await safeFreezeChatChannel(REL_CA); // never throws
    await expect(freezeChatChannel(REL_CA)).rejects.toThrow(/500/);
  });

  it("coaching that resumes re-adds the client and unfreezes the thread", async () => {
    await provisionChatChannel(REL_CA);
    await end(COACH_C, ATHLETE_A);
    await db
      .update(schema.ptClientRelationships)
      .set({ status: "active" })
      .where(eq(schema.ptClientRelationships.id, REL_CA));
    expect(await reconcileChatChannels()).toMatchObject({ provisioned: 2 });
    const ch = stream.channels.get(channelIdFor(REL_CA))!;
    expect(ch.frozen).toBe(false);
    expect([...ch.members].sort()).toEqual([COACH_C, ATHLETE_A].sort());
    expect(await channelRow(REL_CA)).toMatchObject({
      state: "active",
      frozenAt: null,
    });
  });
});

// ─── Design E test 1: tokens, and the channel list ──────────────────────────

describe("design E test 1: a token is only ever for the caller's own user", () => {
  it("issues a 24-hour token for the caller and upserts their Stream user", async () => {
    await provisionChatChannel(REL_CA);
    stream.users.clear();
    const res = await http("POST", "/chat/token", ATHLETE_A, {
      userId: COACH_C, // ignored: nothing in the request picks the user
    });
    expect(res.status).toBe(200);
    expect(res.json.data).toMatchObject({
      apiKey: TEST_STREAM_KEY,
      userId: ATHLETE_A,
    });
    const claims = verifyHs256(res.json.data.token, TEST_STREAM_SECRET);
    expect(claims.user_id).toBe(ATHLETE_A);
    expect(new Date(res.json.data.expiresAt).getTime()).toBe(
      (claims.exp as number) * 1000,
    );
    expect((claims.exp as number) - (claims.iat as number)).toBe(86_400);
    expect([...stream.users.keys()]).toEqual([ATHLETE_A]);
  });

  it("refuses callers with no active or frozen channel, and anonymous callers", async () => {
    await provisionChatChannel(REL_CA);
    const stranger = await http("POST", "/chat/token", STRANGER);
    expect(stranger.status).toBe(403);
    expect(stranger.json.code).toBe("chat_not_available");
    expect((await http("POST", "/chat/token", null)).status).toBe(401);
    expect((await http("GET", "/chat/channels", null)).status).toBe(401);
    // A pending (unprovisioned) channel isn't one yet.
    expect((await http("POST", "/chat/token", COACH_E)).status).toBe(403);
  });

  it("the coach of an ended relationship still gets a token; the athlete doesn't", async () => {
    await provisionChatChannel(REL_CA);
    await end(COACH_C, ATHLETE_A);
    expect((await http("POST", "/chat/token", COACH_C)).status).toBe(200);
    // A's only other coach, E, has no channel yet.
    expect((await http("POST", "/chat/token", ATHLETE_A)).status).toBe(403);
  });

  it("answers 502 when Stream refuses the user upsert", async () => {
    await provisionChatChannel(REL_CA);
    stream.failOn(/POST \/users/);
    const res = await http("POST", "/chat/token", COACH_C);
    expect(res.status).toBe(502);
    expect(res.json.code).toBe("chat_unavailable");
  });

  it("an athlete with two coaches lists both; a stranger lists none", async () => {
    await reconcileChatChannels();
    const athlete = await http("GET", "/chat/channels", ATHLETE_A);
    expect(athlete.status).toBe(200);
    expect(athlete.json.data.map((c: Json) => c.otherParty.id).sort()).toEqual(
      [COACH_C, COACH_E].sort(),
    );
    expect(athlete.json.data.every((c: Json) => c.state === "active")).toBe(
      true,
    );
    const coachE = await http("GET", "/chat/channels", COACH_E);
    expect(coachE.json.data).toEqual([
      expect.objectContaining({
        relationshipId: REL_EA,
        otherParty: expect.objectContaining({ id: ATHLETE_A }),
      }),
    ]);
    expect((await http("GET", "/chat/channels", STRANGER)).json.data).toEqual(
      [],
    );
  });
});

// ─── Chat not configured: fail safe ─────────────────────────────────────────

describe("chat not configured (empty Stream keys)", () => {
  beforeEach(() => {
    setStreamClientForTests(null);
    delete process.env.STREAM_API_KEY;
    delete process.env.STREAM_API_SECRET;
  });

  it("the token route answers 503 chat_not_configured", async () => {
    const res = await http("POST", "/chat/token", ATHLETE_A);
    expect(res.status).toBe(503);
    expect(res.json.code).toBe("chat_not_configured");
  });

  it("every hook and the scheduler job are no-ops that touch nothing", async () => {
    expect(await provisionChatChannel(REL_CA)).toBe("not_configured");
    expect(await freezeChatChannel(REL_CA)).toBe("not_configured");
    expect(await reconcileChatChannels()).toMatchObject({ notConfigured: 1 });
    expect((await end(COACH_C, ATHLETE_A)).ok).toBe(true);
    expect(await db.select().from(schema.chatChannels)).toEqual([]);
    expect(stream.calls).toEqual([]);
  });

  it("the webhook answers 503", async () => {
    const res = await webhook(messageNew(REL_CA, ATHLETE_A));
    expect(res.status).toBe(503);
  });
});

// ─── Design E test 4: the webhook ───────────────────────────────────────────

describe("design E test 4: the Stream webhook", () => {
  beforeEach(async () => {
    await reconcileChatChannels();
  });

  it("rejects unsigned and wrongly signed requests with 401", async () => {
    const event = messageNew(REL_CA, ATHLETE_A);
    expect((await webhook(event, null)).status).toBe(401);
    expect((await webhook(event, "not-hex")).status).toBe(401);
    expect((await webhook(event, "abcd")).status).toBe(401);
    expect(
      (await webhook(event, sign(JSON.stringify(event), "wrong-secret")))
        .status,
    ).toBe(401);
    expect(await messageEvents()).toEqual([]);
  });

  it("a client message writes one message_received event and pushes the coach, deduplicated on the message id", async () => {
    const event = messageNew(REL_CA, ATHLETE_A, "msg-1");
    const res = await webhook(event);
    expect(res.status).toBe(200);
    expect(await webhook(event)).toHaveProperty("status", 200); // Stream retry
    const rows = await messageEvents();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      trainerId: COACH_C,
      clientId: ATHLETE_A,
      relationshipId: REL_CA,
      entityType: "chat_message",
      payload: { messageId: "msg-1", channelId: `coach-${REL_CA}` },
      dedupeKey: "message_received:msg-1",
      pushState: "sent",
    });
    expect(holder.pushes).toHaveLength(1);
    expect(holder.pushes[0]).toMatchObject({
      userId: COACH_C,
      payload: {
        type: "coach_event",
        title: "Lena sent you a message",
        message: "Tap to reply.",
      },
    });
    // The text never reaches our database.
    expect(JSON.stringify(rows[0])).not.toContain("move tomorrow");
  });

  it("only the coach of that channel hears about it", async () => {
    await webhook(messageNew(REL_EA, ATHLETE_A));
    const rows = await messageEvents();
    expect(rows.map((r) => r.trainerId)).toEqual([COACH_E]);
  });

  it("a muted client is recorded but never pushed", async () => {
    await db.insert(schema.coachClientSettings).values({
      relationshipId: REL_CA,
      trainerId: COACH_C,
      clientId: ATHLETE_A,
      alertMode: "mute",
    });
    await webhook(messageNew(REL_CA, ATHLETE_A));
    const rows = await messageEvents();
    expect(rows.map((r) => r.pushState)).toEqual(["skipped"]);
    expect(holder.pushes).toEqual([]);
  });

  it("during the coach's quiet hours the push is held", async () => {
    const hhmm = (offsetMin: number) => {
      const d = new Date(Date.now() + offsetMin * 60_000);
      return new Intl.DateTimeFormat("en-GB", {
        timeZone: "Europe/London",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).format(d);
    };
    await db.insert(schema.coachNotificationSettings).values({
      trainerId: COACH_C,
      quietEnabled: true,
      quietFrom: hhmm(-60),
      quietUntil: hhmm(60),
    });
    await webhook(messageNew(REL_CA, ATHLETE_A));
    expect((await messageEvents()).map((r) => r.pushState)).toEqual(["held"]);
    expect(holder.pushes).toEqual([]);
  });

  it("a coach who turned message pushes off gets the event in-app only", async () => {
    await db.insert(schema.coachNotificationSettings).values({
      trainerId: COACH_C,
      channels: { message_received: "off" },
    });
    await webhook(messageNew(REL_CA, ATHLETE_A));
    expect((await messageEvents()).map((r) => r.pushState)).toEqual(["none"]);
    expect(holder.pushes).toEqual([]);
  });

  it("ignores the coach's own messages, system messages, other events, unknown and frozen channels", async () => {
    const ignored = [
      messageNew(REL_CA, COACH_C),
      messageNew(REL_CA, ATHLETE_A, randomUUID(), { type: "system" }),
      { ...messageNew(REL_CA, ATHLETE_A), type: "message.read" },
      { ...messageNew(REL_CA, ATHLETE_A), channel_type: "messaging" },
      {
        ...messageNew(REL_CA, ATHLETE_A),
        channel_id: `coach-${randomUUID()}`,
      },
      { type: "message.new", channel_type: "coaching" },
    ];
    for (const event of ignored) {
      const res = await webhook(event);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ignored: true });
    }
    await end(COACH_C, ATHLETE_A);
    const late = await webhook(messageNew(REL_CA, ATHLETE_A));
    expect(await late.json()).toEqual({ ignored: true });
    expect(await messageEvents()).toEqual([]);
  });

  it("a thread reply counts; a sender taken from the event's user works too", async () => {
    const event = messageNew(REL_CA, ATHLETE_A, "reply-1", {
      type: "reply",
      user: undefined,
      created_at: "not a date",
    });
    expect((await webhook(event)).status).toBe(200);
    const rows = await messageEvents();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.occurredAt).toBeInstanceOf(Date);
    expect(Number.isNaN(rows[0]!.occurredAt.getTime())).toBe(false);
  });

  it("rejects a signed body that isn't JSON with 400", async () => {
    const res = await webhook("{not json");
    expect(res.status).toBe(400);
  });

  it("very long message ids are hashed into the dedupe key", () => {
    expect(messageDedupeKey("short")).toBe("message_received:short");
    const long = messageDedupeKey("x".repeat(255));
    expect(long).toMatch(/^message_received:[0-9a-f]{64}$/);
    expect(long.length).toBeLessThanOrEqual(200);
  });

  it("isValidStreamSignature is a strict HMAC-SHA256 hex check", () => {
    const body = '{"type":"message.new"}';
    expect(isValidStreamSignature(body, sign(body), TEST_STREAM_SECRET)).toBe(
      true,
    );
    expect(
      isValidStreamSignature(`${body} `, sign(body), TEST_STREAM_SECRET),
    ).toBe(false);
    expect(isValidStreamSignature(body, null, TEST_STREAM_SECRET)).toBe(false);
    expect(isValidStreamSignature(body, "", TEST_STREAM_SECRET)).toBe(false);
  });
});

// ─── The `coaching` channel type (Inspector Brad, #570) ─────────────────────

describe("the coaching channel type", () => {
  it("is ensured with member-only grants before the first channel, once per container", async () => {
    await reconcileChatChannels();
    expect(stream.channelTypes.get("coaching")!.grants).toEqual(
      COACHING_GRANTS,
    );
    // Two channels provisioned, one ensure.
    expect(stream.calls.filter((c) => c.path === "/channeltypes").length).toBe(
      1,
    );
    expect(
      stream.calls.filter((c) => c.path.startsWith("/channels/coaching/"))
        .length,
    ).toBeGreaterThan(0);
    expect(
      stream.calls.some((c) => c.path.startsWith("/channels/messaging/")),
    ).toBe(false);
    expect((await channelRow(REL_CA))!.streamChannelType).toBe("coaching");
  });

  it("a failed ensure isn't remembered: the next provisioning tries again", async () => {
    stream.failOn(/PUT \/channeltypes\/coaching/, 1);
    await safeProvisionChatChannel(REL_CA);
    expect((await channelRow(REL_CA))!.state).toBe("pending");
    expect(await provisionChatChannel(REL_CA)).toBe("provisioned");
    expect(stream.channelTypes.get("coaching")!.grants.user).toEqual([]);
  });
});

// ─── Account purge erases the user from Stream (Inspector Brad, #570) ───────

describe("account purge: erasing a deleted user from Stream chat, only after the purge commits", () => {
  const softDelete = (id: string) =>
    db
      .update(schema.profiles)
      .set({ deletedAt: new Date(Date.now() - 31 * 86_400_000) })
      .where(eq(schema.profiles.id, id));

  /** The real purge row ops: the user's relationships and profile go. */
  async function purgeRows(userId: string): Promise<boolean> {
    const [row] = await db
      .select({ deletedAt: schema.profiles.deletedAt })
      .from(schema.profiles)
      .where(eq(schema.profiles.id, userId));
    if (!row || row.deletedAt === null) return false; // restored
    await db
      .delete(schema.ptClientRelationships)
      .where(eq(schema.ptClientRelationships.clientId, userId));
    await db
      .delete(schema.ptClientRelationships)
      .where(eq(schema.ptClientRelationships.trainerId, userId));
    await db.delete(schema.profiles).where(eq(schema.profiles.id, userId));
    return true;
  }

  /** One nightly run: the sweep, then the drain (as the cron runs them). */
  async function night(
    userId: string,
    beforePurge: () => Promise<void> = async () => {},
  ) {
    const swept = await accountPurgeCron({
      accountRepo: {
        listPendingPurge: async () => [userId],
        purgeUserData: async (id: string) => {
          await beforePurge();
          return purgeRows(id);
        },
      },
      cancelStripeSubscriptions: async () => {},
      deleteAuthUser: async () => {},
      deleteAvatar: async () => {},
      queuePrivateMediaPurge,
      now: new Date(),
    });
    const drained = await drainPrivateMediaPurges(
      eraseAfterPurge({ startedAt: new Date() }),
    );
    return { swept, drained };
  }

  const queued = () => db.select().from(schema.privateMediaPurges);

  beforeEach(async () => {
    vi.mocked(deleteAllUserMedia).mockClear();
    await reconcileChatChannels();
    const client = new StreamChatClient(
      { apiKey: TEST_STREAM_KEY, apiSecret: TEST_STREAM_SECRET },
      stream.fetch,
    );
    await client.sendMessage(channelIdFor(REL_CA), {
      id: "from-lena",
      text: "hi coach",
      userId: ATHLETE_A,
    });
    await client.sendMessage(channelIdFor(REL_CA), {
      id: "from-ellie",
      text: "hi Lena",
      userId: COACH_C,
    });
  });

  it("a normal purge erases the athlete from Stream after the commit: channels frozen without them, user and messages hard-deleted", async () => {
    await softDelete(ATHLETE_A);
    const { swept, drained } = await night(ATHLETE_A, async () => {
      // Nothing irreversible has happened in Stream before the purge.
      expect(stream.deletedUsers).toEqual([]);
      expect(stream.channels.get(channelIdFor(REL_CA))!.frozen).toBe(false);
    });
    expect(swept).toMatchObject({ purged: 1, failed: 0 });
    expect(drained).toMatchObject({ deleted: 1, failed: 0 });
    for (const rel of [REL_CA, REL_EA]) {
      const ch = stream.channels.get(channelIdFor(rel))!;
      expect(ch.frozen).toBe(true);
      expect(ch.members.has(ATHLETE_A)).toBe(false);
      expect(await channelRow(rel)).toBeUndefined(); // cascaded with the purge
    }
    expect(stream.deletedUsers).toEqual([ATHLETE_A]);
    // The coach keeps their own messages, read-only; Lena's are gone.
    expect(
      stream.channels.get(channelIdFor(REL_CA))!.messages.map((m) => m.id),
    ).toEqual(["from-ellie"]);
    expect(deleteAllUserMedia).toHaveBeenCalledWith(ATHLETE_A);
    expect(await queued()).toEqual([]);
  });

  it("an account restored in the window keeps everything in Stream, and nothing stays queued", async () => {
    await softDelete(ATHLETE_A);
    stream.calls = [];
    const { swept, drained } = await night(ATHLETE_A, async () => {
      // Restore lands between the queue step and the purge's lock.
      await db
        .update(schema.profiles)
        .set({ deletedAt: null })
        .where(eq(schema.profiles.id, ATHLETE_A));
    });
    expect(swept).toMatchObject({ restored: 1, purged: 0 });
    expect(drained).toMatchObject({ restored: 1, deleted: 0 });
    expect(stream.calls).toEqual([]);
    expect(stream.deletedUsers).toEqual([]);
    const ch = stream.channels.get(channelIdFor(REL_CA))!;
    expect(ch.frozen).toBe(false);
    expect(ch.members.has(ATHLETE_A)).toBe(true);
    expect(ch.messages).toHaveLength(2);
    expect((await channelRow(REL_CA))!.state).toBe("active");
    expect(deleteAllUserMedia).not.toHaveBeenCalled();
    expect(await queued()).toEqual([]);
  });

  it("a Stream failure keeps the account queued, and the next night finishes it", async () => {
    await softDelete(ATHLETE_A);
    stream.failOn(/POST \/users\/delete/, 1);
    const first = await night(ATHLETE_A);
    expect(first.swept).toMatchObject({ purged: 1 });
    expect(first.drained).toMatchObject({ failed: 1, deleted: 0 });
    expect((await queued()).map((q) => q.userId)).toEqual([ATHLETE_A]);
    expect(stream.deletedUsers).toEqual([]);

    // Next night: the account is no longer pending; the drain retries it.
    const drained = await drainPrivateMediaPurges(
      eraseAfterPurge({ startedAt: new Date() }),
    );
    expect(drained).toMatchObject({ deleted: 1, failed: 0 });
    expect(stream.deletedUsers).toEqual([ATHLETE_A]);
    expect(await queued()).toEqual([]);
  });

  it("a coach's erasure freezes only their channels", async () => {
    expect(await eraseChatUser(COACH_C)).toBe("erased");
    expect(stream.channels.get(channelIdFor(REL_CA))!.frozen).toBe(true);
    expect(stream.channels.get(channelIdFor(REL_EA))!.frozen).toBe(false);
    expect(stream.deletedUsers).toEqual([COACH_C]);
  });

  it("is idempotent: a user Stream no longer has counts as erased", async () => {
    expect(await eraseChatUser(ATHLETE_A)).toBe("erased");
    stream.calls = [];
    expect(await eraseChatUser(ATHLETE_A)).toBe("erased");
    expect(stream.calls.map((c) => c.path)).toEqual([
      "/channels",
      "/users/delete",
    ]);
  });

  it("pages through many channels", async () => {
    const client = new StreamChatClient(
      { apiKey: TEST_STREAM_KEY, apiSecret: TEST_STREAM_SECRET },
      stream.fetch,
    );
    for (let i = 0; i < 35; i++) {
      await client.getOrCreateChannel(`coach-extra-${i}`, COACH_C, [
        COACH_C,
        ATHLETE_A,
      ]);
    }
    expect((await client.coachingChannelsOf(ATHLETE_A)).length).toBe(37);
  });

  it("a channel Stream can't find is skipped; another channel failure throws", async () => {
    const original = stream.fetch;
    stream.fetch = async (input, init) =>
      String(input).includes(channelIdFor(REL_EA)) && init.method === "POST"
        ? {
            ok: false,
            status: 404,
            text: async () => '{"code":16,"message":"gone"}',
          }
        : original(input, init);
    configure();
    expect(await eraseChatUser(ATHLETE_A)).toBe("erased");
    stream.fetch = original;
    configure();
    expect(stream.deletedUsers).toEqual([ATHLETE_A]);
  });

  it("any other Stream failure on a channel throws (the row stays queued)", async () => {
    stream.failOn(/PATCH/);
    await expect(eraseChatUser(ATHLETE_A)).rejects.toThrow(/503/);
    expect(stream.deletedUsers).toEqual([]);
  });

  it("does nothing on a stage without Stream keys", async () => {
    setStreamClientForTests(null);
    stream.calls = [];
    expect(await eraseChatUser(ATHLETE_A)).toBe("not_configured");
    expect(stream.calls).toEqual([]);
  });

  it("a delete task still running keeps the row queued; next night Stream no longer has the user, which is done", async () => {
    await softDelete(ATHLETE_A);
    stream.taskStatus = "running";
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    try {
      const run = night(ATHLETE_A);
      await vi.runAllTimersAsync();
      const { drained } = await run;
      // Deferred, not failed: no alarm, and the row stays.
      expect(drained).toMatchObject({ deleted: 0, waiting: 1, failed: 0 });
    } finally {
      vi.useRealTimers();
    }
    expect((await queued()).map((q) => q.userId)).toEqual([ATHLETE_A]);
    await expect(eraseChatUser(ATHLETE_A)).resolves.toBe("erased");
    stream.taskStatus = "completed";
    const next = await drainPrivateMediaPurges(
      eraseAfterPurge({ startedAt: new Date() }),
    );
    expect(next).toMatchObject({ deleted: 1, waiting: 0 });
    expect(await queued()).toEqual([]);
  });

  it("eraseChatUser throws StreamDeletePendingError while Stream is still deleting", async () => {
    stream.taskStatus = "running";
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    try {
      const pending = eraseChatUser(ATHLETE_A).catch((e: unknown) => e);
      await vi.runAllTimersAsync();
      expect(await pending).toBeInstanceOf(StreamDeletePendingError);
    } finally {
      vi.useRealTimers();
    }
  });
});

// ─── The drain is bounded (Inspector Brad, #570 round 3) ────────────────────

describe("post-purge erasure budget", () => {
  /** Two purged accounts queued (profiles gone, as after the purge). */
  async function purgedPair(): Promise<string[]> {
    const ids = [randomUUID(), randomUUID()];
    const client = new StreamChatClient(
      { apiKey: TEST_STREAM_KEY, apiSecret: TEST_STREAM_SECRET },
      stream.fetch,
    );
    await client.upsertUsers(ids.map((id) => ({ id })));
    for (const id of ids) await queuePrivateMediaPurge(id);
    return ids;
  }
  const queuedIds = async () =>
    (await db.select().from(schema.privateMediaPurges)).map((q) => q.userId);

  beforeEach(() => vi.mocked(deleteAllUserMedia).mockClear());

  it("past the deadline, no Stream erasure starts and every row stays queued, but every bucket is still deleted", async () => {
    const ids = await purgedPair();
    stream.calls = [];
    const drained = await drainPrivateMediaPurges(
      eraseAfterPurge({
        startedAt: new Date(Date.now() - 121_000),
      }),
    );
    expect(drained).toMatchObject({ deleted: 0, waiting: 2, failed: 0 });
    expect(stream.calls).toEqual([]);
    // The bucket delete has no budget (PER-121 as before).
    expect(
      vi
        .mocked(deleteAllUserMedia)
        .mock.calls.map((c) => c[0])
        .sort(),
    ).toEqual([...ids].sort());
    expect((await queuedIds()).sort()).toEqual([...ids].sort());
  });

  it("with the Stream budget used up, the bucket is still deleted for every row", async () => {
    const ids = await purgedPair();
    const drained = await drainPrivateMediaPurges(
      eraseAfterPurge({ startedAt: new Date(), maxChatErasures: 0 }),
    );
    expect(drained).toMatchObject({ waiting: 2, deleted: 0 });
    expect(deleteAllUserMedia).toHaveBeenCalledTimes(2);
    expect(stream.deletedUsers).toEqual([]);
    expect((await queuedIds()).sort()).toEqual([...ids].sort());
  });

  it("two rows whose Stream erasure always fails don't starve the rows behind them", async () => {
    const [bad1, bad2] = await purgedPair();
    // Queued first, so they head the queue.
    await db
      .update(schema.privateMediaPurges)
      .set({ queuedAt: new Date(Date.now() - 3_600_000) });
    const fresh = [randomUUID(), randomUUID()];
    const client = new StreamChatClient(
      { apiKey: TEST_STREAM_KEY, apiSecret: TEST_STREAM_SECRET },
      stream.fetch,
    );
    await client.upsertUsers(fresh.map((id) => ({ id })));
    for (const id of fresh) await queuePrivateMediaPurge(id);
    const failing = new RegExp(`/users/delete`);
    const original = stream.fetch;
    stream.fetch = async (input, init) =>
      failing.test(String(input)) &&
      [bad1, bad2].some((b) => (init.body as string).includes(b!))
        ? { ok: false, status: 500, text: async () => '{"message":"boom"}' }
        : original(input, init);
    configure();

    // Night 1: the two bad rows use up the failure budget; the fresh rows
    // still get their bucket deleted, and every kept row moves behind.
    const night1 = await drainPrivateMediaPurges(
      eraseAfterPurge({ startedAt: new Date() }),
    );
    expect(night1).toMatchObject({ failed: 2, waiting: 2, deleted: 0 });
    expect(deleteAllUserMedia).toHaveBeenCalledTimes(4);

    // Night 2: the fresh rows now head the queue and are erased in Stream;
    // the bad rows fail again behind them.
    vi.mocked(deleteAllUserMedia).mockClear();
    const night2 = await drainPrivateMediaPurges(
      eraseAfterPurge({ startedAt: new Date() }),
    );
    expect(night2).toMatchObject({ deleted: 2, failed: 2, waiting: 0 });
    expect(stream.deletedUsers.sort()).toEqual([...fresh].sort());
    expect((await queuedIds()).sort()).toEqual([bad1, bad2].sort());
    expect(deleteAllUserMedia).toHaveBeenCalledTimes(4);
    stream.fetch = original;
  });

  it("stops at the per-run cap; the rest wait for the next night", async () => {
    await purgedPair();
    const drained = await drainPrivateMediaPurges(
      eraseAfterPurge({ startedAt: new Date(), maxChatErasures: 1 }),
    );
    expect(drained).toMatchObject({ deleted: 1, waiting: 1 });
    expect(stream.deletedUsers).toHaveLength(1);
    expect(await queuedIds()).toHaveLength(1);
  });

  it("while Stream is failing, stops after the first failure instead of trying every row", async () => {
    await purgedPair();
    stream.down = true;
    stream.calls = [];
    const drained = await drainPrivateMediaPurges(
      eraseAfterPurge({ startedAt: new Date(), maxChatFailures: 1 }),
    );
    expect(drained).toMatchObject({ failed: 1, waiting: 1, deleted: 0 });
    expect(stream.calls).toHaveLength(1); // one attempt, then it stops
    expect(deleteAllUserMedia).toHaveBeenCalledTimes(2); // buckets still go
    expect(await queuedIds()).toHaveLength(2);
  });

  it("the defaults are 120 s, 20 erasures and 2 failures per run", () => {
    expect(ERASE_DEADLINE_MS).toBe(120_000);
    expect(MAX_CHAT_ERASURES_PER_RUN).toBe(20);
    expect(MAX_CHAT_FAILURES_PER_RUN).toBe(2);
  });

  it("without Stream keys a row is bucket-only and never deferred, as before", async () => {
    await purgedPair();
    setStreamClientForTests(null);
    const drained = await drainPrivateMediaPurges(
      eraseAfterPurge({
        startedAt: new Date(Date.now() - 600_000),
        maxChatErasures: 0,
      }),
    );
    expect(drained).toMatchObject({ deleted: 2, waiting: 0 });
    expect(deleteAllUserMedia).toHaveBeenCalledTimes(2);
    expect(await queuedIds()).toEqual([]);
  });
});

// ─── The scheduler job is time-bounded (Inspector Brad, #570 round 5) ──────

describe("chat_channels is bounded in time, so the jobs after it still run", () => {
  /** Extra active relationships, so a tick has more than two to do. */
  async function moreClients(n: number): Promise<string[]> {
    const ids: string[] = [];
    for (let i = 0; i < n; i++) {
      const id = randomUUID();
      await db
        .insert(schema.profiles)
        .values({ id, fullName: `Client ${i}`, role: "user" });
      const [rel] = await db
        .insert(schema.ptClientRelationships)
        .values({ trainerId: COACH_C, clientId: id, status: "active" })
        .returning();
      ids.push(rel!.id);
    }
    return ids;
  }

  it("the defaults are 90 s and 2 failures per tick", () => {
    expect(RECONCILE_DEADLINE_MS).toBe(90_000);
    expect(RECONCILE_MAX_FAILURES).toBe(2);
  });

  it("past the deadline nothing new starts, the rest stays pending, and the next job still runs", async () => {
    stream.calls = [];
    const later = vi.fn(async () => ({ ran: 1 }));
    const tickStart = new Date(Date.now() - 91_000); // 91 s into the tick
    const result = await runCoachScheduler(
      [chatChannelsJob, { name: "after_chat", cadence: "tick", run: later }],
      { now: tickStart, dispatcher: new NotificationDispatcher() },
    );
    expect(result.jobs.chat_channels).toMatchObject({
      status: "ran",
      summary: { provisioned: 0, deferred: 2 },
    });
    expect(stream.calls).toEqual([]);
    expect(await channelRow(REL_CA)).toBeUndefined(); // next tick
    expect(later).toHaveBeenCalledTimes(1);
    expect(result.jobs.after_chat).toMatchObject({ status: "ran" });
  });

  it("with Stream failing, it stops after 2 failures and defers the rest", async () => {
    await moreClients(3); // 5 to provision in all
    await reconcileChatChannels(); // types ensured once for this container
    await db.delete(schema.chatChannels);
    stream.calls = [];
    stream.failOn(/POST \/users$/);
    const summary = await reconcileChatChannels();
    expect(summary).toMatchObject({
      provisionFailed: 2,
      provisioned: 0,
      deferred: 3,
    });
    expect(stream.calls.filter((c) => c.path === "/users").length).toBe(2);
  });

  it("a failed ensure counts toward the stop; freezing stops after the second failure", async () => {
    const extra = await moreClients(2);
    await reconcileChatChannels();
    for (const rel of [REL_CA, REL_EA, ...extra]) {
      await db
        .update(schema.ptClientRelationships)
        .set({ status: "terminated" })
        .where(eq(schema.ptClientRelationships.id, rel));
    }
    configure(); // a fresh container: the ensure runs (and fails) again
    stream.down = true;
    const summary = await reconcileChatChannels();
    expect(summary).toMatchObject({
      ensureFailed: 1,
      freezeFailed: 1,
      frozen: 0,
      deferred: 3,
    });
  });

  it("a full tick with a hanging Stream still runs sessionRemindersJob", async () => {
    await moreClients(5);
    // Each Stream call "hangs" until its 8 s timeout (simulated clock).
    const original = stream.fetch;
    stream.fetch = async (input, init) => {
      vi.setSystemTime(Date.now() + 8_000);
      return {
        ok: false,
        status: 0,
        text: async () => "",
        ...(await original(input, init).then(() => ({}))),
      };
    };
    configure();
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      const tickStart = new Date();
      const result = await runCoachScheduler(
        [chatChannelsJob, sessionRemindersJob],
        { now: tickStart, dispatcher: new NotificationDispatcher() },
      );
      expect(result.jobs.chat_channels).toMatchObject({ status: "ran" });
      const chat = (
        result.jobs.chat_channels as { summary: Record<string, number> }
      ).summary;
      expect(chat.deferred).toBeGreaterThan(0);
      // Well inside the Lambda's 300 s: the budget stopped the chat job.
      expect(Date.now() - tickStart.getTime()).toBeLessThan(120_000);
      expect(result.jobs.session_reminders).toMatchObject({ status: "ran" });
    } finally {
      vi.useRealTimers();
      stream.fetch = original;
    }
  });
});

// ─── Channel types are locked down on the token route and every tick ────────

describe("locking the channel types down (Inspector Brad, #570 round 3)", () => {
  it("POST /chat/token ensures the types before issuing a token", async () => {
    await provisionChatChannel(REL_CA);
    // A fresh container: types not yet ensured, and a stage still unlocked.
    configure();
    stream.channelTypes.get("messaging")!.grants.user = ["create-channel"];
    const res = await http("POST", "/chat/token", COACH_C);
    expect(res.status).toBe(200);
    expect(stream.channelTypes.get("messaging")!.grants.user).toEqual([]);
  });

  it("fails closed: no token while the types can't be locked down", async () => {
    await provisionChatChannel(REL_CA);
    configure();
    stream.failOn(/PUT \/channeltypes\/messaging/);
    const res = await http("POST", "/chat/token", COACH_C);
    expect(res.status).toBe(503);
    expect(res.json.code).toBe("chat_unavailable");
    expect(res.json.data).toBeUndefined();
  });

  it("each scheduler tick ensures them, even with nothing to provision", async () => {
    await reconcileChatChannels();
    configure();
    stream.channelTypes.get("team")!.grants.user = ["create-channel"];
    expect(await reconcileChatChannels()).toMatchObject({
      ensureFailed: 0,
      provisioned: 0,
    });
    expect(stream.channelTypes.get("team")!.grants.user).toEqual([]);
  });

  it("a failed ensure skips provisioning that tick, but freezing still runs", async () => {
    await provisionChatChannel(REL_CA);
    await db
      .update(schema.ptClientRelationships)
      .set({ status: "terminated" })
      .where(eq(schema.ptClientRelationships.id, REL_CA));
    configure();
    stream.failOn(/PUT \/channeltypes\/coaching/);
    const summary = await reconcileChatChannels();
    expect(summary).toMatchObject({
      ensureFailed: 1,
      provisioned: 0,
      provisionFailed: 0,
      frozen: 1,
    });
    expect(await channelRow(REL_EA)).toBeUndefined();
  });
});

// ─── Migration 7 ─────────────────────────────────────────────────────────────

describe("migration 20261125162525_chat_channels", () => {
  it("applies twice, rolls back and re-applies, with RLS on, no policies and its checks", async () => {
    const fresh = await baseDatabase();
    try {
      const sql = await read(MIGRATIONS, MIGRATION);
      await fresh.exec(sql);
      await fresh.exec(sql);
      await fresh.exec(await read(ROLLBACKS, MIGRATION));
      const gone = await fresh.query<{ n: number }>(
        "select count(*)::int as n from pg_tables where tablename = 'chat_channels'",
      );
      expect(gone.rows[0]!.n).toBe(0);
      await fresh.exec(sql);
      const tables = await fresh.query<{ rls: boolean }>(
        "select rowsecurity as rls from pg_tables where tablename = 'chat_channels'",
      );
      expect(tables.rows).toEqual([{ rls: true }]);
      const policies = await fresh.query<{ n: number }>(
        "select count(*)::int as n from pg_policies where tablename = 'chat_channels'",
      );
      expect(policies.rows[0]!.n).toBe(0);
      await expect(
        fresh.exec(
          `insert into chat_channels (relationship_id, stream_channel_id, trainer_id, client_id, state) values ('${randomUUID()}', 'x', '${randomUUID()}', '${randomUUID()}', 'active')`,
        ),
      ).rejects.toThrow(); // no such relationship
    } finally {
      await fresh.close();
    }
  });

  it("checks the state and channel type, and cascades with the relationship", async () => {
    await expect(
      pg.exec(
        `insert into chat_channels (relationship_id, stream_channel_id, trainer_id, client_id, state) values ('${REL_CA}', 'coach-x', '${COACH_C}', '${ATHLETE_A}', 'archived')`,
      ),
    ).rejects.toThrow();
    await expect(
      pg.exec(
        `insert into chat_channels (relationship_id, stream_channel_type, stream_channel_id, trainer_id, client_id) values ('${REL_CA}', 'team', 'coach-x', '${COACH_C}', '${ATHLETE_A}')`,
      ),
    ).rejects.toThrow();
    await provisionChatChannel(REL_CA);
    await db
      .delete(schema.ptClientRelationships)
      .where(
        and(
          eq(schema.ptClientRelationships.id, REL_CA),
          eq(schema.ptClientRelationships.trainerId, COACH_C),
        ),
      );
    expect(await channelRow(REL_CA)).toBeUndefined();
  });
});
