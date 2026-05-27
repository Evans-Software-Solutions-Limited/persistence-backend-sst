import Elysia from "elysia";
import { ProfileService } from "../../../repositories/profileService";
import { reconcileNotificationPreferences } from "../../../repositories/profileRepository";
import {
  NOTIFICATION_TYPES,
  type NotificationType,
} from "../../../repositories/notificationRepository";
import {
  getAuthUser,
  requireAuth,
  getUser,
} from "@persistence/api-utils/auth/supabaseAuth";

const VALID_KEYS: ReadonlySet<string> = new Set(NOTIFICATION_TYPES);

/**
 * POST /notifications/preferences — merge the caller's partial map
 * into the persisted preferences. Inspector Brad PR #81: a full-
 * replace implementation silently nukes prior keys when a follow-up
 * partial body arrives, because the read path defaults missing keys
 * to `true`. The repository now uses an atomic JSONB `||` merge so
 * partial bodies preserve previously-stored keys, and full bodies
 * still work (every key overwrites).
 *
 * Validation is hand-rolled rather than via Elysia's `t.Object` because
 * the keys are a dynamic union — `t.Object({ workout_assigned: t.Boolean(), ... })`
 * would force us to enumerate every NotificationType here AND keep it
 * in lockstep with the union; the explicit loop reads exactly the
 * stale-key + non-boolean failure modes the spec asks for.
 *
 * Inspector Brad PR #81 sweep 2: the response now echoes the actual
 * merged JSONB column returned from the UPDATE, then reconciled
 * against defaults. Previously the handler built the response from
 * the request body alone, which silently flipped prior-`false` keys
 * back to `true` when a partial body landed on top of stored state.
 * Mobile clients treating the POST response as authoritative (a
 * reasonable REST assumption) now see the correct post-merge map
 * without a follow-up GET.
 *
 * Implements: specs/09-notifications-social/design.md
 *             § Backend endpoints > POST /notifications/preferences
 * Satisfies: specs/09-notifications-social/requirements.md AC 1.7, 1.8
 */
export const preferencesSetHandler = new Elysia()
  .derive(async ({ headers }) => ({
    user: await getAuthUser(headers.authorization),
  }))
  .onBeforeHandle(requireAuth)
  .use(ProfileService)
  .post("/notifications/preferences", async (ctx) => {
    const { sub: userId } = getUser(ctx);

    const body = ctx.body;

    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      ctx.set.status = 400;
      return { error: "Body must be an object" };
    }

    const validated = {} as Record<NotificationType, boolean>;
    for (const [key, value] of Object.entries(body)) {
      if (!VALID_KEYS.has(key)) {
        ctx.set.status = 400;
        return { error: `Unknown notification type: ${key}` };
      }
      if (typeof value !== "boolean") {
        ctx.set.status = 400;
        return {
          error: `Value for ${key} must be a boolean, got ${typeof value}`,
        };
      }
      validated[key as NotificationType] = value;
    }

    // Merge the validated subset into the stored map (atomic JSONB ||
    // at the SQL layer). Prior keys not present in the body are
    // preserved; keys present in the body overwrite. Race-safe across
    // concurrent POSTs because the merge happens in a single UPDATE.
    // The repo returns the merged JSONB column so we can echo an
    // authoritative response without a follow-up SELECT.
    const merged = await ctx.ProfileRepository.mergeNotificationPreferences(
      userId,
      validated,
    );

    if (merged === null) {
      ctx.set.status = 404;
      return { error: "Profile not found" };
    }

    // Echo the actual post-merge state, reconciled against defaults —
    // mobile clients can treat the response as authoritative without
    // a follow-up GET. Unknown keys (legacy values not in the current
    // NotificationType enum) are dropped by reconcile.
    return {
      data: reconcileNotificationPreferences(merged),
    };
  });
