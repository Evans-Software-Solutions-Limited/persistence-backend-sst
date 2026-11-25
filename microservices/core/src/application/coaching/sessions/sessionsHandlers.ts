import Elysia, { t } from "elysia";
import {
  getAuthUser,
  getUser,
  requireAuth,
} from "@persistence/api-utils/auth/supabaseAuth";
import { readIdempotencyKey } from "../../shared/idempotencyKey";
import { stripNul } from "../../shared/stripNul";
import { resolveCoachScope } from "../../relationships/resolveCoachScope";
import { isActiveTrainer } from "../clientProfileRepository";
import { listAsOf } from "../forms/formRepository";
import {
  CALENDAR_MAX_DAYS,
  LOCATION_MAX,
  MAX_ATTENDEES,
  NOTES_MAX,
  VIDEO_URL_MAX,
  athleteSessions,
  cancelSessions,
  coachCalendar,
  createSessions,
  findCreated,
  isOwnWorkout,
  patchSessions,
  respondToSession,
  type AttendeeRef,
  type CoachSessionDTO,
  type SessionChange,
  type SessionPatch,
} from "./sessionRepository";
import { announceSessionChanges } from "./sessionNotifications";
import { MAX_OCCURRENCES } from "./sessionTimes";
import { TICK_MINUTES } from "../scheduler/coachScheduler";

/**
 * PER-123 (BE-I2, design I C4): the coach calendar, booking sessions (with
 * weekly repeats), editing and cancelling them by `this` or `series`, and the
 * athlete's upcoming sessions with accept or decline.
 *
 * Coach routes need an active trainer and only touch rows with
 * `trainer_id = caller`; every attendee goes through `resolveCoachScope`, so
 * a coach can only book their own active clients. The coach-subscription
 * guard for `/trainers/me/*` (PER-146) covers these routes once it merges.
 */

const authed = () =>
  new Elysia()
    .derive(async ({ headers }) => ({
      user: await getAuthUser(headers.authorization),
    }))
    .onBeforeHandle(requireAuth);

const trainerOnly = () =>
  authed().onBeforeHandle(async (ctx) => {
    if (!(await isActiveTrainer(getUser(ctx).sub))) {
      ctx.set.status = 403;
      return {
        code: "not_a_trainer",
        message: "Coach actions require a trainer role",
      };
    }
  });

const uuid = t.String({ format: "uuid" });
const DAY_MS = 86_400_000;

/**
 * Reminders are sent by the 15-minute coach scheduler, so one shorter than a
 * tick could fall between two runs and never go (Inspector Brad, #568). The
 * migration's CHECK holds the same floor.
 */
export const MIN_REMINDER_MINUTES = TICK_MINUTES;

const kindSchema = t.Union([
  t.Literal("in_person"),
  t.Literal("video"),
  t.Literal("check_in_call"),
  t.Literal("own_training"),
]);

const nullableText = (maxLength: number) =>
  t.Optional(t.Union([t.String({ maxLength }), t.Null()]));

const sessionFields = {
  location: nullableText(LOCATION_MAX),
  videoUrl: nullableText(VIDEO_URL_MAX),
  workoutId: t.Optional(t.Union([uuid, t.Null()])),
  notes: nullableText(NOTES_MAX),
  reminderMinutes: t.Optional(
    t.Union([
      t.Integer({ minimum: MIN_REMINDER_MINUTES, maximum: 10080 }),
      t.Null(),
    ]),
  ),
  clientIds: t.Optional(t.Array(uuid, { maxItems: MAX_ATTENDEES })),
};

/** An ISO date or date-time; null when it isn't one. */
function parseInstant(raw: string | undefined): Date | null {
  if (raw === undefined || raw.trim() === "") return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Sessions are booked to the minute. */
function toMinute(d: Date): Date {
  const out = new Date(d);
  out.setUTCSeconds(0, 0);
  return out;
}

/** Trimmed text, or null when blank. */
function cleanText(raw: string | null | undefined): string | null | undefined {
  if (raw === undefined) return undefined;
  if (raw === null) return null;
  const text = stripNul(raw).trim();
  return text === "" ? null : text;
}

function invalid(set: { status?: number | string }, message: string) {
  set.status = 422;
  return { code: "invalid_session", message };
}

/** Each client must be the caller's active client. */
async function resolveAttendees(
  trainerId: string,
  clientIds: string[],
): Promise<
  { ok: true; attendees: AttendeeRef[] } | { ok: false; clientIds: string[] }
> {
  const unique = [...new Set(clientIds)];
  const attendees: AttendeeRef[] = [];
  const denied: string[] = [];
  for (const clientId of unique) {
    const scope = await resolveCoachScope(trainerId, clientId);
    if (scope.allowed) {
      attendees.push({ clientId, relationshipId: scope.scope.relationshipId });
    } else {
      denied.push(clientId);
    }
  }
  return denied.length > 0
    ? { ok: false, clientIds: denied }
    : { ok: true, attendees };
}

const NOT_YOUR_CLIENT = (clientIds: string[]) => ({
  code: "not_your_client",
  message: "You can only book your active clients",
  clientIds,
});

const WORKOUT_NOT_FOUND = {
  code: "workout_not_found",
  message: "That workout isn't one of yours",
};

const OWN_TRAINING = "Your own training can't have clients booked on it";

/** The checks shared by create and edit, on the fields that were sent. */
async function checkFields(
  trainerId: string,
  set: { status?: number | string },
  body: {
    videoUrl?: string | null;
    workoutId?: string | null;
    clientIds?: string[];
  },
): Promise<
  | { ok: true; attendees?: AttendeeRef[] }
  | { ok: false; response: Record<string, unknown> }
> {
  const videoUrl = cleanText(body.videoUrl);
  if (videoUrl && !/^https:\/\/\S+$/i.test(videoUrl)) {
    return {
      ok: false,
      response: invalid(set, "videoUrl must be an https link"),
    };
  }
  if (body.workoutId && !(await isOwnWorkout(trainerId, body.workoutId))) {
    set.status = 404;
    return { ok: false, response: WORKOUT_NOT_FOUND };
  }
  if (body.clientIds === undefined) return { ok: true };
  const resolved = await resolveAttendees(trainerId, body.clientIds);
  if (!resolved.ok) {
    set.status = 403;
    return { ok: false, response: NOT_YOUR_CLIENT(resolved.clientIds) };
  }
  return { ok: true, attendees: resolved.attendees };
}

const scopeQuery = t.Object({
  scope: t.Optional(t.Union([t.Literal("this"), t.Literal("series")])),
});

/** After the write: events and pushes, best-effort. */
const announce = (trainerId: string, changes: SessionChange[]) =>
  announceSessionChanges(trainerId, changes);

const createResponse = (sessions: CoachSessionDTO[]) => ({
  data: sessions[0],
  series: sessions,
});

export const coachSessionsHandler = trainerOnly()
  .get(
    "/trainers/me/calendar",
    async (ctx) => {
      const from = parseInstant(ctx.query.from);
      const to = parseInstant(ctx.query.to);
      if (!from || !to || to <= from) {
        ctx.set.status = 400;
        return {
          code: "invalid_range",
          message: "from and to must be dates, with to after from",
        };
      }
      if (to.getTime() - from.getTime() > CALENDAR_MAX_DAYS * DAY_MS) {
        ctx.set.status = 400;
        return {
          code: "invalid_range",
          message: `The range can be at most ${CALENDAR_MAX_DAYS} days`,
        };
      }
      const asOf = listAsOf();
      const calendar = await coachCalendar(getUser(ctx).sub, from, to);
      return {
        data: {
          from: from.toISOString(),
          to: to.toISOString(),
          ...calendar,
          asOf,
        },
      };
    },
    {
      query: t.Object({
        from: t.Optional(t.String({ maxLength: 40 })),
        to: t.Optional(t.String({ maxLength: 40 })),
      }),
    },
  )
  .post(
    "/trainers/me/sessions",
    async (ctx) => {
      const trainerId = getUser(ctx).sub;
      const key = readIdempotencyKey(ctx.headers);
      if (key) {
        const replay = await findCreated(trainerId, key);
        if (replay) {
          ctx.set.status = 201;
          return createResponse(replay);
        }
      }
      const body = ctx.body;
      const startsAt = parseInstant(body.startsAt);
      if (!startsAt) return invalid(ctx.set, "startsAt must be a date-time");
      const kind = body.kind;
      const clientIds = body.clientIds ?? [];
      if (kind === "own_training" && clientIds.length > 0) {
        return invalid(ctx.set, OWN_TRAINING);
      }
      const checked = await checkFields(trainerId, ctx.set, {
        ...body,
        clientIds,
      });
      if (!checked.ok) return checked.response;
      const result = await createSessions(
        trainerId,
        {
          kind,
          startsAt: toMinute(startsAt),
          durationMin: body.durationMin,
          location: cleanText(body.location) ?? null,
          videoUrl: cleanText(body.videoUrl) ?? null,
          workoutId: body.workoutId ?? null,
          notes: cleanText(body.notes) ?? null,
          reminderMinutes: body.reminderMinutes ?? null,
        },
        checked.attendees ?? [],
        body.repeat?.count ?? 1,
        key,
      );
      if (result.created) {
        const first = result.sessions[0]!;
        await announce(trainerId, [
          {
            action: "booked",
            session: first,
            // Only the attendees actually booked inside the transaction.
            attendees: result.attendees,
            occurrences: result.sessions.length,
          },
        ]);
      }
      ctx.set.status = 201;
      return createResponse(result.sessions);
    },
    {
      body: t.Object({
        kind: kindSchema,
        startsAt: t.String({ maxLength: 40 }),
        durationMin: t.Integer({ minimum: 5, maximum: 720 }),
        ...sessionFields,
        repeat: t.Optional(
          t.Object({
            frequency: t.Literal("weekly"),
            count: t.Integer({ minimum: 1, maximum: MAX_OCCURRENCES }),
          }),
        ),
      }),
    },
  )
  .patch(
    "/trainers/me/sessions/:id",
    async (ctx) => {
      const trainerId = getUser(ctx).sub;
      const body = ctx.body;
      const patch: SessionPatch = {};
      if (body.kind !== undefined) patch.kind = body.kind;
      if (body.startsAt !== undefined) {
        const startsAt = parseInstant(body.startsAt);
        if (!startsAt) return invalid(ctx.set, "startsAt must be a date-time");
        patch.startsAt = toMinute(startsAt);
      }
      if (body.durationMin !== undefined) patch.durationMin = body.durationMin;
      if (body.location !== undefined)
        patch.location = cleanText(body.location)!;
      if (body.videoUrl !== undefined)
        patch.videoUrl = cleanText(body.videoUrl)!;
      if (body.workoutId !== undefined) patch.workoutId = body.workoutId;
      if (body.notes !== undefined) patch.notes = cleanText(body.notes)!;
      if (body.reminderMinutes !== undefined) {
        patch.reminderMinutes = body.reminderMinutes;
      }
      const checked = await checkFields(trainerId, ctx.set, body);
      if (!checked.ok) return checked.response;
      if (checked.attendees) patch.attendees = checked.attendees;
      const result = await patchSessions(
        trainerId,
        ctx.params.id,
        ctx.query.scope ?? "this",
        patch,
        body.expectedRevision,
      );
      if (!result.ok) {
        switch (result.reason) {
          case "not_found":
            ctx.set.status = 404;
            return { code: "session_not_found", message: "Session not found" };
          case "session_cancelled":
            ctx.set.status = 409;
            return {
              code: "session_cancelled",
              message: "This session was cancelled",
              current: result.current,
            };
          case "revision_conflict":
            ctx.set.status = 409;
            return {
              code: "revision_conflict",
              message: "This session was updated on another device",
              current: result.current,
            };
          case "own_training_attendees":
            return invalid(ctx.set, OWN_TRAINING);
        }
      }
      await announce(trainerId, result.changes);
      const data = result.sessions.find((s) => s.id === ctx.params.id)!;
      return { data, series: result.sessions };
    },
    {
      params: t.Object({ id: uuid }),
      query: scopeQuery,
      body: t.Object({
        kind: t.Optional(kindSchema),
        startsAt: t.Optional(t.String({ maxLength: 40 })),
        durationMin: t.Optional(t.Integer({ minimum: 5, maximum: 720 })),
        ...sessionFields,
        expectedRevision: t.Optional(t.Integer({ minimum: 1 })),
      }),
    },
  )
  .delete(
    "/trainers/me/sessions/:id",
    async (ctx) => {
      const trainerId = getUser(ctx).sub;
      const result = await cancelSessions(
        trainerId,
        ctx.params.id,
        ctx.query.scope ?? "this",
      );
      await announce(trainerId, result.changes);
      // Idempotent: cancelled already, or not there at all → 204.
      ctx.set.status = 204;
      return new Response(null, { status: 204 });
    },
    { params: t.Object({ id: uuid }), query: scopeQuery },
  );

export const athleteCoachSessionsHandler = authed()
  .get(
    "/users/me/coach-sessions",
    async (ctx) => {
      const now = new Date();
      const from = ctx.query.from ? parseInstant(ctx.query.from) : now;
      const to = ctx.query.to
        ? parseInstant(ctx.query.to)
        : from && new Date(from.getTime() + CALENDAR_MAX_DAYS * DAY_MS);
      if (
        !from ||
        !to ||
        to <= from ||
        to.getTime() - from.getTime() > CALENDAR_MAX_DAYS * DAY_MS
      ) {
        ctx.set.status = 400;
        return {
          code: "invalid_range",
          message: `from and to must be dates, to after from, at most ${CALENDAR_MAX_DAYS} days apart`,
        };
      }
      const asOf = listAsOf(now);
      return {
        data: {
          sessions: await athleteSessions(getUser(ctx).sub, from, to),
          from: from.toISOString(),
          to: to.toISOString(),
          asOf,
        },
      };
    },
    {
      query: t.Object({
        from: t.Optional(t.String({ maxLength: 40 })),
        to: t.Optional(t.String({ maxLength: 40 })),
      }),
    },
  )
  .post(
    "/users/me/coach-sessions/:id/respond",
    async (ctx) => {
      const result = await respondToSession(
        getUser(ctx).sub,
        ctx.params.id,
        ctx.body.status,
      );
      if (result.ok) return { data: result.session };
      switch (result.reason) {
        case "not_found":
          ctx.set.status = 404;
          return { code: "session_not_found", message: "Session not found" };
        case "session_cancelled":
          ctx.set.status = 409;
          return {
            code: "session_cancelled",
            message: "This session was cancelled",
          };
        case "not_booked":
          ctx.set.status = 409;
          return {
            code: "not_booked",
            message: "You're no longer booked on this session",
          };
        case "session_started":
          ctx.set.status = 409;
          return {
            code: "session_started",
            message: "This session has already started",
          };
      }
    },
    {
      params: t.Object({ id: uuid }),
      body: t.Object({
        status: t.Union([t.Literal("accepted"), t.Literal("declined")]),
      }),
    },
  );

export const coachSessionsRoutes = new Elysia()
  .use(coachSessionsHandler)
  .use(athleteCoachSessionsHandler);
