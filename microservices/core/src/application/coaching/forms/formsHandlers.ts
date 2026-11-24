import Elysia, { t } from "elysia";
import {
  getAuthUser,
  getUser,
  requireAuth,
} from "@persistence/api-utils/auth/supabaseAuth";
import { readIdempotencyKey } from "../../shared/idempotencyKey";
import { resolveCoachScope } from "../../relationships/resolveCoachScope";
import { isActiveTrainer } from "../clientProfileRepository";
import {
  CoachFormRepository,
  cleanDescription,
  cleanTitle,
  listAsOf,
  DESCRIPTION_MAX,
} from "./formRepository";
import { validateQuestions } from "./questions";
import { formStats } from "./statsRepository";
import {
  AUDIENCES,
  CoachFormScheduleRepository,
  TRIGGERS,
  type ScheduleError,
} from "./scheduleRepository";
import {
  REPLY_MAX,
  endedCoachView,
  listAthleteRequests,
  listClientForms,
  listCoachResponses,
  reviewResponse,
  setClientFormSetup,
  submitResponse,
  type AthleteStatus,
  type CoachView,
} from "./requestsRepository";

/**
 * PER-116 (BE-C1, design C D3): coach forms library, send rules, per-client
 * setup, the Check-ins tab, response history and review; the athlete's due
 * forms and submitting a response.
 *
 * Library and rule routes need an active trainer and only ever touch rows
 * with `trainer_id = caller`. Client routes go through `resolveCoachScope`
 * and filter by the caller's relationship, so coach B never sees coach A's
 * forms or responses for a shared athlete.
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

const reminders = t.Array(t.Object({ afterHours: t.Integer() }), {
  maxItems: 10,
});

const ruleFields = {
  weekday: t.Optional(t.Union([t.Integer(), t.Null()])),
  timeLocal: t.Optional(t.Union([t.String({ maxLength: 8 }), t.Null()])),
  dueAfterHours: t.Optional(t.Union([t.Integer(), t.Null()])),
  reminders: t.Optional(reminders),
};

const literals = <T extends readonly string[]>(values: T) =>
  t.Union(values.map((v) => t.Literal(v)) as never);

function scheduleError(
  set: { status?: number | string },
  error: ScheduleError,
) {
  set.status = error.status;
  switch (error.code) {
    case "form_not_found":
      return { code: error.code, message: "That form isn't in your library" };
    case "schedule_not_found":
      return { code: error.code, message: "That send rule wasn't found" };
    case "schedule_stopped":
      return {
        code: error.code,
        message: "This send rule is stopped. Create a new one instead",
      };
    case "revision_conflict":
      return {
        code: error.code,
        message: "This send rule was updated on another device",
        current: error.current,
      };
    case "not_your_client":
      return {
        code: error.code,
        message: "You can only send forms to your active clients",
        clientIds: error.clientIds,
      };
    case "invalid_schedule":
      return { code: error.code, message: error.message };
  }
}

function parseSince(raw: string | undefined): Date | undefined | null {
  if (raw === undefined || raw === "") return undefined;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

const BAD_SINCE = { code: "invalid_since", message: "since must be a date" };

// ─── Library ─────────────────────────────────────────────────────────────────

export const coachFormsLibraryHandler = trainerOnly()
  // PER-129 (C10a/C10g): each form's current round across active clients.
  .get("/trainers/me/forms/stats", async (ctx) => {
    const asOf = listAsOf();
    return { data: { ...(await formStats(getUser(ctx).sub)), asOf } };
  })
  .get(
    "/trainers/me/forms",
    async (ctx) => {
      const since = parseSince(ctx.query.since);
      if (since === null) {
        ctx.set.status = 400;
        return BAD_SINCE;
      }
      const repo = new CoachFormRepository();
      const asOf = listAsOf();
      const { forms, deletedIds } = await repo.list(getUser(ctx).sub, since);
      const withTemplates = (ctx.query.include ?? "")
        .split(",")
        .includes("templates");
      return {
        data: {
          forms,
          ...(since ? { deletedIds } : {}),
          ...(withTemplates ? { templates: await repo.templates() } : {}),
          asOf,
        },
      };
    },
    {
      query: t.Object({
        include: t.Optional(t.String({ maxLength: 100 })),
        since: t.Optional(t.String({ maxLength: 40 })),
      }),
    },
  )
  .post(
    "/trainers/me/forms",
    async (ctx) => {
      const trainerId = getUser(ctx).sub;
      const repo = new CoachFormRepository();
      const key = readIdempotencyKey(ctx.headers);
      if (key) {
        const replay = await repo.findByClientRequest(trainerId, key);
        if (replay) {
          ctx.set.status = 201;
          return { data: replay };
        }
      }
      let title = ctx.body.title;
      let description = ctx.body.description;
      let rawQuestions: unknown = ctx.body.questions;
      if (ctx.body.fromTemplateKey !== undefined) {
        const template = await repo.findTemplate(ctx.body.fromTemplateKey);
        if (!template?.version) {
          ctx.set.status = 404;
          return {
            code: "template_not_found",
            message: "That template isn't available",
          };
        }
        title ??= template.form.title;
        description ??= template.form.description;
        rawQuestions ??= template.version.questions;
      }
      const cleanedTitle = cleanTitle(title ?? "");
      if (!cleanedTitle) {
        ctx.set.status = 422;
        return {
          code: "invalid_form",
          message: "title must be 1–120 characters",
        };
      }
      const questions = validateQuestions(rawQuestions);
      if (!questions.ok) {
        ctx.set.status = 422;
        return {
          code: "invalid_questions",
          message: "Some questions aren't valid",
          errors: questions.errors,
        };
      }
      const created = await repo.create(trainerId, {
        title: cleanedTitle,
        description: cleanDescription(description) ?? null,
        questions: questions.value,
        clientRequestId: key,
      });
      ctx.set.status = 201;
      return { data: created.form };
    },
    {
      body: t.Object({
        title: t.Optional(t.String({ maxLength: 400 })),
        description: t.Optional(
          t.Union([t.String({ maxLength: DESCRIPTION_MAX }), t.Null()]),
        ),
        questions: t.Optional(t.Array(t.Unknown(), { maxItems: 100 })),
        fromTemplateKey: t.Optional(t.String({ minLength: 1, maxLength: 64 })),
      }),
    },
  )
  .get(
    "/trainers/me/forms/:id",
    async (ctx) => {
      const form = await new CoachFormRepository().get(
        getUser(ctx).sub,
        ctx.params.id,
        ctx.query.version,
      );
      if (!form) {
        ctx.set.status = 404;
        return { code: "form_not_found", message: "Form not found" };
      }
      return { data: form };
    },
    {
      params: t.Object({ id: uuid }),
      query: t.Object({
        version: t.Optional(t.Numeric({ minimum: 1, maximum: 100000 })),
      }),
    },
  )
  .patch(
    "/trainers/me/forms/:id",
    async (ctx) => {
      const { expectedRevision, title, description, questions } = ctx.body;
      const patch: Parameters<CoachFormRepository["patch"]>[2] = {};
      if (title !== undefined) {
        const cleaned = cleanTitle(title);
        if (!cleaned) {
          ctx.set.status = 422;
          return {
            code: "invalid_form",
            message: "title must be 1–120 characters",
          };
        }
        patch.title = cleaned;
      }
      if (description !== undefined) {
        patch.description = cleanDescription(description);
      }
      if (questions !== undefined) {
        const checked = validateQuestions(questions);
        if (!checked.ok) {
          ctx.set.status = 422;
          return {
            code: "invalid_questions",
            message: "Some questions aren't valid",
            errors: checked.errors,
          };
        }
        patch.questions = checked.value;
      }
      const result = await new CoachFormRepository().patch(
        getUser(ctx).sub,
        ctx.params.id,
        patch,
        expectedRevision,
      );
      if (!result.ok && result.reason === "not_found") {
        ctx.set.status = 404;
        return { code: "form_not_found", message: "Form not found" };
      }
      if (!result.ok) {
        ctx.set.status = 409;
        return {
          code: "revision_conflict",
          message: "This form was edited on another device",
          current: result.current,
        };
      }
      return { data: result.form };
    },
    {
      params: t.Object({ id: uuid }),
      body: t.Object({
        title: t.Optional(t.String({ maxLength: 400 })),
        description: t.Optional(
          t.Union([t.String({ maxLength: DESCRIPTION_MAX }), t.Null()]),
        ),
        questions: t.Optional(t.Array(t.Unknown(), { maxItems: 100 })),
        expectedRevision: t.Optional(t.Integer({ minimum: 1 })),
      }),
    },
  )
  .delete(
    "/trainers/me/forms/:id",
    async (ctx) => {
      // Idempotent: archived already, or not there at all → 204.
      await new CoachFormRepository().archive(getUser(ctx).sub, ctx.params.id);
      ctx.set.status = 204;
      return new Response(null, { status: 204 });
    },
    { params: t.Object({ id: uuid }) },
  );

// ─── Send rules ──────────────────────────────────────────────────────────────

export const coachFormSchedulesHandler = trainerOnly()
  .get("/trainers/me/form-schedules", async (ctx) => {
    const asOf = listAsOf();
    return {
      data: {
        schedules: await new CoachFormScheduleRepository().list(
          getUser(ctx).sub,
        ),
        asOf,
      },
    };
  })
  .post(
    "/trainers/me/form-schedules",
    async (ctx) => {
      const result = await new CoachFormScheduleRepository().create(
        getUser(ctx).sub,
        {
          ...ctx.body,
          clientRequestId: readIdempotencyKey(ctx.headers),
        },
      );
      if (!("ok" in result)) return scheduleError(ctx.set, result);
      ctx.set.status = 201;
      return { data: result.schedule };
    },
    {
      body: t.Object({
        formId: uuid,
        trigger: literals(TRIGGERS),
        audience: literals(AUDIENCES),
        clientIds: t.Optional(t.Array(uuid, { maxItems: 1000 })),
        status: t.Optional(t.Union([t.Literal("active"), t.Literal("paused")])),
        ...ruleFields,
      }),
    },
  )
  .patch(
    "/trainers/me/form-schedules/:id",
    async (ctx) => {
      const result = await new CoachFormScheduleRepository().patch(
        getUser(ctx).sub,
        ctx.params.id,
        ctx.body,
      );
      if (!("ok" in result)) return scheduleError(ctx.set, result);
      return { data: result.schedule };
    },
    {
      params: t.Object({ id: uuid }),
      body: t.Object({
        audience: t.Optional(literals(AUDIENCES)),
        clientIds: t.Optional(t.Array(uuid, { maxItems: 1000 })),
        status: t.Optional(
          t.Union([
            t.Literal("active"),
            t.Literal("paused"),
            t.Literal("stopped"),
          ]),
        ),
        expectedRevision: t.Optional(t.Integer({ minimum: 1 })),
        ...ruleFields,
      }),
    },
  )
  .delete(
    "/trainers/me/form-schedules/:id",
    async (ctx) => {
      await new CoachFormScheduleRepository().stop(
        getUser(ctx).sub,
        ctx.params.id,
      );
      ctx.set.status = 204;
      return new Response(null, { status: 204 });
    },
    { params: t.Object({ id: uuid }) },
  );

// ─── One client (C3.3, C10j) ─────────────────────────────────────────────────

type Scoped =
  | { ok: true; view: CoachView }
  | { ok: false; status: number; body: { code: string; message: string } };

/**
 * The caller's view of one client. An ended relationship still reads its
 * exit forms (`allowEnded`); everything else needs an active one.
 */
async function coachView(
  trainerId: string,
  clientId: string,
  allowEnded: boolean,
): Promise<Scoped> {
  const scope = await resolveCoachScope(trainerId, clientId);
  if (scope.allowed) {
    return {
      ok: true,
      view: {
        kind: "active",
        trainerId,
        clientId,
        relationshipId: scope.scope.relationshipId,
        activatedAt: scope.scope.activatedAt
          ? new Date(scope.scope.activatedAt)
          : null,
      },
    };
  }
  if (allowEnded && scope.reason === "no_relationship") {
    const ended = await endedCoachView(trainerId, clientId);
    if (ended) return { ok: true, view: ended };
  }
  return { ok: false, status: scope.status, body: scope.body };
}

/** An active relationship only (set-up and the Check-ins tab). */
async function activeView(
  trainerId: string,
  clientId: string,
): Promise<
  | { ok: true; view: Extract<CoachView, { kind: "active" }> }
  | Extract<Scoped, { ok: false }>
> {
  const scoped = await coachView(trainerId, clientId, false);
  if (!scoped.ok) return scoped;
  return {
    ok: true,
    view: scoped.view as Extract<CoachView, { kind: "active" }>,
  };
}

export const coachClientFormsHandler = authed()
  .get(
    "/trainers/me/clients/:clientId/forms",
    async (ctx) => {
      const scoped = await activeView(getUser(ctx).sub, ctx.params.clientId);
      if (!scoped.ok) {
        ctx.set.status = scoped.status;
        return scoped.body;
      }
      return {
        data: await listClientForms(scoped.view),
        asOf: listAsOf(),
      };
    },
    { params: t.Object({ clientId: uuid }) },
  )
  .put(
    "/trainers/me/clients/:clientId/forms/:formId/setup",
    async (ctx) => {
      const scoped = await activeView(getUser(ctx).sub, ctx.params.clientId);
      if (!scoped.ok) {
        ctx.set.status = scoped.status;
        return scoped.body;
      }
      const result = await setClientFormSetup(
        scoped.view,
        ctx.params.formId,
        ctx.body,
      );
      if (!("ok" in result)) {
        ctx.set.status = result.status;
        return {
          code: result.code,
          message:
            "message" in result
              ? result.message
              : result.code === "form_not_found"
                ? "That form isn't in your library"
                : "That form has no live send rule",
        };
      }
      return { data: result.form };
    },
    {
      params: t.Object({ clientId: uuid, formId: uuid }),
      body: t.Object({
        status: t.Union([
          t.Literal("active"),
          t.Literal("paused"),
          t.Literal("excluded"),
        ]),
        override: t.Optional(
          t.Union([
            t.Object(
              {
                ...ruleFields,
                // PER-129 (C10j): this client gets it on another cadence.
                trigger: t.Optional(
                  t.Union([
                    t.Literal("once"),
                    t.Literal("weekly"),
                    t.Literal("daily"),
                    t.Null(),
                  ]),
                ),
              },
              { additionalProperties: false },
            ),
            t.Null(),
          ]),
        ),
        scheduleId: t.Optional(uuid),
      }),
    },
  )
  .get(
    "/trainers/me/clients/:clientId/form-responses",
    async (ctx) => {
      const scoped = await coachView(
        getUser(ctx).sub,
        ctx.params.clientId,
        true,
      );
      if (!scoped.ok) {
        ctx.set.status = scoped.status;
        return scoped.body;
      }
      const page = await listCoachResponses(scoped.view, {
        formId: ctx.query.formId,
        cursor: ctx.query.cursor,
        limit: ctx.query.limit,
      });
      return { data: page.responses, nextCursor: page.nextCursor };
    },
    {
      params: t.Object({ clientId: uuid }),
      query: t.Object({
        formId: t.Optional(uuid),
        cursor: t.Optional(t.String({ maxLength: 100 })),
        limit: t.Optional(t.Numeric({ minimum: 1, maximum: 50 })),
      }),
    },
  )
  .post(
    "/trainers/me/clients/:clientId/form-responses/:id/review",
    async (ctx) => {
      const scoped = await coachView(
        getUser(ctx).sub,
        ctx.params.clientId,
        true,
      );
      if (!scoped.ok) {
        ctx.set.status = scoped.status;
        return scoped.body;
      }
      const response = await reviewResponse(
        scoped.view,
        ctx.params.id,
        ctx.body?.replyText,
      );
      if (!response) {
        ctx.set.status = 404;
        return { code: "response_not_found", message: "Response not found" };
      }
      return { data: response };
    },
    {
      params: t.Object({ clientId: uuid, id: uuid }),
      body: t.Optional(
        t.Object({ replyText: t.Optional(t.String({ maxLength: REPLY_MAX })) }),
      ),
    },
  );

// ─── Athlete ─────────────────────────────────────────────────────────────────

const ATHLETE_STATUSES: readonly AthleteStatus[] = ["pending", "missed"];

export const athleteFormRequestsHandler = authed()
  .get(
    "/users/me/form-requests",
    async (ctx) => {
      const since = parseSince(ctx.query.since);
      if (since === null) {
        ctx.set.status = 400;
        return BAD_SINCE;
      }
      const wanted = (ctx.query.status ?? "pending,missed")
        .split(",")
        .map((s) => s.trim())
        .filter((s): s is AthleteStatus =>
          (ATHLETE_STATUSES as readonly string[]).includes(s),
        );
      if (wanted.length === 0) {
        ctx.set.status = 400;
        return {
          code: "invalid_status",
          message: "status must be pending and/or missed",
        };
      }
      const result = await listAthleteRequests(getUser(ctx).sub, wanted, since);
      return {
        data: {
          requests: result.requests,
          ...(since ? { deletedIds: result.deletedIds } : {}),
          asOf: result.asOf,
        },
      };
    },
    {
      query: t.Object({
        status: t.Optional(t.String({ maxLength: 40 })),
        since: t.Optional(t.String({ maxLength: 40 })),
      }),
    },
  )
  .post(
    "/users/me/form-requests/:id/response",
    async (ctx) => {
      const result = await submitResponse(
        getUser(ctx).sub,
        ctx.params.id,
        ctx.body.answers,
        readIdempotencyKey(ctx.headers),
      );
      if ("ok" in result) {
        ctx.set.status = 201;
        return { data: result.response };
      }
      ctx.set.status = result.status;
      switch (result.code) {
        case "request_not_found":
          return { code: result.code, message: "Form request not found" };
        case "request_closed":
          return {
            code: result.code,
            reason: result.reason,
            message: "This check-in is no longer needed",
          };
        case "invalid_answers":
          return {
            code: result.code,
            message: "Some answers aren't valid",
            errors: result.errors,
          };
      }
    },
    {
      params: t.Object({ id: uuid }),
      body: t.Object({ answers: t.Unknown() }),
    },
  );

/** One sub-app, so the parent adds a single `.use()` (TS2589). */
export const coachFormsRoutes = new Elysia()
  .use(coachFormsLibraryHandler)
  .use(coachFormSchedulesHandler)
  .use(coachClientFormsHandler)
  .use(athleteFormRequestsHandler);
