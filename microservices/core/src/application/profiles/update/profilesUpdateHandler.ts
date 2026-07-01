import Elysia, { t } from "elysia";
import { ProfileService } from "../../repositories/profileService";
import {
  getAuthUser,
  requireAuth,
  getUser,
} from "@persistence/api-utils/auth/supabaseAuth";

/**
 * Validate a `YYYY-MM-DD` calendar date (shape + real month/day, incl.
 * leap-year rejection). The `profiles.date_of_birth` column is a Postgres
 * `DATE`; an invalid string would crash the UPDATE with a 500, so the
 * handler gates DOB here and returns a structured 400 instead.
 */
function isValidIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

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
      if (body.dateOfBirth !== undefined) {
        // `null` clears the column (the Edit Profile screen's "unset my
        // DOB" path — PR #94 high-severity find). A non-null value must be
        // a real YYYY-MM-DD calendar date: the column is a Postgres `DATE`,
        // so an unparseable string would throw `invalid input syntax for
        // type date` deep in the UPDATE and surface as an uncaught 500.
        // Reject it here with a structured 400 instead (PR #94 medium find).
        if (body.dateOfBirth !== null && !isValidIsoDate(body.dateOfBirth)) {
          ctx.set.status = 400;
          return { error: "dateOfBirth must be a valid YYYY-MM-DD date" };
        }
        updateData.dateOfBirth = body.dateOfBirth;
      }
      // `gender` feeds the Fuel Targets TDEE calculator. `null` clears it
      // ("prefer not to say" in the editor persists as 'other', not null; null
      // means never-set). The t.Union below constrains values to the three the
      // DB CHECK allows, so no extra validation is needed here.
      if (body.gender !== undefined) updateData.gender = body.gender;
      if (body.heightCm !== undefined)
        updateData.heightCm = String(body.heightCm);
      if (body.weightKg !== undefined)
        updateData.weightKg = String(body.weightKg);
      if (body.availableEquipment !== undefined)
        updateData.availableEquipment = body.availableEquipment;
      if (body.accessibilityNeeds !== undefined)
        updateData.accessibilityNeeds = body.accessibilityNeeds;
      // Independent per-field display-unit preferences (users routinely mix
      // e.g. kg + ft/in) — the t.Union below constrains values to what each
      // CHECK constraint allows, so no extra validation is needed here.
      if (body.weightUnit !== undefined)
        updateData.weightUnit = body.weightUnit;
      if (body.heightUnit !== undefined)
        updateData.heightUnit = body.heightUnit;
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
        // `fullName` accepts `null` so the Edit Profile screen can clear
        // a previously-set display name (DB column is nullable). The other
        // legacy string fields below stay `Optional(String)` for now — they
        // have no clearable-from-UI surface in v2 yet; widen them at the
        // point a screen needs to send null, alongside a test for that path.
        fullName: t.Optional(t.Union([t.String(), t.Null()])),
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
        dateOfBirth: t.Optional(t.Union([t.String(), t.Null()])),
        gender: t.Optional(
          t.Union([
            t.Literal("male"),
            t.Literal("female"),
            t.Literal("other"),
            t.Null(),
          ]),
        ),
        heightCm: t.Optional(t.Union([t.String(), t.Number()])),
        weightKg: t.Optional(t.Union([t.String(), t.Number()])),
        availableEquipment: t.Optional(t.Array(t.String())),
        accessibilityNeeds: t.Optional(t.Array(t.String())),
        weightUnit: t.Optional(t.Union([t.Literal("kg"), t.Literal("lb")])),
        heightUnit: t.Optional(t.Union([t.Literal("cm"), t.Literal("ftin")])),
        isProfilePublic: t.Optional(t.Boolean()),
      }),
    },
  );
