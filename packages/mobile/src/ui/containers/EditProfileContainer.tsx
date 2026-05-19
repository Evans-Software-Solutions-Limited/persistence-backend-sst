import { useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert } from "react-native";
import type { ApiProfile } from "@/domain/ports/api.port";
import { useAdapters } from "@/ui/hooks/useAdapters";
import { useAuth } from "@/ui/hooks/useAuth";
import { useProfilePage } from "@/ui/hooks/useProfilePage";
import {
  EditProfilePresenter,
  type EditProfileFitnessLevel,
} from "@/ui/presenters/EditProfilePresenter";

/**
 * M6 PR-4: Edit Profile screen container.
 *
 * Scope: fullName + fitnessLevel + isProfilePublic (3 fields).
 * Username / height / weight / preferred units defer to a later
 * milestone — they touch onboarding territory and want their own
 * UX pass.
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
  isProfilePublic: boolean;
};

export function EditProfileContainer() {
  const router = useRouter();
  const { api, storage } = useAdapters();
  const { session } = useAuth();
  const profilePage = useProfilePage();

  const initial: Snapshot | null = useMemo(() => {
    const p = profilePage.payload?.profile;
    if (!p) return null;
    return {
      fullName: p.fullName ?? "",
      fitnessLevel: asFitnessLevel(p.fitnessLevel),
      isProfilePublic: p.isProfilePublic,
    };
  }, [profilePage.payload]);

  const [fullName, setFullName] = useState("");
  const [fitnessLevel, setFitnessLevel] =
    useState<EditProfileFitnessLevel>("beginner");
  const [isProfilePublic, setIsProfilePublic] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  // Seed form state from the cached payload once it's available. The
  // hook hydrates synchronously from SQLite on mount, so in the common
  // path (user comes from Profile tab) this runs on the first render
  // and the user never sees the spinner.
  useEffect(() => {
    if (!initial || hydrated) return;
    setFullName(initial.fullName);
    setFitnessLevel(initial.fitnessLevel);
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
      isProfilePublic !== initial.isProfilePublic
    );
  }, [initial, hydrated, fullName, fitnessLevel, isProfilePublic]);

  const handleSave = useCallback(async () => {
    if (isSaving) return;
    if (!initial) return;
    setIsSaving(true);
    setErrorMessage(null);
    try {
      // Diff against the hydrated snapshot — only PATCH fields the user
      // actually changed. This avoids two real bugs:
      //   1. Sending `fitnessLevel: "beginner"` on every save would silently
      //      overwrite a user who'd never picked a level (the picker showed
      //      "beginner" only as a placeholder).
      //   2. Sending `fullName: null` when the user didn't edit the field
      //      would briefly fail backend validation in the old `Optional(
      //      String)` schema. The schema's been widened, but only-send-what-
      //      changed is the broader correctness principle anyway.
      const trimmedName = fullName.trim();
      const nextFullName: string | null =
        trimmedName.length > 0 ? trimmedName : null;
      const initialFullName: string | null =
        initial.fullName.length > 0 ? initial.fullName : null;
      const body: Partial<ApiProfile> = {};
      if (nextFullName !== initialFullName) {
        body.fullName = nextFullName;
      }
      if (fitnessLevel !== initial.fitnessLevel) {
        // The picker's "placeholder" beginner state collapses against the
        // initial snapshot's same collapsed value, so a user who never
        // picked a level naturally diffs to no-change here.
        body.fitnessLevel = fitnessLevel;
      }
      if (isProfilePublic !== initial.isProfilePublic) {
        body.isProfilePublic = isProfilePublic;
      }

      if (Object.keys(body).length === 0) {
        // Nothing to send — route back as if save succeeded. Keeps the UX
        // of "tapped Save → returned to Profile" intact while skipping a
        // pointless no-op round trip.
        router.back();
        return;
      }

      const result = await api.updateProfile(body);
      if (!result.ok) {
        setErrorMessage(
          result.error.message ||
            "Couldn't save your profile. Check your connection and try again.",
        );
        return;
      }
      if (session?.userId) {
        storage.invalidateProfilePage(session.userId);
      }
      router.back();
    } finally {
      setIsSaving(false);
    }
  }, [
    api,
    storage,
    router,
    session?.userId,
    isSaving,
    initial,
    fullName,
    fitnessLevel,
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
      isProfilePublic={isProfilePublic}
      isSaving={isSaving}
      isLoadingInitial={!hydrated}
      errorMessage={errorMessage}
      onFullNameChange={setFullName}
      onFitnessLevelChange={setFitnessLevel}
      onIsProfilePublicChange={setIsProfilePublic}
      onSave={() => void handleSave()}
      onBack={handleBack}
    />
  );
}
