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
      const body = ctx.body;

      const updateData: Record<string, unknown> = {};
      if (body.fullName !== undefined) updateData.fullName = body.fullName;
      if (body.username !== undefined) updateData.username = body.username;
      if (body.avatarUrl !== undefined) updateData.avatarUrl = body.avatarUrl;
      if (body.fitnessLevel !== undefined)
        updateData.fitnessLevel = body.fitnessLevel;
      if (body.dateOfBirth !== undefined)
        updateData.dateOfBirth = body.dateOfBirth;
      if (body.heightCm !== undefined)
        updateData.heightCm = String(body.heightCm);
      if (body.weightKg !== undefined)
        updateData.weightKg = String(body.weightKg);
      if (body.availableEquipment !== undefined)
        updateData.availableEquipment = body.availableEquipment;
      if (body.accessibilityNeeds !== undefined)
        updateData.accessibilityNeeds = body.accessibilityNeeds;
      if (body.preferredUnits !== undefined)
        updateData.preferredUnits = body.preferredUnits;
      if (body.isProfilePublic !== undefined)
        updateData.isProfilePublic = body.isProfilePublic;

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
        fitnessLevel: t.Optional(
          t.Union([
            t.Literal("beginner"),
            t.Literal("intermediate"),
            t.Literal("advanced"),
            t.Literal("elite"),
          ]),
        ),
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
