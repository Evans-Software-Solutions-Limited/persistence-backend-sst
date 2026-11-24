import Elysia, { t } from "elysia";
import {
  getAuthUser,
  getUser,
  requireAuth,
} from "@persistence/api-utils/auth/supabaseAuth";
import { readIdempotencyKey } from "../shared/idempotencyKey";
import { resolveCoachScope } from "../relationships/resolveCoachScope";
import { auditClientDataRead } from "../relationships/auditClientDataRead";
import { isActiveTrainer } from "../coaching/clientProfileRepository";
import { listAsOf } from "../coaching/forms/formRepository";
import { COACH_VIEW_SECONDS, OWNER_VIEW_SECONDS } from "./privateMediaStore";
import {
  completeSet,
  createSet,
  deleteSet,
  listSets,
  validatePoses,
  validTakenOn,
} from "./progressPhotoRepository";
import {
  coachHasPhotoConsent,
  grantPhotoSharing,
  photoSharingStatus,
} from "./photoSharing";
import {
  coachFormAnswerView,
  createUpload,
  ownerView,
  validateUploadRequest,
  type ViewResult,
} from "./privateMediaRepository";

/**
 * PER-121 (BE-F1, backend design F): progress photos and the private media
 * service.
 *
 * Athlete routes (`/users/me/…`) only ever touch the caller's own rows.
 * The coach gallery checks, in order: `resolveCoachScope` (trainer role, an
 * ACTIVE relationship, neither account deleted), the client's `photos`
 * switch for this coach (C3.9), and the client's photo-sharing consent for
 * this coaching cycle. Every request is checked; after coaching ends the next
 * request is refused, and links already handed out expire within 5 minutes.
 *
 * Photos never reach AI: nothing here calls a model, and no AI input reads
 * these tables (Brad, 20 Nov 2026).
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

function parseSince(raw: string | undefined): Date | undefined | null {
  if (raw === undefined || raw === "") return undefined;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

const BAD_SINCE = { code: "invalid_since", message: "since must be a date" };

function viewBody(set: { status?: number | string }, result: ViewResult) {
  if (result.ok) return { data: result.media };
  set.status = result.status;
  return result.code === "media_not_found"
    ? { code: result.code, message: "That photo wasn't found" }
    : {
        code: result.code,
        reason: result.reason,
        message: "That upload isn't finished",
      };
}

// ─── Athlete: progress photos ────────────────────────────────────────────────

export const progressPhotosHandler = authed()
  .get(
    "/users/me/progress-photos",
    async (ctx) => {
      const since = parseSince(ctx.query.since);
      if (since === null) {
        ctx.set.status = 400;
        return BAD_SINCE;
      }
      const userId = getUser(ctx).sub;
      const asOf = listAsOf();
      const { sets, deletedIds } = await listSets(
        userId,
        since,
        OWNER_VIEW_SECONDS,
      );
      return {
        data: {
          sets,
          ...(since ? { deletedIds } : {}),
          photoSharing: await photoSharingStatus(userId),
          asOf,
        },
      };
    },
    { query: t.Object({ since: t.Optional(t.String({ maxLength: 40 })) }) },
  )
  .post(
    "/users/me/progress-photos",
    async (ctx) => {
      const { takenOn, poses } = ctx.body;
      const errors = [
        ...(validTakenOn(takenOn)
          ? []
          : [
              {
                at: "takenOn",
                message: "must be a date (YYYY-MM-DD), not in the future",
              },
            ]),
        ...validatePoses(poses),
      ];
      if (errors.length > 0) {
        ctx.set.status = 422;
        return {
          code: "invalid_photo_set",
          message: "Add a front, side and back photo",
          errors,
        };
      }
      const result = await createSet(
        getUser(ctx).sub,
        { takenOn, poses },
        readIdempotencyKey(ctx.headers),
        OWNER_VIEW_SECONDS,
      );
      if (!result.ok) {
        ctx.set.status = result.status;
        return { code: result.code, message: "That photo set was deleted" };
      }
      ctx.set.status = result.replay ? 200 : 201;
      return { data: { set: result.set, uploads: result.uploads } };
    },
    {
      body: t.Object({
        takenOn: t.String({ maxLength: 10 }),
        poses: t.Array(
          t.Object({
            pose: t.Union([
              t.Literal("front"),
              t.Literal("side"),
              t.Literal("back"),
            ]),
            bytes: t.Integer(),
            width: t.Optional(
              t.Union([t.Integer({ minimum: 1, maximum: 10000 }), t.Null()]),
            ),
            height: t.Optional(
              t.Union([t.Integer({ minimum: 1, maximum: 10000 }), t.Null()]),
            ),
          }),
          { maxItems: 3 },
        ),
      }),
    },
  )
  .post(
    "/users/me/progress-photos/:setId/complete",
    async (ctx) => {
      const result = await completeSet(
        getUser(ctx).sub,
        ctx.params.setId,
        OWNER_VIEW_SECONDS,
      );
      if (result.ok) return { data: result.set };
      ctx.set.status = result.status;
      return result.code === "set_not_found"
        ? { code: result.code, message: "Photo set not found" }
        : {
            code: result.code,
            message: "Some photos haven't finished uploading",
            poses: result.poses,
          };
    },
    { params: t.Object({ setId: uuid }) },
  )
  .delete(
    "/users/me/progress-photos/:setId",
    async (ctx) => {
      await deleteSet(getUser(ctx).sub, ctx.params.setId);
      ctx.set.status = 204;
      return new Response(null, { status: 204 });
    },
    { params: t.Object({ setId: uuid }) },
  )
  .get("/users/me/progress-photos/sharing", async (ctx) => ({
    data: await photoSharingStatus(getUser(ctx).sub),
  }))
  .post("/users/me/progress-photos/sharing", async (ctx) => ({
    data: await grantPhotoSharing(getUser(ctx).sub),
  }));

// ─── Coach: the client's gallery (C3.4) ──────────────────────────────────────

export const coachProgressPhotosHandler = trainerOnly().get(
  "/trainers/me/clients/:clientId/progress-photos",
  async (ctx) => {
    const since = parseSince(ctx.query.since);
    if (since === null) {
      ctx.set.status = 400;
      return BAD_SINCE;
    }
    const trainerId = getUser(ctx).sub;
    const { clientId } = ctx.params;
    const scope = await resolveCoachScope(trainerId, clientId);
    if (!scope.allowed) {
      ctx.set.status = scope.status;
      return scope.body;
    }
    if (!scope.scope.settings.features.photos) {
      ctx.set.status = 403;
      return {
        code: "photos_off",
        message: "Photos are switched off for this client",
      };
    }
    if (!(await coachHasPhotoConsent(trainerId, clientId))) {
      ctx.set.status = 403;
      return {
        code: "photo_sharing_not_granted",
        message: "This client hasn't shared their progress photos with you",
      };
    }
    await auditClientDataRead({
      trainerId,
      clientId,
      dataCategory: "progress_photos",
      route: "/trainers/me/clients/:clientId/progress-photos",
    });
    const asOf = listAsOf();
    const { sets, deletedIds } = await listSets(
      clientId,
      since,
      COACH_VIEW_SECONDS,
    );
    return { data: { sets, ...(since ? { deletedIds } : {}), asOf } };
  },
  {
    params: t.Object({ clientId: uuid }),
    query: t.Object({ since: t.Optional(t.String({ maxLength: 40 })) }),
  },
);

// ─── Private media uploads ───────────────────────────────────────────────────

const uploadBody = <P extends string>(purpose: P) =>
  t.Object({
    purpose: t.Literal(purpose),
    contentType: t.String({ maxLength: 100 }),
    bytes: t.Integer(),
  });

export const athleteMediaHandler = authed()
  .post(
    "/users/me/media/uploads",
    async (ctx) => {
      const { contentType, bytes } = ctx.body;
      const errors = validateUploadRequest("form_answer", contentType, bytes);
      if (errors.length > 0) {
        ctx.set.status = 422;
        return {
          code: "invalid_upload",
          message: "That file can't be uploaded",
          errors,
        };
      }
      const result = await createUpload(
        getUser(ctx).sub,
        "form_answer",
        contentType,
        bytes,
        readIdempotencyKey(ctx.headers),
      );
      ctx.set.status = result.replay ? 200 : 201;
      return { data: result.media };
    },
    { body: uploadBody("form_answer") },
  )
  .get(
    "/users/me/media/:mediaId",
    async (ctx) =>
      viewBody(
        ctx.set,
        await ownerView(
          getUser(ctx).sub,
          ctx.params.mediaId,
          OWNER_VIEW_SECONDS,
        ),
      ),
    { params: t.Object({ mediaId: uuid }) },
  );

export const coachMediaHandler = trainerOnly()
  .post(
    "/trainers/me/media/uploads",
    async (ctx) => {
      const { contentType, bytes } = ctx.body;
      const errors = validateUploadRequest("resource", contentType, bytes);
      if (errors.length > 0) {
        ctx.set.status = 422;
        return {
          code: "invalid_upload",
          message: "That file can't be uploaded",
          errors,
        };
      }
      const result = await createUpload(
        getUser(ctx).sub,
        "resource",
        contentType,
        bytes,
        readIdempotencyKey(ctx.headers),
      );
      ctx.set.status = result.replay ? 200 : 201;
      return { data: result.media };
    },
    { body: uploadBody("resource") },
  )
  .get(
    "/trainers/me/clients/:clientId/media/:mediaId",
    async (ctx) => {
      const trainerId = getUser(ctx).sub;
      const { clientId, mediaId } = ctx.params;
      const scope = await resolveCoachScope(trainerId, clientId);
      if (!scope.allowed) {
        ctx.set.status = scope.status;
        return scope.body;
      }
      const result = await coachFormAnswerView(
        {
          kind: "active",
          trainerId,
          clientId,
          relationshipId: scope.scope.relationshipId,
          activatedAt: scope.scope.activatedAt
            ? new Date(scope.scope.activatedAt)
            : null,
        },
        mediaId,
        COACH_VIEW_SECONDS,
      );
      if (result.ok) {
        await auditClientDataRead({
          trainerId,
          clientId,
          dataCategory: "form_photo",
          route: "/trainers/me/clients/:clientId/media/:mediaId",
        });
      }
      return viewBody(ctx.set, result);
    },
    { params: t.Object({ clientId: uuid, mediaId: uuid }) },
  );

/** One sub-app, so the parent adds a single `.use()` (TS2589). */
export const privateMediaRoutes = new Elysia()
  .use(progressPhotosHandler)
  .use(coachProgressPhotosHandler)
  .use(athleteMediaHandler)
  .use(coachMediaHandler);
