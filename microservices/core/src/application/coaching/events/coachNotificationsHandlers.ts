import Elysia, { t } from "elysia";
import {
  getAuthUser,
  getUser,
  requireAuth,
} from "@persistence/api-utils/auth/supabaseAuth";
import { resolveCoachScope } from "../../relationships/resolveCoachScope";
import { isActiveTrainer } from "../clientProfileRepository";
import { listAsOf } from "../forms/formRepository";
import { overviewAdherenceByArea } from "../../adherence/coachAdherence";
import {
  FEED_DEFAULT_LIMIT,
  FEED_MAX_LIMIT,
  decodeCursor,
  getSettings,
  listFeed,
  markActioned,
  markRead,
  putSettings,
  todayQueue,
} from "./feedRepository";
import { isCoachEventKind, type CoachEventKind } from "./kinds";
import { todaySchedule } from "../sessions/sessionRepository";

/**
 * PER-117 (BE-C2, design C D4): the coach's notifications feed, read marks,
 * Today, actioned marks and notification settings (C6).
 *
 * Every route needs an active trainer and only touches rows with
 * `trainer_id = caller`. Filtering the feed by client goes through
 * `resolveCoachScope`, so a coach can only ask about their own active
 * clients. `/notifications/preferences` (the athlete's pushes) is unchanged.
 */

const trainerOnly = () =>
  new Elysia()
    .derive(async ({ headers }) => ({
      user: await getAuthUser(headers.authorization),
    }))
    .onBeforeHandle(requireAuth)
    .onBeforeHandle(async (ctx) => {
      if (!(await isActiveTrainer(getUser(ctx).sub))) {
        ctx.set.status = 403;
        return {
          code: "not_a_trainer",
          message: "Coach actions require a trainer role",
        };
      }
    });

const uuid = t.String({ format: "uuid" });

function badRequest(set: { status?: number | string }, message: string) {
  set.status = 400;
  return { code: "invalid_query", message };
}

export const coachNotificationsRoutes = trainerOnly()
  .get(
    "/trainers/me/notifications",
    async (ctx) => {
      const trainerId = getUser(ctx).sub;
      const q = ctx.query;
      let kinds: CoachEventKind[] | undefined;
      if (q.kind) {
        const list = q.kind.split(",").map((k) => k.trim());
        const bad = list.find((k) => !isCoachEventKind(k));
        if (bad) return badRequest(ctx.set, `unknown kind: ${bad}`);
        kinds = list as CoachEventKind[];
      }
      if (q.clientId) {
        const scope = await resolveCoachScope(trainerId, q.clientId);
        if (!scope.allowed) {
          ctx.set.status = scope.status;
          return scope.body;
        }
      }
      let since: Date | undefined;
      if (q.since) {
        since = new Date(q.since);
        if (Number.isNaN(since.getTime())) {
          return badRequest(ctx.set, "since must be an ISO date");
        }
      }
      const cursor = q.cursor ? decodeCursor(q.cursor) : undefined;
      if (cursor === null) return badRequest(ctx.set, "bad cursor");
      const limit = Math.min(q.limit ?? FEED_DEFAULT_LIMIT, FEED_MAX_LIMIT);
      const asOf = listAsOf();
      const page = await listFeed(trainerId, {
        kinds,
        clientId: q.clientId,
        since,
        cursor,
        limit,
      });
      return { ...page, asOf };
    },
    {
      query: t.Object({
        kind: t.Optional(t.String({ maxLength: 400 })),
        clientId: t.Optional(uuid),
        since: t.Optional(t.String({ maxLength: 40 })),
        cursor: t.Optional(t.String({ maxLength: 200 })),
        limit: t.Optional(t.Numeric({ minimum: 1, maximum: FEED_MAX_LIMIT })),
      }),
    },
  )
  .post(
    "/trainers/me/notifications/read",
    async (ctx) => {
      const { ids, all } = ctx.body;
      if (all !== true && (!ids || ids.length === 0)) {
        ctx.set.status = 400;
        return { code: "invalid_body", message: "Send ids or all: true" };
      }
      const updated = await markRead(
        getUser(ctx).sub,
        all === true ? "all" : ids!,
      );
      return { data: { updated } };
    },
    {
      body: t.Object({
        ids: t.Optional(t.Array(uuid, { maxItems: 500 })),
        all: t.Optional(t.Boolean()),
      }),
    },
  )
  .get("/trainers/me/today", async (ctx) => {
    const trainerId = getUser(ctx).sub;
    const asOf = listAsOf();
    const [today, strip, schedule] = await Promise.all([
      todayQueue(trainerId),
      overviewAdherenceByArea(trainerId),
      todaySchedule(trainerId),
    ]);
    return {
      data: {
        queue: today.queue,
        counts: today.counts,
        // Design I (PER-123): today's bookings in the coach's time zone, not
        // cancelled, by start time (the calendar's session shape).
        schedule,
        strip,
      },
      asOf,
    };
  })
  .post(
    "/trainers/me/today/:eventId/actioned",
    async (ctx) => {
      const marked = await markActioned(getUser(ctx).sub, ctx.params.eventId);
      if (!marked) {
        ctx.set.status = 404;
        return { code: "event_not_found", message: "No such notification" };
      }
      return { data: marked };
    },
    { params: t.Object({ eventId: uuid }) },
  )
  .get("/trainers/me/notification-settings", async (ctx) => ({
    data: await getSettings(getUser(ctx).sub),
  }))
  .put(
    "/trainers/me/notification-settings",
    async (ctx) => {
      const result = await putSettings(getUser(ctx).sub, ctx.body);
      if (!result.ok) {
        ctx.set.status = result.status;
        return result.code === "revision_conflict"
          ? { code: result.code, current: result.current }
          : { code: result.code, message: result.message };
      }
      return { data: result.settings };
    },
    {
      body: t.Object({
        channels: t.Optional(
          t.Record(t.String({ maxLength: 40 }), t.String({ maxLength: 10 })),
        ),
        quietHours: t.Optional(
          t.Object({
            enabled: t.Boolean(),
            from: t.Optional(t.Union([t.String({ maxLength: 8 }), t.Null()])),
            until: t.Optional(t.Union([t.String({ maxLength: 8 }), t.Null()])),
          }),
        ),
        expectedRevision: t.Optional(t.Integer({ minimum: 0 })),
      }),
    },
  );
