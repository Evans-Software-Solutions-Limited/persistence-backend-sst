import Elysia, { t } from "elysia";
import {
  getAuthUser,
  getUser,
  requireAuth,
} from "@persistence/api-utils/auth/supabaseAuth";
import { emitEvent } from "./emitEvent";
import { CLIENT_ANALYTICS_EVENT_NAMES } from "./events";

const SAFE_PROPERTY_KEYS = new Set([
  "page",
  "intentKey",
  "path",
  "coachClientBand",
  "recommendedTier",
  "selectedTier",
  "metric",
  "relationshipStatus",
  "isRecommended",
]);

export function safeClientAnalyticsProperties(
  input: Record<string, string | boolean> | undefined,
): Record<string, string | boolean> {
  if (!input) return {};
  return Object.fromEntries(
    Object.entries(input).filter(([key]) => SAFE_PROPERTY_KEYS.has(key)),
  );
}

/** Authenticated mobile analytics intake. Instrumentation is always best effort. */
export const analyticsEventsHandler = new Elysia()
  .derive(async ({ headers }) => ({
    user: await getAuthUser(headers.authorization),
  }))
  .onBeforeHandle(requireAuth)
  .post(
    "/analytics/events",
    async (ctx) => {
      const { sub: userId } = getUser(ctx);
      await emitEvent({
        name: ctx.body.name,
        userId,
        source: "app",
        eventId: ctx.body.eventId,
        properties: safeClientAnalyticsProperties(ctx.body.properties),
      });
      ctx.set.status = 202;
      return { data: { accepted: true } };
    },
    {
      body: t.Object({
        name: t.Union(
          CLIENT_ANALYTICS_EVENT_NAMES.map((name) => t.Literal(name)),
        ),
        eventId: t.Optional(t.String({ minLength: 1, maxLength: 200 })),
        properties: t.Optional(
          t.Record(
            t.String({ maxLength: 50 }),
            t.Union([t.String({ maxLength: 100 }), t.Boolean()]),
          ),
        ),
      }),
    },
  );
