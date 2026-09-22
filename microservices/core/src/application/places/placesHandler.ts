import Elysia, { t } from "elysia";
import {
  getAuthUser,
  getUser,
  requireAuth,
} from "@persistence/api-utils/auth/supabaseAuth";
import { placesRepository } from "./placesRepository";
import { socialPageQuery } from "../social/socialHandler";
import {
  TogetherError,
  withActors,
  enforceRateLimit,
} from "../together/shared";
export const placesHandler = new Elysia()
  .derive(async ({ headers }) => ({
    user: await getAuthUser(headers.authorization),
  }))
  .onBeforeHandle(requireAuth)
  .onError(({ error, code, set }) => {
    if (code === "VALIDATION") {
      set.status = 400;
      return { error: { code: "INVALID_SCHEMA", message: "Invalid request" } };
    }
    if (error instanceof TogetherError) {
      set.status = error.status;
      if (error.status === 429) set.headers["Retry-After"] = "60";
      return { error: { code: error.code, message: error.message } };
    }
  })
  .get(
    "/places/search",
    async (c) => {
      const actor = getUser(c).sub;
      await withActors([actor], (tx) => enforceRateLimit(tx, actor, "search"));
      return placesRepository.find(actor, c.query);
    },
    {
      query: t.Object({
        ...socialPageQuery.properties,
        q: t.String({ minLength: 2, maxLength: 100 }),
      }),
    },
  )
  .get(
    "/places/nearby",
    async (c) => {
      const actor = getUser(c).sub;
      await withActors([actor], (tx) => enforceRateLimit(tx, actor, "search"));
      return placesRepository.find(actor, c.query);
    },
    {
      query: t.Object({
        ...socialPageQuery.properties,
        latitude: t.Numeric({ minimum: -90, maximum: 90 }),
        longitude: t.Numeric({ minimum: -180, maximum: 180 }),
      }),
    },
  );
