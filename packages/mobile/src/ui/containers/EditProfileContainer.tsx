import { useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert } from "react-native";
import { getApiBaseUrl } from "@/adapters/api";
import {
  processSyncQueue,
  updateProfileCommand,
  type UpdateProfileInput,
} from "@/application/commands";
import { useAdapters } from "@/ui/hooks/useAdapters";
import { useAuth } from "@/ui/hooks/useAuth";
import { useAvatarUpload } from "@/ui/hooks/useAvatarUpload";
import { useProfilePage } from "@/ui/hooks/useProfilePage";
import type { ProfileGender } from "@/domain/models/profilePage";
import {
  EditProfilePresenter,
  type EditProfileFitnessLevel,
} from "@/ui/presenters/EditProfilePresenter";

/**
 * M6 PR-4: Edit Profile screen container.
 *
 * Scope: fullName + fitnessLevel + isProfilePublic (3 fields), plus
 * gender + height (M9 — TDEE calculator inputs, STORY-004). Username /
 * weight / preferred units still defer to a later milestone — weight is
 * a point-in-time measurement logged via the weigh-in flow, not a static
 * profile attribute, so it doesn't belong on this screen.
 *
 * Initial values: read from the cached profile-page payload (instant
 * paint, no spinner if the user came in from the Profile tab).
 *
 * Save: PATCH /profile via the existing endpoint, then invalidate the
 * profile-page cache so the Profile tab re-fetches on focus. Discard
 * back-press is intercepted with a confirmation Alert when the form is
 * dirty.
 */

function asFitnessLevel(
  value: string | null | undefined,
): EditProfileFitnessLevel {
  if (
    value === "beginner" ||
    value === "intermediate" ||
    value === "advanced" ||
    value === "elite"
  ) {
    return value;
  }
  return "beginner";
}

/**
 * Form snapshot used as the diff baseline on save. The snapshot stores
 * the picker's *collapsed* fitness level (null → "beginner") rather than
 * the raw nullable value — so a user who'd never picked a level and
 * leaves the placeholder untouched naturally diffs to "no change" against
 * the same collapsed value, instead of being silently saved as "beginner"
 * because they edited the public switch. Inspector Brad PR #68
 * medium-severity find.
 */
type Snapshot = {
  fullName: string;
  fitnessLevel: EditProfileFitnessLevel;
  dateOfBirth: string;
  /** null = "prefer not to say"/unset in the selector. */
  gender: ProfileGender | null;
  /** cm, as the raw text-field string; "" = unset. */
  heightCm: string;
  isProfilePublic: boolean;
};

export function EditProfileContainer() {
  const router = useRouter();
  const { storage, auth } = useAdapters();
  const { session } = useAuth();
  const profilePage = useProfilePage();
  const avatarUrl = profilePage.payload?.profile.avatarUrl ?? null;
  const avatar = useAvatarUpload(avatarUrl);

  const initial: Snapshot | null = useMemo(() => {
    const p = profilePage.payload?.profile;
    if (!p) return null;
    return {
      fullName: p.fullName ?? "",
      fitnessLevel: asFitnessLevel(p.fitnessLevel),
      dateOfBirth: p.dateOfBirth ?? "",
      gender: p.gender ?? null,
      heightCm: p.heightCm === null ? "" : String(p.heightCm),
      isProfilePublic: p.isProfilePublic,
    };
  }, [profilePage.payload]);

  const [fullName, setFullName] = useState("");
  const [fitnessLevel, setFitnessLevel] =
    useState<EditProfileFitnessLevel>("beginner");
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [gender, setGender] = useState<ProfileGender | null>(null);
  const [heightCm, setHeightCm] = useState("");
  const [isProfilePublic, setIsProfilePublic] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    if (!initial || hydrated) return;
    setFullName(initial.fullName);
    setFitnessLevel(initial.fitnessLevel);
    setDateOfBirth(initial.dateOfBirth);
    setGender(initial.gender);
    setHeightCm(initial.heightCm);
    setIsProfilePublic(initial.isProfilePublic);
    setHydrated(true);
  }, [initial, hydrated]);

  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const isDirty = useMemo(() => {
    if (!initial || !hydrated) return false;
    return (
      fullName !== initial.fullName ||
      fitnessLevel !== initial.fitnessLevel ||
      dateOfBirth !== initial.dateOfBirth ||
      gender !== initial.gender ||
      heightCm !== initial.heightCm ||
      isProfilePublic !== initial.isProfilePublic
    );
  }, [
    initial,
    hydrated,
    fullName,
    fitnessLevel,
    dateOfBirth,
    gender,
    heightCm,
    isProfilePublic,
  ]);

  const handleSave = useCallback(async () => {
    if (isSaving) return;
    if (!initial) return;
    if (!session?.userId) return;
    setIsSaving(true);
    setErrorMessage(null);
    try {
      // Diff against the hydrated snapshot — only patch fields the user
      // actually changed. This avoids silently overwriting a user who
      // never picked a fitness level (the picker shows "beginner" only as
      // a placeholder, so its collapsed value diffs to no-change).
      const trimmedName = fullName.trim();
      const nextFullName: string | null =
        trimmedName.length > 0 ? trimmedName : null;
      const initialFullName: string | null =
        initial.fullName.length > 0 ? initial.fullName : null;
      const input: UpdateProfileInput = {};
      if (nextFullName !== initialFullName) {
        input.fullName = nextFullName;
      }
      if (fitnessLevel !== initial.fitnessLevel) {
        input.fitnessLevel = fitnessLevel;
      }
      if (dateOfBirth !== initial.dateOfBirth) {
        // Empty string clears DOB (send null); otherwise send the raw
        // YYYY-MM-DD string. The command validates the format before
        // enqueueing. Backend stores DOB as text; age is derived
        // client-side (STORY-010 — never persist a computed age).
        const trimmedDob = dateOfBirth.trim();
        input.dateOfBirth = trimmedDob.length > 0 ? trimmedDob : null;
      }
      if (gender !== initial.gender) {
        input.gender = gender;
      }
      if (heightCm !== initial.heightCm) {
        // Empty string clears height (send null); otherwise parse to a
        // number — the command range-validates it before enqueueing.
        // Non-numeric text also parses to NaN, which the command's
        // Number.isFinite check rejects the same way.
        const trimmedHeight = heightCm.trim();
        input.heightCm =
          trimmedHeight.length > 0 ? Number(trimmedHeight) : null;
      }
      if (isProfilePublic !== initial.isProfilePublic) {
        input.isProfilePublic = isProfilePublic;
      }

      // Offline-first: optimistic cache write + enqueue (NOT a direct
      // PATCH). The command returns a validation error synchronously for a
      // bad DOB so it never reaches the queue; otherwise the queued
      // mutation drains via useSyncWorker (mounted at the auth boundary)
      // on the next foreground — plus the inline drain below for immediacy.
      const result = updateProfileCommand(
        { storage, userId: session.userId },
        input,
      );
      if (!result.ok) {
        setErrorMessage(
          result.error.fields.dateOfBirth ??
            result.error.fields.fullName ??
            result.error.fields.heightCm ??
            "Couldn't save your profile. Check your details and try again.",
        );
        return;
      }

      // Kick an inline drain so a save made while online lands now rather
      // than waiting for the next foreground. Offline-safe: the per-entry
      // retry path inside processSyncQueue handles transient failures, and
      // the optimistic cache write already reflects the change locally.
      // Not awaited — Save must not block on the network (offline-first).
      void processSyncQueue(storage, auth, getApiBaseUrl()).catch((err) => {
        console.warn("[EditProfileContainer] post-save drain failed:", err);
      });

      router.back();
    } finally {
      setIsSaving(false);
    }
  }, [
    storage,
    auth,
    router,
    session?.userId,
    isSaving,
    initial,
    fullName,
    fitnessLevel,
    dateOfBirth,
    gender,
    heightCm,
    isProfilePublic,
  ]);

  const handleBack = useCallback(() => {
    if (!isDirty) {
      router.back();
      return;
    }
    Alert.alert(
      "Discard changes?",
      "You have unsaved changes. Are you sure you want to discard them?",
      [
        { text: "Keep editing", style: "cancel" },
        {
          text: "Discard",
          style: "destructive",
          onPress: () => router.back(),
        },
      ],
    );
  }, [isDirty, router]);

  return (
    <EditProfilePresenter
      fullName={fullName}
      fitnessLevel={fitnessLevel}
      dateOfBirth={dateOfBirth}
      gender={gender}
      heightCm={heightCm}
      isProfilePublic={isProfilePublic}
      isSaving={isSaving}
      isLoadingInitial={!hydrated}
      errorMessage={errorMessage}
      avatarUrl={avatarUrl}
      avatarCacheKey={avatar.cacheKey}
      isAvatarWorking={avatar.isWorking}
      onSelectAvatar={avatar.showAvatarSheet}
      onFullNameChange={setFullName}
      onFitnessLevelChange={setFitnessLevel}
      onDateOfBirthChange={setDateOfBirth}
      onGenderChange={setGender}
      onHeightCmChange={setHeightCm}
      onIsProfilePublicChange={setIsProfilePublic}
      onSave={() => void handleSave()}
      onBack={handleBack}
    />
  );
}
