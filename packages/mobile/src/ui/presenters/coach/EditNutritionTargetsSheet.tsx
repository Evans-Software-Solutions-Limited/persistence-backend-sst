import { useCallback, useEffect, useMemo, useState } from "react";
import { TextInput } from "react-native";
import { Text, View } from "@tamagui/core";
import { BottomSheet } from "@/ui/components/foundation/BottomSheet";
import { Btn } from "@/ui/components/foundation/Btn";
import { useEditNutritionTargetsSheet } from "@/state/edit-nutrition-targets-sheet";
import { useAdapters } from "@/ui/hooks/useAdapters";
import type { SetTargetsInput } from "@/domain/models/nutrition";

/**
 * <EditNutritionTargetsSheet> — the coach sets a client's daily kcal + macros
 * on their behalf (M8 Coach Phase 5). Root-mounted; opened from Client Detail
 * with the client fixed. Writes via `PUT /trainers/me/clients/:id/nutrition/
 * target` (`api.setClientNutritionTarget`). Direct online call, like the
 * assign-workout flow.
 *
 * Fidelity note: the prototype's TargetsCard is a display grid with a per-tile
 * pencil, not an edit form — there is no macros-edit sheet in the prototype.
 * This sheet is one of the brief's stated Phase-5 deltas (QuickActionsRow
 * "Macros" + TargetsCard edit), so it follows the app's existing sheet chrome
 * (AssignWorkoutSheet) rather than a prototype layout.
 */

/** Parse a non-negative integer from a text field, or null when blank/invalid. */
export function parseTargetField(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  if (!/^\d+$/.test(trimmed)) return null;
  return Number.parseInt(trimmed, 10);
}

const FIELDS: {
  key: "dailyKcal" | "proteinG" | "carbsG" | "fatG" | "waterCups";
  label: string;
  unit: string;
}[] = [
  { key: "dailyKcal", label: "Calories", unit: "kcal / day" },
  { key: "proteinG", label: "Protein", unit: "g / day" },
  { key: "carbsG", label: "Carbs", unit: "g / day" },
  { key: "fatG", label: "Fat", unit: "g / day" },
  { key: "waterCups", label: "Water", unit: "cups / day" },
];

export function EditNutritionTargetsSheet() {
  const open = useEditNutritionTargetsSheet((s) => s.open);
  const clientId = useEditNutritionTargetsSheet((s) => s.clientId);
  const initial = useEditNutritionTargetsSheet((s) => s.initial);
  const onSaved = useEditNutritionTargetsSheet((s) => s.onSaved);
  const closeSheet = useEditNutritionTargetsSheet((s) => s.closeSheet);

  const { api } = useAdapters();

  const [dailyKcal, setDailyKcal] = useState("");
  const [proteinG, setProteinG] = useState("");
  const [carbsG, setCarbsG] = useState("");
  const [fatG, setFatG] = useState("");
  const [waterCups, setWaterCups] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const values: Record<(typeof FIELDS)[number]["key"], string> = {
    dailyKcal,
    proteinG,
    carbsG,
    fatG,
    waterCups,
  };
  const setters: Record<(typeof FIELDS)[number]["key"], (v: string) => void> = {
    dailyKcal: setDailyKcal,
    proteinG: setProteinG,
    carbsG: setCarbsG,
    fatG: setFatG,
    waterCups: setWaterCups,
  };

  // Seed from the aggregate's module d when the sheet opens; reset on close.
  useEffect(() => {
    if (!open) {
      setError(null);
      setSubmitting(false);
      return;
    }
    const asText = (n: number | null | undefined) =>
      n == null ? "" : String(n);
    setDailyKcal(asText(initial?.dailyKcal));
    setProteinG(asText(initial?.proteinG));
    setCarbsG(asText(initial?.carbsG));
    setFatG(asText(initial?.fatG));
    setWaterCups(asText(initial?.waterCups));
    setError(null);
    setSubmitting(false);
  }, [open, initial]);

  // Every field is required + a non-negative integer — the backend validator
  // (t.Number({ minimum: 0 })) rejects partial / negative bodies.
  // Parse every field once; `payload` is non-null iff all five are valid whole
  // numbers, which is exactly what gates the Save button — so the handler
  // reads a single truthy check with no per-field null fallbacks.
  const payload = useMemo<SetTargetsInput | null>(() => {
    const nums = [dailyKcal, proteinG, carbsG, fatG, waterCups].map(
      parseTargetField,
    );
    if (nums.some((v) => v === null)) return null;
    return {
      dailyKcal: nums[0] as number,
      proteinG: nums[1] as number,
      carbsG: nums[2] as number,
      fatG: nums[3] as number,
      waterCups: nums[4] as number,
    };
  }, [dailyKcal, proteinG, carbsG, fatG, waterCups]);
  const canSave = clientId !== null && payload !== null && !submitting;

  const handleSave = useCallback(async () => {
    if (!canSave || clientId === null || payload === null) return;
    setError(null);
    setSubmitting(true);
    const result = await api.setClientNutritionTarget(clientId, payload);
    setSubmitting(false);
    if (result.ok) {
      onSaved?.();
      closeSheet();
      return;
    }
    setError("Couldn't save the targets. Please try again.");
  }, [api, canSave, clientId, payload, onSaved, closeSheet]);

  return (
    <BottomSheet
      visible={open}
      onClose={closeSheet}
      title="Edit targets"
      accent="trainer"
      height="default"
    >
      <View gap={16} testID="edit-nutrition-targets-sheet">
        {FIELDS.map((f) => (
          <View key={f.key} gap={8}>
            <Text
              fontFamily="$display"
              fontSize={10.5}
              fontWeight="600"
              letterSpacing={1.7}
              textTransform="uppercase"
              color="$text3"
            >
              {f.label} · {f.unit}
            </Text>
            <TextInput
              value={values[f.key]}
              onChangeText={setters[f.key]}
              placeholder="0"
              placeholderTextColor="#8A8A98"
              keyboardType="number-pad"
              autoCorrect={false}
              testID={`edit-target-${f.key}`}
              style={{
                height: 44,
                borderRadius: 12,
                borderWidth: 1,
                borderColor: "#232735",
                backgroundColor: "#1A1D29",
                paddingHorizontal: 14,
                color: "#F4F4F8",
                fontSize: 14,
              }}
            />
          </View>
        ))}

        {error ? (
          <Text
            fontFamily="$body"
            fontSize={13}
            color="$error"
            testID="edit-nutrition-targets-error"
          >
            {error}
          </Text>
        ) : null}

        <Btn
          variant="filled"
          tone="trainer"
          disabled={!canSave}
          onPress={handleSave}
          testID="edit-nutrition-targets-submit"
        >
          {submitting ? "Saving…" : "Save targets"}
        </Btn>
      </View>
    </BottomSheet>
  );
}
