import Elysia, { t } from "elysia";
import { ProfileService } from "../../repositories/profileService";
import {
  getAuthUser,
  requireAuth,
  getUser,
} from "@persistence/api-utils/auth/supabaseAuth";

export const profilesUpdateHandler = new Elysia()
  .derive(async ({ headers }) => ({
    user: await getAuthUser(headers.authorization),
  }))
  .onBeforeHandle(requireAuth)
  .use(ProfileService)
  .patch(
    "/profile",
    async (ctx) => {
      const { sub: userId } = getUser(ctx);
      const body = ctx.body as Record<string, unknown>;

      // Only allow updating specific fields
      const allowedFields = [
        "fullName",
        "username",
        "avatarUrl",
        "fitnessLevel",
        "dateOfBirth",
        "heightCm",
        "weightKg",
        "availableEquipment",
        "accessibilityNeeds",
        "preferredUnits",
        "isProfilePublic",
      ];

      const updateData: Record<string, unknown> = {};
      for (const field of allowedFields) {
        if (field in body) {
          updateData[field] = body[field];
        }
      }

      if (Object.keys(updateData).length === 0) {
        ctx.set.status = 400;
        return { error: "No valid fields to update" };
      }

      const profile = await ctx.ProfileRepository.update(userId, updateData);

      if (!profile) {
        ctx.set.status = 404;
        return { error: "Profile not found" };
      }

      return { data: profile };
    },
    {
      body: t.Object({
        fullName: t.Optional(t.String()),
        username: t.Optional(t.String()),
        avatarUrl: t.Optional(t.String()),
        fitnessLevel: t.Optional(t.String()),
        dateOfBirth: t.Optional(t.String()),
        heightCm: t.Optional(t.Union([t.String(), t.Number()])),
        weightKg: t.Optional(t.Union([t.String(), t.Number()])),
        availableEquipment: t.Optional(t.Array(t.String())),
        accessibilityNeeds: t.Optional(t.Array(t.String())),
        preferredUnits: t.Optional(t.String()),
        isProfilePublic: t.Optional(t.Boolean()),
      }),
    },
  );
