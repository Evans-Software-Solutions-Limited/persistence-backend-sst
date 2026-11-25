import Elysia, { t } from "elysia";
import {
  getAuthUser,
  getUser,
  requireAuth,
} from "@persistence/api-utils/auth/supabaseAuth";
import { readIdempotencyKey } from "../../shared/idempotencyKey";
import { resolveCoachScope } from "../../relationships/resolveCoachScope";
import { isActiveTrainer } from "../clientProfileRepository";
import { listAsOf } from "../forms/formRepository";
import { OWNER_VIEW_SECONDS } from "../../media/privateMediaStore";
import {
  MAX_ASSIGN_CLIENTS,
  MAX_ASSIGN_RESOURCES,
  TITLE_MAX,
  URL_MAX,
  archiveResource,
  bulkAssign,
  checkResourceFile,
  cleanTitle,
  cleanUrl,
  createResource,
  findReplay,
  listAthleteResources,
  listClientResources,
  listLibrary,
  markOpened,
  ownLiveResources,
  patchResource,
  removeAssignment,
  validateCreate,
  type AssignTarget,
  type FieldError,
  type FileCheck,
} from "./resourceRepository";

/**
 * PER-122 (BE-I1, backend design I resources part): the coach resources
 * library (C5b), assigning (C3.7 and bulk from Library → Resources), the
 * client's opened / not opened list, and the athlete's resources.
 *
 * Coach routes run the trainer-role check first; client routes then run
 * `resolveCoachScope` (an ACTIVE relationship, neither account deleted) and
 * only touch the caller's own rows on that relationship. Athlete routes only
 * touch the caller's own assignments.
 *
 * ⚠ PER-146 (coach platform access) adds a coach-subscription guard to coach
 * workspace routes. `coachResourcesHandler` is one self-contained group so
 * that guard can be applied to it in one line; the athlete routes stay
 * unguarded (clients need no subscription, PER-12).
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
const sinceQuery = t.Object({ since: t.Optional(t.String({ maxLength: 40 })) });

function parseSince(raw: string | undefined): Date | undefined | null {
  if (raw === undefined || raw === "") return undefined;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

const BAD_SINCE = { code: "invalid_since", message: "since must be a date" };
const RESOURCE_NOT_FOUND = {
  code: "resource_not_found",
  message: "That resource wasn't found",
};

function invalid(errors: FieldError[]) {
  return {
    code: "invalid_resource",
    message: "That resource can't be saved",
    errors,
  };
}

/** A failed file check as a 422 the form can map onto `mediaId`. */
function fileProblem(check: Extract<FileCheck, { ok: false }>) {
  return check.code === "media_not_found"
    ? invalid([{ at: "mediaId", message: "must be your uploaded file" }])
    : {
        code: "upload_incomplete",
        reason: check.reason,
        message: "That upload isn't finished",
        errors: [{ at: "mediaId", message: "must be a finished upload" }],
      };
}

// ─── Coach: library, assign, the client's Resources tab ─────────────────────

export const coachResourcesHandler = trainerOnly()
  .get(
    "/trainers/me/resources",
    async (ctx) => {
      const since = parseSince(ctx.query.since);
      if (since === null) {
        ctx.set.status = 400;
        return BAD_SINCE;
      }
      const asOf = listAsOf();
      const { resources, deletedIds } = await listLibrary(
        getUser(ctx).sub,
        since ?? null,
      );
      return { data: { resources, ...(since ? { deletedIds } : {}), asOf } };
    },
    { query: sinceQuery },
  )
  .post(
    "/trainers/me/resources",
    async (ctx) => {
      const trainerId = getUser(ctx).sub;
      const key = readIdempotencyKey(ctx.headers);
      const replay = await findReplay(trainerId, key);
      if (replay) {
        ctx.set.status = 200;
        return { data: replay };
      }
      const checked = validateCreate(ctx.body);
      if (!checked.ok) {
        ctx.set.status = 422;
        return invalid(checked.errors);
      }
      let file: { mediaId: string; mime: string; bytes: number } | null = null;
      if (checked.value.mediaId) {
        const check = await checkResourceFile(trainerId, checked.value.mediaId);
        if (!check.ok) {
          ctx.set.status = 422;
          return fileProblem(check);
        }
        file = check;
      }
      const result = await createResource(
        trainerId,
        {
          kind: checked.value.kind,
          title: checked.value.title,
          url: checked.value.url,
          file,
        },
        key,
      );
      ctx.set.status = result.replay ? 200 : 201;
      return { data: result.resource };
    },
    {
      body: t.Object({
        kind: t.Union([t.Literal("file"), t.Literal("link")]),
        title: t.String({ maxLength: TITLE_MAX * 2 }),
        url: t.Optional(t.Nullable(t.String({ maxLength: URL_MAX * 2 }))),
        mediaId: t.Optional(t.Nullable(uuid)),
      }),
    },
  )
  .patch(
    "/trainers/me/resources/:resourceId",
    async (ctx) => {
      const trainerId = getUser(ctx).sub;
      const { title, url, mediaId, expectedRevision } = ctx.body;
      const errors: FieldError[] = [];
      const cleanedTitle = title === undefined ? undefined : cleanTitle(title);
      if (cleanedTitle === null) {
        errors.push({
          at: "title",
          message: `must be 1–${TITLE_MAX} characters`,
        });
      }
      const cleanedUrl = url === undefined ? undefined : cleanUrl(url);
      if (cleanedUrl === null) {
        errors.push({ at: "url", message: "must be an https link" });
      }
      if (errors.length > 0) {
        ctx.set.status = 422;
        return invalid(errors);
      }
      let file: { mediaId: string; mime: string; bytes: number } | undefined;
      if (mediaId !== undefined) {
        const check = await checkResourceFile(trainerId, mediaId);
        if (!check.ok) {
          ctx.set.status = 422;
          return fileProblem(check);
        }
        file = check;
      }
      const result = await patchResource(
        trainerId,
        ctx.params.resourceId,
        {
          ...(cleanedTitle ? { title: cleanedTitle } : {}),
          ...(cleanedUrl ? { url: cleanedUrl } : {}),
          ...(file ? { file } : {}),
        },
        expectedRevision,
      );
      if (result.ok) return { data: result.resource };
      switch (result.reason) {
        case "not_found":
          ctx.set.status = 404;
          return RESOURCE_NOT_FOUND;
        case "revision_conflict":
          ctx.set.status = 409;
          return {
            code: "revision_conflict",
            message: "This resource was updated elsewhere",
            current: result.current,
          };
        case "invalid":
          ctx.set.status = 422;
          return invalid(result.errors);
      }
    },
    {
      params: t.Object({ resourceId: uuid }),
      body: t.Object({
        title: t.Optional(t.String({ maxLength: TITLE_MAX * 2 })),
        url: t.Optional(t.String({ maxLength: URL_MAX * 2 })),
        mediaId: t.Optional(uuid),
        expectedRevision: t.Optional(t.Integer({ minimum: 1 })),
      }),
    },
  )
  .delete(
    "/trainers/me/resources/:resourceId",
    async (ctx) => {
      await archiveResource(getUser(ctx).sub, ctx.params.resourceId);
      ctx.set.status = 204;
      return new Response(null, { status: 204 });
    },
    { params: t.Object({ resourceId: uuid }) },
  )
  .post(
    "/trainers/me/resources/assign",
    async (ctx) => {
      const trainerId = getUser(ctx).sub;
      const resourceIds = [
        ...new Set(ctx.body.resourceIds.map((id) => id.toLowerCase())),
      ];
      const clientIds = [
        ...new Set(ctx.body.clientIds.map((id) => id.toLowerCase())),
      ];
      const resources = await ownLiveResources(trainerId, resourceIds);
      const found = new Set(resources.map((r) => r.id));
      const missing = resourceIds.filter((id) => !found.has(id));
      if (missing.length > 0) {
        ctx.set.status = 404;
        return { ...RESOURCE_NOT_FOUND, resourceIds: missing };
      }
      const targets: AssignTarget[] = [];
      const refused: string[] = [];
      for (const clientId of clientIds) {
        const scope = await resolveCoachScope(trainerId, clientId);
        if (scope.allowed) {
          targets.push({
            clientId,
            relationshipId: scope.scope.relationshipId,
          });
        } else {
          refused.push(clientId);
        }
      }
      if (refused.length > 0) {
        // Nothing is assigned unless every client is the caller's own.
        ctx.set.status = 403;
        return {
          code: "not_your_client",
          message: "You can only act for your active clients",
          clientIds: refused,
        };
      }
      const result = await bulkAssign(
        trainerId,
        resources,
        targets,
        readIdempotencyKey(ctx.headers),
      );
      ctx.set.status = result.created > 0 ? 201 : 200;
      return { data: result };
    },
    {
      body: t.Object({
        resourceIds: t.Array(uuid, {
          minItems: 1,
          maxItems: MAX_ASSIGN_RESOURCES,
        }),
        clientIds: t.Array(uuid, { minItems: 1, maxItems: MAX_ASSIGN_CLIENTS }),
      }),
    },
  )
  .get(
    "/trainers/me/clients/:clientId/resources",
    async (ctx) => {
      const scope = await resolveCoachScope(
        getUser(ctx).sub,
        ctx.params.clientId,
      );
      if (!scope.allowed) {
        ctx.set.status = scope.status;
        return scope.body;
      }
      const asOf = listAsOf();
      return {
        data: { resources: await listClientResources(scope.scope), asOf },
      };
    },
    { params: t.Object({ clientId: uuid }) },
  )
  .delete(
    "/trainers/me/clients/:clientId/resources/:assignmentId",
    async (ctx) => {
      const scope = await resolveCoachScope(
        getUser(ctx).sub,
        ctx.params.clientId,
      );
      if (!scope.allowed) {
        ctx.set.status = scope.status;
        return scope.body;
      }
      await removeAssignment(scope.scope, ctx.params.assignmentId);
      ctx.set.status = 204;
      return new Response(null, { status: 204 });
    },
    { params: t.Object({ clientId: uuid, assignmentId: uuid }) },
  );

// ─── Athlete: resources in the Coach tab ────────────────────────────────────

export const athleteResourcesHandler = authed()
  .get(
    "/users/me/resources",
    async (ctx) => {
      const since = parseSince(ctx.query.since);
      if (since === null) {
        ctx.set.status = 400;
        return BAD_SINCE;
      }
      const asOf = listAsOf();
      const { resources, deletedIds } = await listAthleteResources(
        getUser(ctx).sub,
        since ?? null,
        OWNER_VIEW_SECONDS,
      );
      return { data: { resources, ...(since ? { deletedIds } : {}), asOf } };
    },
    { query: sinceQuery },
  )
  .post(
    "/users/me/resources/:assignmentId/opened",
    async (ctx) => {
      const result = await markOpened(
        getUser(ctx).sub,
        ctx.params.assignmentId,
      );
      if (!result) {
        ctx.set.status = 404;
        return {
          code: "assignment_not_found",
          message: "That resource wasn't found",
        };
      }
      return { data: result };
    },
    { params: t.Object({ assignmentId: uuid }) },
  );

/** One sub-app, so the parent adds a single `.use()` (TS2589). */
export const coachResourcesRoutes = new Elysia()
  .use(coachResourcesHandler)
  .use(athleteResourcesHandler);
