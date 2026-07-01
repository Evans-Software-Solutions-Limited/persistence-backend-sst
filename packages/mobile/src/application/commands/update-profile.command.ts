/**
 * Update-profile command — offline-capable.
 *
 * Spec: specs/08-profile-settings/design.md § Revised 2026-05-31 § I
 *       (offline-first profile write — closes requirements STORY-009 AC 9.2)
 *       specs/08-profile-settings/requirements.md STORY-010
 *
 * Before this command, `EditProfileContainer` called `api.updateProfile`
 * directly — a bare `PATCH /profile` that failed hard when offline (no
 * queue, no optimistic write). That contradicted the V2 offline-first
 * invariant + the spec's AC 9.2 ("edit-profile saves queue + optimistic").
 *
 * This command mirrors `updateWorkoutCommand`:
 *   1. validate the patch (DOB format — keeps a bad date out of the queue,
 *      since the sync worker POSTs queued payloads with no feedback loop)
 *   2. optimistically merge the patch into the cached `/profile/page`
 *      payload so the drawer + edit form reflect the change immediately
 *   3. enqueue a PATCH /profile mutation for the sync worker to drain
 *
 * The cached profile-page payload is the read source for both the drawer
 * (`useProfilePage`) and the edit form, so the optimistic write is what
 * makes the change survive an offline save + app restart until the queue
 * drains.
 */

import type { ProfilePageData } from "@/domain/models/profilePage";
import type { ApiProfile } from "@/domain/ports/api.port";
import type { StoragePort } from "@/domain/ports/storage.port";
import { fail, ok, type Result, type ValidationError } from "@/shared/errors";
import { isIsoDateString } from "@/shared/utils/date";

/** The subset of profile fields the Edit Profile screen can patch. */
export type UpdateProfileInput = Partial<
  Pick<
    ApiProfile,
    | "fullName"
    | "fitnessLevel"
    | "dateOfBirth"
    | "gender"
    | "heightCm"
    | "weightUnit"
    | "heightUnit"
    | "isProfilePublic"
  >
>;

export type UpdateProfileCommandDeps = {
  storage: StoragePort;
  userId: string;
};

export function updateProfileCommand(
  deps: UpdateProfileCommandDeps,
  input: UpdateProfileInput,
): Result<void, ValidationError> {
  // No-op patch — nothing changed, nothing to enqueue. Caller treats
  // this as success (routes back) without a pointless queue entry.
  if (Object.keys(input).length === 0) {
    return ok(undefined);
  }

  // Validate DOB shape BEFORE enqueueing. `null` clears the field (valid);
  // a non-empty string must be a real YYYY-MM-DD calendar date. An invalid
  // date queued offline would 500 the server on every drain attempt.
  if (typeof input.dateOfBirth === "string") {
    if (!isIsoDateString(input.dateOfBirth)) {
      return fail({
        kind: "validation",
        fields: {
          dateOfBirth: "Enter a valid date in YYYY-MM-DD format.",
        },
      });
    }
  }

  if (input.fullName !== undefined && input.fullName !== null) {
    if (input.fullName.trim().length === 0) {
      return fail({
        kind: "validation",
        fields: { fullName: "Name cannot be empty." },
      });
    }
  }

  // Sanity-bound height before enqueueing — an invalid value queued offline
  // would 500 the server on every drain attempt, same rationale as DOB.
  if (typeof input.heightCm === "number") {
    if (
      !Number.isFinite(input.heightCm) ||
      input.heightCm < 50 ||
      input.heightCm > 272
    ) {
      return fail({
        kind: "validation",
        fields: { heightCm: "Enter a height between 50cm and 272cm." },
      });
    }
  }

  // Optimistic cache write — merge the patch into the cached profile-page
  // payload so reads reflect it instantly (and across a restart) until the
  // queue drains. Skipped when there's no cached row yet (the next
  // /profile/page fetch will carry server truth).
  const cached = deps.storage.getCachedProfilePage(deps.userId);
  if (cached) {
    const merged: ProfilePageData = {
      ...cached.payload,
      profile: {
        ...cached.payload.profile,
        ...(input.fullName !== undefined ? { fullName: input.fullName } : {}),
        ...(input.fitnessLevel !== undefined
          ? { fitnessLevel: input.fitnessLevel }
          : {}),
        ...(input.dateOfBirth !== undefined
          ? { dateOfBirth: input.dateOfBirth }
          : {}),
        ...(input.gender !== undefined ? { gender: input.gender } : {}),
        ...(input.heightCm !== undefined ? { heightCm: input.heightCm } : {}),
        ...(input.weightUnit !== undefined
          ? { weightUnit: input.weightUnit }
          : {}),
        ...(input.heightUnit !== undefined
          ? { heightUnit: input.heightUnit }
          : {}),
        ...(input.isProfilePublic !== undefined
          ? { isProfilePublic: input.isProfilePublic }
          : {}),
      },
    };
    deps.storage.cacheProfilePage(deps.userId, merged);
  }

  deps.storage.enqueueMutation({
    entityType: "profile",
    entityId: deps.userId,
    operation: "update",
    payload: input,
    endpoint: "/profile",
    method: "PATCH",
  });

  return ok(undefined);
}
