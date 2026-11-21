import Elysia, { t } from "elysia";
import {
  getAuthUser,
  requireAuth,
  getUser,
} from "@persistence/api-utils/auth/supabaseAuth";
import { resolveCoachScope } from "../relationships/resolveCoachScope";
import { auditClientDataRead } from "../relationships/auditClientDataRead";
import { TrainingReadRepository } from "./trainingReadRepository";
import {
  historyDayModel,
  historyMonthModel,
  lastDays,
  MAX_VOLUME_DAYS,
  muscleVolumeModel,
  parseDate,
  parseDays,
  parseMonth,
  recapModel,
  recapWindows,
  RECAP_PERIODS,
  trainingReviewModel,
  type RecapPeriod,
  type ReviewWindow,
} from "./trainingReadModels";

/**
 * Backend design H (PER-113): read-only, bounded training reads. New paths
 * only, so 1.2.0 phones and the coach web app are untouched. The phone
 * works the You page out from its own log first (offline) and calls these
 * for what its log doesn't reach: older months, the 3-month Recap, a new
 * phone. Every self route reads the signed-in user only; the coach route
 * reads a client only after `resolveCoachScope` allows it.
 */

const authed = () =>
  new Elysia()
    .derive(async ({ headers }) => ({
      user: await getAuthUser(headers.authorization),
    }))
    .onBeforeHandle(requireAuth);

const bad = (code: string, message: string) => ({ code, message });

const repo = () => new TrainingReadRepository();

/** `GET /users/me/muscle-volume?days=7` (1–92 days, today included). */
export const muscleVolumeHandler = authed().get(
  "/users/me/muscle-volume",
  async (ctx) => {
    const days = parseDays(ctx.query.days);
    if (days == null) {
      ctx.set.status = 400;
      return bad(
        "invalid_window",
        `days must be a whole number from 1 to ${MAX_VOLUME_DAYS}`,
      );
    }
    const userId = getUser(ctx).sub;
    const r = repo();
    const now = new Date();
    const profile = await r.profileBasics(userId);
    const window = lastDays(now, profile.timezone, days);
    const [sessions, records] = await Promise.all([
      r.sessions(userId, profile.timezone, window.from, window.to),
      r.records(userId, profile.timezone, window.from, window.to),
    ]);
    return {
      data: muscleVolumeModel({
        window,
        days,
        timezone: profile.timezone,
        bodyType: profile.bodyType,
        sessions,
        records,
        asOf: now.toISOString(),
      }),
    };
  },
  { query: t.Object({ days: t.Optional(t.String()) }) },
);

/** `GET /users/me/history?month=YYYY-MM` or `?date=YYYY-MM-DD` (one of). */
export const historyHandler = authed().get(
  "/users/me/history",
  async (ctx) => {
    const { month, date } = ctx.query;
    if ((month == null) === (date == null)) {
      ctx.set.status = 400;
      return bad("invalid_window", "Send exactly one of month or date");
    }
    const userId = getUser(ctx).sub;
    const r = repo();
    const asOf = new Date().toISOString();
    const profile = await r.profileBasics(userId);
    const tz = profile.timezone;

    if (month != null) {
      const window = parseMonth(month);
      if (!window) {
        ctx.set.status = 400;
        return bad("invalid_window", "month must be YYYY-MM");
      }
      const [sessions, logs] = await Promise.all([
        r.sessions(userId, tz, window.from, window.to),
        r.dayLogs(userId, tz, window.from, window.to),
      ]);
      return {
        data: historyMonthModel({
          month,
          window,
          timezone: tz,
          sessions,
          logs,
          asOf,
        }),
      };
    }

    const day = parseDate(date!);
    if (!day) {
      ctx.set.status = 400;
      return bad("invalid_window", "date must be a real YYYY-MM-DD day");
    }
    const [sessions, records, logs, target] = await Promise.all([
      r.sessions(userId, tz, day, day),
      r.records(userId, tz, day, day),
      r.dayLogs(userId, tz, day, day),
      r.targetForDay(userId),
    ]);
    return {
      data: historyDayModel({
        date: day,
        timezone: tz,
        sessions,
        records,
        log: logs.get(day),
        target,
        asOf,
      }),
    };
  },
  {
    query: t.Object({
      month: t.Optional(t.String()),
      date: t.Optional(t.String()),
    }),
  },
);

/** `GET /users/me/recap?period=week|month|3months`. */
export const recapHandler = authed().get(
  "/users/me/recap",
  async (ctx) => {
    const period = (ctx.query.period ?? "week") as RecapPeriod;
    if (!RECAP_PERIODS.includes(period)) {
      ctx.set.status = 400;
      return bad("invalid_window", "period must be week, month or 3months");
    }
    const userId = getUser(ctx).sub;
    const r = repo();
    const now = new Date();
    const profile = await r.profileBasics(userId);
    const tz = profile.timezone;
    const windows = recapWindows(period, now, tz);
    // One read covers the period and the one before it (for "N more than
    // last week"); records only for the period itself.
    const [sessions, records] = await Promise.all([
      r.sessions(userId, tz, windows.previous.from, windows.current.to),
      r.records(userId, tz, windows.current.from, windows.current.to),
    ]);
    const together = await r.together(
      userId,
      sessions.map((s) => s.id),
    );
    return {
      data: recapModel({
        period,
        windows,
        timezone: tz,
        sessions,
        records,
        together,
        asOf: now.toISOString(),
      }),
    };
  },
  { query: t.Object({ period: t.Optional(t.String()) }) },
);

const REVIEW_DAYS: Record<ReviewWindow, number> = { "7d": 7, "28d": 28 };

/**
 * `GET /trainers/me/clients/:clientId/training-review?window=7d|28d`
 * (C3 / C3.1: Worked, Strength over 4 weeks, PRs hit). Coach scope first:
 * role, an active relationship, neither account deleted. A coach reads only
 * the athlete's own logged training — never another coach's rows.
 */
export const trainingReviewHandler = authed().get(
  "/trainers/me/clients/:clientId/training-review",
  async (ctx) => {
    const window = (ctx.query.window ?? "7d") as ReviewWindow;
    // Own keys only: `in` would let `?window=toString` through.
    if (!Object.hasOwn(REVIEW_DAYS, window)) {
      ctx.set.status = 400;
      return bad("invalid_window", "window must be 7d or 28d");
    }
    const trainerId = getUser(ctx).sub;
    const scope = await resolveCoachScope(trainerId, ctx.params.clientId);
    if (!scope.allowed) {
      ctx.set.status = scope.status;
      return scope.body;
    }
    const clientId = scope.scope.clientId;
    await auditClientDataRead({
      trainerId,
      clientId,
      dataCategory: "training_review",
      route: "/trainers/me/clients/:clientId/training-review",
    }).catch(() => {});

    const r = repo();
    const now = new Date();
    const profile = await r.profileBasics(clientId);
    const tz = profile.timezone;
    const windows = {
      review: lastDays(now, tz, REVIEW_DAYS[window]),
      strength: lastDays(now, tz, 28),
      week: lastDays(now, tz, 7),
    };
    const [sessions, records] = await Promise.all([
      r.sessions(clientId, tz, windows.strength.from, windows.strength.to),
      r.records(clientId, tz, windows.strength.from, windows.strength.to),
    ]);
    return {
      data: trainingReviewModel({
        window,
        windows,
        timezone: tz,
        bodyType: profile.bodyType,
        sessions,
        records,
        asOf: now.toISOString(),
      }),
    };
  },
  {
    params: t.Object({ clientId: t.String({ format: "uuid" }) }),
    query: t.Object({ window: t.Optional(t.String()) }),
  },
);
