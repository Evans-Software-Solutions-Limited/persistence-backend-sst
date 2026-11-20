import Elysia, { t } from "elysia";
import {
  getAuthUser,
  getUser,
  requireAuth,
} from "@persistence/api-utils/auth/supabaseAuth";
import { readIdempotencyKey } from "../shared/idempotencyKey";
import { inviteGuessLimited, RATE_LIMITED_BODY } from "./inviteGuessLimit";
import { resolveCoachScope } from "../relationships/resolveCoachScope";
import { CoachClientSettingsRepository } from "./clientSettings";
import { isActiveTrainer } from "./clientProfileRepository";
import { acceptDeclaration, getDeclarationStatus } from "./declaration";
import { previewInviteCode } from "./invitePreview";
import { listMyCoaches } from "./myCoaching";

/**
 * PER-108 (design A D3/D6b): per-client settings, the coach declaration, the
 * athlete's invite preview and their list of coaches.
 */

const authed = () =>
  new Elysia()
    .derive(async ({ headers }) => ({
      user: await getAuthUser(headers.authorization),
    }))
    .onBeforeHandle(requireAuth);

const notATrainer = {
  code: "not_a_trainer",
  message: "Coach actions require a trainer role",
};

/** `GET/PATCH /trainers/me/clients/:clientId/settings` (C3.9). */
export const clientSettingsHandler = authed()
  .get(
    "/trainers/me/clients/:clientId/settings",
    async (ctx) => {
      const scope = await resolveCoachScope(
        getUser(ctx).sub,
        ctx.params.clientId,
      );
      if (!scope.allowed) {
        ctx.set.status = scope.status;
        return scope.body;
      }
      return { data: scope.scope.settings };
    },
    { params: t.Object({ clientId: t.String({ format: "uuid" }) }) },
  )
  .patch(
    "/trainers/me/clients/:clientId/settings",
    async (ctx) => {
      const scope = await resolveCoachScope(
        getUser(ctx).sub,
        ctx.params.clientId,
      );
      if (!scope.allowed) {
        ctx.set.status = scope.status;
        return scope.body;
      }
      const { expectedRevision, ...patch } = ctx.body;
      const result = await new CoachClientSettingsRepository().patch(
        {
          relationshipId: scope.scope.relationshipId,
          trainerId: scope.scope.trainerId,
          clientId: scope.scope.clientId,
        },
        patch,
        expectedRevision,
      );
      if (!result.ok) {
        ctx.set.status = 409;
        return {
          code: "revision_conflict",
          message: "These settings were updated on another device",
          current: result.current,
        };
      }
      return { data: result.settings };
    },
    {
      params: t.Object({ clientId: t.String({ format: "uuid" }) }),
      body: t.Object({
        trackTraining: t.Optional(t.Boolean()),
        trackCalories: t.Optional(t.Boolean()),
        sessionsPerWeek: t.Optional(
          t.Union([t.Integer({ minimum: 1, maximum: 14 }), t.Null()]),
        ),
        features: t.Optional(t.Record(t.String(), t.Unknown())),
        alertMode: t.Optional(
          t.Union([
            t.Literal("default"),
            t.Literal("mute"),
            t.Literal("everything"),
          ]),
        ),
        expectedRevision: t.Optional(t.Integer({ minimum: 1 })),
      }),
    },
  );

/** `GET/POST /trainers/me/declaration` (D6b). */
export const declarationHandler = authed()
  .onBeforeHandle(async (ctx) => {
    if (!(await isActiveTrainer(getUser(ctx).sub))) {
      ctx.set.status = 403;
      return notATrainer;
    }
  })
  .get("/trainers/me/declaration", async (ctx) => ({
    data: await getDeclarationStatus(getUser(ctx).sub),
  }))
  .post(
    "/trainers/me/declaration",
    async (ctx) => {
      const result = await acceptDeclaration(
        getUser(ctx).sub,
        ctx.body,
        readIdempotencyKey(ctx.headers),
      );
      if (!result.ok) {
        ctx.set.status = 409;
        return {
          code: result.code,
          message: "The declaration has changed. Read the new version.",
          currentVersion: result.currentVersion,
        };
      }
      return { data: result.status };
    },
    {
      body: t.Object({
        statementVersion: t.String({ minLength: 1, maxLength: 64 }),
        statementTextHash: t.Optional(
          t.String({ pattern: "^[0-9a-fA-F]{64}$" }),
        ),
      }),
    },
  );

/**
 * Codes are 6 characters, so the preview is rate-limited. It shares its budget
 * with the accept route (`inviteGuessLimit.ts`): both tell a valid code from
 * an invalid one.
 */
/** `GET /invites/:code/preview`. */
export const invitePreviewHandler = authed().get(
  "/invites/:code/preview",
  async (ctx) => {
    const { sub } = getUser(ctx);
    if (inviteGuessLimited(sub, ctx.headers["x-forwarded-for"])) {
      ctx.set.status = 429;
      return RATE_LIMITED_BODY;
    }
    const preview = await previewInviteCode(ctx.params.code);
    if (!preview) {
      ctx.set.status = 404;
      return {
        code: "invalid_code",
        message:
          "Invalid or expired invite code. Ask your trainer for a new one.",
      };
    }
    return { data: preview };
  },
  { params: t.Object({ code: t.String({ minLength: 1, maxLength: 10 }) }) },
);

/** `GET /users/me/coaching`. */
export const myCoachingHandler = authed().get(
  "/users/me/coaching",
  async (ctx) => ({ data: await listMyCoaches(getUser(ctx).sub) }),
);
