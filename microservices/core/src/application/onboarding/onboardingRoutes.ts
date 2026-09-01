import Elysia, { t } from "elysia";
import {
  getAuthUser,
  getUser,
  requireAuth,
} from "@persistence/api-utils/auth/supabaseAuth";
import { OnboardingStateService } from "../repositories/onboardingStateService";
import {
  ONBOARDING_INTENT_KEYS,
  ONBOARDING_PAGES,
} from "../repositories/onboardingStateRepository";

const page = t.Union(ONBOARDING_PAGES.map((value) => t.Literal(value)));
const intentKey = t.Union(
  ONBOARDING_INTENT_KEYS.map((value) => t.Literal(value)),
);

export const onboardingRoutes = new Elysia()
  .derive(async ({ headers }) => ({
    user: await getAuthUser(headers.authorization),
  }))
  .onBeforeHandle(requireAuth)
  .use(OnboardingStateService)
  .get("/users/me/onboarding", async (ctx) => {
    const { sub: userId } = getUser(ctx);
    return { data: await ctx.OnboardingStateRepository.get(userId) };
  })
  .put(
    "/users/me/onboarding",
    async (ctx) => {
      const { sub: userId } = getUser(ctx);
      return {
        data: await ctx.OnboardingStateRepository.put(userId, {
          ...ctx.body,
          completedPages: [...ctx.body.completedPages],
          skippedPages: [...ctx.body.skippedPages],
          intentKeys: [...ctx.body.intentKeys],
        }),
      };
    },
    {
      body: t.Object({
        version: t.Literal(1),
        currentPage: page,
        completedPages: t.Array(page, { maxItems: ONBOARDING_PAGES.length }),
        skippedPages: t.Array(page, { maxItems: ONBOARDING_PAGES.length }),
        status: t.Union([
          t.Literal("in_progress"),
          t.Literal("completed"),
          t.Literal("dismissed"),
        ]),
        path: t.Union([t.Literal("athlete"), t.Literal("coach"), t.Null()]),
        coachClientBand: t.Union([
          t.Literal("1_5"),
          t.Literal("6_15"),
          t.Literal("16_30"),
          t.Null(),
        ]),
        intentKeys: t.Array(intentKey, {
          maxItems: ONBOARDING_INTENT_KEYS.length,
        }),
      }),
    },
  );
