import { useState } from "react";
import { getApiBaseUrl } from "@/adapters/api";
import { updateProfileCommand } from "@/application/commands/update-profile.command";
import { logMeasurementCommand } from "@/application/commands/log-measurement.command";
import { processSyncQueue } from "@/application/commands/sync.command";
import type { ProfilePageProfile } from "@/domain/models/profilePage";
import { KG_PER_LB, localDayISO, weightInUnit } from "@/shared/utils";
import {
  formatHeightInput,
  parseHeightInput,
  type HeightInputFormat,
} from "@/shared/utils/height-input";
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
  heightFormat?: HeightInputFormat;
  heightCm?: number | null;
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
    const heightFormat = current?.heightUnit ?? "cm";
    const height = formatHeightInput(current?.heightCm ?? null, heightFormat);
    const value =
      field === "age"
        ? (current?.dateOfBirth ?? "")
        : field === "gender"
          ? (current?.gender ?? "")
          : field === "weight"
            ? weight === null
              ? ""
              : String(weightInUnit(weight, current?.weightUnit ?? "kg"))
            : height.value;
    setEditor({
      field,
      value,
      inches: height.inches,
      heightFormat,
      heightCm: current?.heightCm ?? null,
      error: null,
    });
  };
  const change = (value: string, inches = false) =>
    setEditor((old) =>
      old
        ? {
            ...old,
            [inches ? "inches" : "value"]: value,
            heightCm: undefined,
            error: null,
          }
        : old,
    );
  const changeHeightFormat = (heightFormat: HeightInputFormat) =>
    setEditor((old) => {
      if (!old || old.field !== "height") return old;
      const cm =
        old.heightCm !== undefined
          ? old.heightCm
          : parseHeightInput(
              old,
              old.heightFormat ?? current?.heightUnit ?? "cm",
            );
      if (cm === null && (old.value.trim() || old.inches.trim()))
        return {
          ...old,
          error: "Enter a valid height before switching units.",
        };
      return {
        ...old,
        ...formatHeightInput(cm, heightFormat),
        heightFormat,
        heightCm: cm,
        error: null,
      };
    });
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
    } else if (editor.field === "height") {
      const format = editor.heightFormat ?? current.heightUnit;
      const cm =
        editor.heightCm !== undefined
          ? editor.heightCm
          : parseHeightInput(editor, format);
      if (cm === null)
        return reject(
          "Enter a valid height. Use centimetres below 100 or inches below 12 in split fields.",
        );
      patch.heightCm = cm;
      const heightUnit = format === "in" || format === "ftin" ? "ftin" : "cm";
      if (heightUnit !== current.heightUnit) patch.heightUnit = heightUnit;
    } else {
      const number = Number(value);
      if (!value || !Number.isFinite(number) || number <= 0)
        return reject("Enter a valid positive number.");
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
    changeHeightFormat,
    close,
    save,
  };
}
