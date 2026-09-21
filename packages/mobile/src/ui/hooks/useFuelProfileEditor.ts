import { useState } from "react";
import { getApiBaseUrl } from "@/adapters/api";
import { updateProfileCommand } from "@/application/commands/update-profile.command";
import { logMeasurementCommand } from "@/application/commands/log-measurement.command";
import { processSyncQueue } from "@/application/commands/sync.command";
import type { ProfilePageProfile } from "@/domain/models/profilePage";
import {
  cmToFeetInches,
  KG_PER_LB,
  localDayISO,
  weightInUnit,
} from "@/shared/utils";
import { isIsoDateString } from "@/shared/utils/date";
import { useAdapters } from "./useAdapters";
import { useAuth } from "./useAuth";

export type FuelProfileField = "age" | "gender" | "height" | "weight";
type Profile = Pick<
  ProfilePageProfile,
  "dateOfBirth" | "gender" | "heightCm" | "heightUnit" | "weightUnit"
>;
export type FuelProfileEditorState = {
  field: FuelProfileField;
  value: string;
  inches: string;
  error: string | null;
};

/** Keep accepted edits visible while their offline mutations await sync. */
export function useFuelProfileEditor(
  profile: Profile | null,
  weightKg: number | null,
) {
  const { storage, auth } = useAdapters();
  const { session } = useAuth();
  const [saved, setSaved] = useState<{
    userId: string;
    profile: Partial<Profile>;
    weightKg?: number;
  } | null>(null);
  const ownSaved = saved?.userId === session?.userId ? saved : null;
  const current = profile ? { ...profile, ...ownSaved?.profile } : null;
  const weight = ownSaved?.weightKg ?? weightKg;
  const [editor, setEditor] = useState<FuelProfileEditorState | null>(null);

  const open = (field: FuelProfileField) => {
    const feet = current?.heightCm ? cmToFeetInches(current.heightCm) : null;
    const value =
      field === "age"
        ? (current?.dateOfBirth ?? "")
        : field === "gender"
          ? (current?.gender ?? "")
          : field === "weight"
            ? weight === null
              ? ""
              : String(weightInUnit(weight, current?.weightUnit ?? "kg"))
            : current?.heightCm == null
              ? ""
              : current.heightUnit === "ftin"
                ? String(feet?.feet ?? "")
                : String(current.heightCm);
    setEditor({
      field,
      value,
      inches: feet ? String(feet.inches) : "",
      error: null,
    });
  };
  const change = (value: string, inches = false) =>
    setEditor((old) =>
      old ? { ...old, [inches ? "inches" : "value"]: value, error: null } : old,
    );
  const close = () => setEditor(null);
  const save = () => {
    if (!editor) return;
    const reject = (error: string) => setEditor({ ...editor, error });
    const userId = session?.userId;
    if (!userId || !current)
      return reject("Your profile is still loading. Please try again.");
    const value = editor.value.trim();
    const patch: Partial<Profile> = {};
    let nextWeight: number | undefined;
    if (editor.field === "age") {
      if (!isIsoDateString(value) || value >= localDayISO())
        return reject("Enter a date of birth before today (YYYY-MM-DD).");
      patch.dateOfBirth = value;
    } else if (editor.field === "gender") {
      if (value !== "male" && value !== "female" && value !== "other")
        return reject(
          "Choose a sex for the calculation, or use manual calories.",
        );
      patch.gender = value;
    } else {
      const number = Number(value);
      if (!value || !Number.isFinite(number) || number <= 0)
        return reject("Enter a valid positive number.");
      if (editor.field === "height") {
        if (current.heightUnit === "ftin") {
          const inches = Number(editor.inches);
          if (
            !editor.inches.trim() ||
            !Number.isInteger(number) ||
            !Number.isFinite(inches) ||
            inches < 0 ||
            inches >= 12
          )
            return reject(
              "Enter whole feet and inches from 0 to less than 12.",
            );
          patch.heightCm = (number * 12 + inches) * 2.54;
        } else patch.heightCm = number;
      } else
        nextWeight = current.weightUnit === "lb" ? number * KG_PER_LB : number;
    }
    try {
      const result =
        nextWeight === undefined
          ? updateProfileCommand({ storage, userId }, patch)
          : logMeasurementCommand(
              { storage, userId, day: localDayISO() },
              { weightKg: nextWeight },
            );
      if (!result.ok) return reject(Object.values(result.error.fields)[0]);
      setSaved({
        userId,
        profile: { ...ownSaved?.profile, ...patch },
        weightKg: nextWeight ?? ownSaved?.weightKg,
      });
      close();
      void processSyncQueue(storage, auth, getApiBaseUrl()).catch(() => {
        /* Accepted offline writes remain queued. */
      });
    } catch {
      reject("Couldn't save your details. Please try again.");
    }
  };
  return {
    profile: current,
    weightKg: weight,
    editor,
    open,
    change,
    close,
    save,
  };
}
