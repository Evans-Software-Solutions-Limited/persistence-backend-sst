/**
 * Mealprint mutation commands — spec-26 T-0.6.
 *
 * Only ONE mutation exists in this slice, and it is the preferences upsert. The
 * suggest call is deliberately NOT here: model-backed calls never enter the sync
 * queue (locked decision 9), because replaying an inference after a reconnect
 * spends one of the user's 20 daily suggestions on a request they abandoned, and
 * there would be no UI left to show the answer in.
 *
 * Spec: specs/26-mealprint-meal-planning/design.md § 4 (Offline)
 */
import type { StoragePort } from "@/domain/ports/storage.port";
import type {
  MealprintPreferences,
  SetMealprintPreferencesInput,
} from "@/domain/models/mealprint";

export type MealprintCommandDeps = {
  storage: StoragePort;
  userId: string;
};

/**
 * Optimistically cache the submitted preferences and enqueue the
 * `PUT /nutrition/preferences` upsert.
 *
 * ## Why the cached row is marked with the SUBMITTED values, not the server's
 *
 * The handler normalises the free-text lists on write (accents stripped,
 * lowercased, whitespace collapsed), so what comes back is not byte-identical to
 * what was sent. Caching the submitted shape is nonetheless right here: it is
 * what makes the editor and the entry card reflect the save instantly and offline
 * (the whole point of the optimistic write), and `sync.command` overwrites it
 * with the server's authoritative row the moment the PUT flushes — see the
 * `nutrition_preferences` reconciliation there. Anything the normaliser changed
 * is a display-only difference for the seconds in between.
 *
 * ## Coalescing
 *
 * ⚠ **The queue is coalesced on a still-pending entry**, the same way
 * `setWaterCommand` is. Preferences are edited in a form with a dozen controls
 * and a Save button, but the editor is reachable repeatedly and an offline user
 * can save four times before a flush — each write is a FULL replacement of the
 * row (last-write-wins), so stacking them means replaying three requests whose
 * only effect is to be overwritten by the fourth. One entry, latest payload.
 *
 * `entityId` is the userId because the row's primary key IS the userId — one row
 * per user, upsert semantics, exactly like `nutrition_target`.
 */
export function setMealprintPreferencesCommand(
  deps: MealprintCommandDeps,
  input: SetMealprintPreferencesInput,
): MealprintPreferences {
  const { storage, userId } = deps;

  const optimistic: MealprintPreferences = {
    userId,
    dietaryPatterns: [...input.dietaryPatterns],
    avoidAllergens: [...input.avoidAllergens],
    avoidFoods: [...input.avoidFoods],
    likedFoods: [...input.likedFoods],
    mealsPerDay: input.mealsPerDay,
    effortLevel: input.effortLevel,
    locale: input.locale,
    // Optimistic timestamp; the flush replaces it with the server's.
    updatedAt: new Date().toISOString(),
    // ⚠ FALSE unconditionally, and this is the point of an explicit save.
    // `isDefault` means "no row exists server-side", and a save creates one — so
    // a user who deliberately keeps the default shape must stop being offered the
    // first-run wizard. Carrying `previous?.isDefault` forward instead would
    // re-offer the wizard on every launch to exactly the user who just dismissed
    // it by saving.
    isDefault: false,
  };
  storage.cacheMealprintPreferences(userId, optimistic);

  const pending = storage
    .getPendingMutations()
    .find(
      (entry) =>
        entry.entityType === "nutrition_preferences" &&
        entry.entityId === userId,
    );
  if (pending) {
    storage.updateMutationPayload(pending.id, input);
  } else {
    storage.enqueueMutation({
      entityType: "nutrition_preferences",
      entityId: userId,
      operation: "update",
      payload: input,
      endpoint: "/nutrition/preferences",
      method: "PUT",
    });
  }

  // Returned so the caller can render the saved shape without re-reading, and so
  // a test can assert the optimistic row without touching storage internals.
  return optimistic;
}
