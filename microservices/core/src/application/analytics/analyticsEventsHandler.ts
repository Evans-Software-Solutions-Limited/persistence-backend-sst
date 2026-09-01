import Elysia, { t } from "elysia";
import {
  getAuthUser,
  getUser,
  requireAuth,
} from "@persistence/api-utils/auth/supabaseAuth";
import { emitEvent } from "./emitEvent";
import { CLIENT_ANALYTICS_EVENT_NAMES } from "./events";

type ClientAnalyticsEventName = (typeof CLIENT_ANALYTICS_EVENT_NAMES)[number];

const SAFE_PROPERTY_VALUES = {
  page: new Set([
    "welcome",
    "profile",
    "role",
    "habits",
    "nutrition",
    "train",
    "recommendation",
  ]),
  intentKey: new Set([
    "nutrition_barcode",
    "nutrition_photo_estimate",
    "nutrition_mealprint",
    "training_three_workouts",
    "training_unlimited_workouts",
    "training_loadout",
  ]),
  selectedTier: new Set([
    "free",
    "premium",
    "premium_plus",
    "individual_trainer",
    "start_up_coach_plus",
    "coach",
    "coach_pro",
  ]),
  metric: new Set(["weight", "bodyFat"]),
} as const;

type SafePropertyKey = keyof typeof SAFE_PROPERTY_VALUES;

const EVENT_PROPERTY_KEYS: Partial<
  Record<ClientAnalyticsEventName, ReadonlySet<SafePropertyKey>>
> = {
  onboarding_page_viewed: new Set(["page"]),
  onboarding_page_completed: new Set(["page"]),
  onboarding_page_skipped: new Set(["page"]),
  onboarding_intent_changed: new Set(["intentKey"]),
  onboarding_plan_selected: new Set(["selectedTier"]),
  measurement_logged_from_history: new Set(["metric"]),
};

export function safeClientAnalyticsProperties(
  eventName: ClientAnalyticsEventName,
  input: Record<string, string | boolean> | undefined,
): Record<string, string | boolean> {
  if (!input) return {};
  const allowedKeys = EVENT_PROPERTY_KEYS[eventName];
  if (!allowedKeys) return {};
  return Object.fromEntries(
    Object.entries(input).filter(([key, value]) => {
      if (!allowedKeys.has(key as SafePropertyKey) || typeof value !== "string")
        return false;
      return SAFE_PROPERTY_VALUES[key as SafePropertyKey].has(value as never);
    }),
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
        properties: safeClientAnalyticsProperties(
          ctx.body.name,
          ctx.body.properties,
        ),
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
