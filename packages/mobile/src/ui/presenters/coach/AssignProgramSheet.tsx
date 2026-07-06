import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, Switch, TextInput } from "react-native";
import { Text, View } from "@tamagui/core";
import { BottomSheet } from "@/ui/components/foundation/BottomSheet";
import { Btn } from "@/ui/components/foundation/Btn";
import { Avatar } from "@/ui/components/foundation/Avatar";
import { toneHex } from "@/ui/components/foundation/tones";
import { IconCheck } from "@/ui/components/icons";
import { useAssignProgramSheet } from "@/state/assign-program-sheet";
import { useGetTrainerClients } from "@/ui/hooks/useGetTrainerClients";
import { useGetPrograms } from "@/ui/hooks/useGetPrograms";
import { useAdapters } from "@/ui/hooks/useAdapters";
import type { TrainerClient } from "@/domain/models/trainerClient";
import type { ProgramSummary } from "@/domain/models/program";

/** Concrete track colour for the visibility Switches (RN consumer, not Tamagui). */
const SWITCH_ON = toneHex("trainer").base;

/**
 * <AssignProgramSheet> — root-mounted coach assign flow (specs/19-programs
 * STORY-003 + T-19.3.5). Driven by `useAssignProgramSheet`, which opens it in
 * one of two modes:
 *  - **program-anchored** (`openSheet(programId)`, Programs editor): programme
 *    fixed → pick an active CLIENT.
 *  - **client-anchored** (`openForClient(clientId)`, Client Detail): client
 *    fixed → pick a PROGRAMME.
 *
 * Shared fields: start date (default today) + the two visibility toggles.
 * Assign is a DIRECT online call (`api.assignProgram`) — coach writes aren't
 * queued (the server materialises occurrences in one tx). Domain failures map
 * from `ProgramApiError.programCode` to friendly copy. Mounted at root
 * (feedback_sheets_mount_at_root) so it overlays the tab bar.
 */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Map an assign failure code to friendly copy. Exported for unit testing. */
export function assignErrorCopy(programCode: string | undefined): string {
  switch (programCode) {
    case "already_assigned":
      return "This client already has this programme active.";
    case "PROGRAM_EMPTY":
      return "Add workouts to this programme before assigning it.";
    case "not_your_client":
      return "You can only assign programmes to your active clients.";
    case "not_found":
      return "This programme no longer exists.";
    default:
      return "Couldn't assign the programme. Please try again.";
  }
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function SectionLabel({ children }: { children: string }) {
  return (
    <Text
      fontFamily="$display"
      fontSize={10.5}
      fontWeight="600"
      letterSpacing={1.7}
      textTransform="uppercase"
      color="$text3"
    >
      {children}
    </Text>
  );
}

/** A selectable row (client or programme) in the picker. */
function PickerRow({
  title,
  subtitle,
  selected,
  onPress,
  avatarInitials,
  testID,
}: {
  title: string;
  subtitle?: string;
  selected: boolean;
  onPress: () => void;
  avatarInitials?: string;
  testID?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      testID={testID}
      style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
    >
      <View
        flexDirection="row"
        alignItems="center"
        gap={12}
        padding={12}
        borderRadius={12}
        borderWidth={1}
        borderColor={selected ? "$accentTrainer" : "$border"}
        backgroundColor={selected ? "$accentTrainerDim" : "$surface2"}
      >
        {avatarInitials ? (
          <Avatar initials={avatarInitials} size={36} tone="trainer" />
        ) : null}
        <View flex={1} minWidth={0}>
          <Text
            fontFamily="$display"
            fontWeight="600"
            fontSize={14}
            color="$text"
            numberOfLines={1}
          >
            {title}
          </Text>
          {subtitle ? (
            <Text fontFamily="$body" fontSize={11} color="$text3">
              {subtitle}
            </Text>
          ) : null}
        </View>
        {selected ? <IconCheck size={16} color="#A78BFA" /> : null}
      </View>
    </Pressable>
  );
}

export function AssignProgramSheet() {
  const open = useAssignProgramSheet((s) => s.open);
  const anchoredProgramId = useAssignProgramSheet((s) => s.programId);
  const anchoredClientId = useAssignProgramSheet((s) => s.clientId);
  const onAssigned = useAssignProgramSheet((s) => s.onAssigned);
  const closeSheet = useAssignProgramSheet((s) => s.closeSheet);

  const { api } = useAdapters();
  const clientsState = useGetTrainerClients();
  const programsState = useGetPrograms();

  // client-anchored ⇒ pick a programme; otherwise ⇒ pick a client.
  const clientAnchored = anchoredClientId !== null;

  const activeClients = useMemo(
    () => (clientsState.data ?? []).filter((c) => c.status === "active"),
    [clientsState.data],
  );
  const programmes = useMemo(
    () => programsState.data ?? [],
    [programsState.data],
  );

  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);
  const [selectedProgramId, setSelectedProgramId] = useState<string | null>(
    null,
  );
  const [startDate, setStartDate] = useState(todayISO());
  const [showInPlan, setShowInPlan] = useState(true);
  const [showInLibrary, setShowInLibrary] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Reset the form each time the sheet closes.
  useEffect(() => {
    if (!open) {
      setSelectedClientId(null);
      setSelectedProgramId(null);
      setStartDate(todayISO());
      setShowInPlan(true);
      setShowInLibrary(true);
      setError(null);
      setSubmitting(false);
    }
  }, [open]);

  const effectiveProgramId = anchoredProgramId ?? selectedProgramId;
  const effectiveClientId = anchoredClientId ?? selectedClientId;

  const canAssign =
    effectiveProgramId !== null &&
    effectiveClientId !== null &&
    ISO_DATE.test(startDate) &&
    !submitting;

  const handleAssign = useCallback(async () => {
    if (effectiveProgramId === null || effectiveClientId === null) return;
    if (!ISO_DATE.test(startDate)) {
      setError("Enter a start date as YYYY-MM-DD.");
      return;
    }
    setError(null);
    setSubmitting(true);
    const result = await api.assignProgram(effectiveProgramId, {
      clientId: effectiveClientId,
      startDate,
      showInPlan,
      showInLibrary,
    });
    setSubmitting(false);
    if (result.ok) {
      onAssigned?.();
      closeSheet();
      return;
    }
    setError(assignErrorCopy(result.error.programCode));
  }, [
    api,
    effectiveProgramId,
    effectiveClientId,
    startDate,
    showInPlan,
    showInLibrary,
    onAssigned,
    closeSheet,
  ]);

  return (
    <BottomSheet
      visible={open}
      onClose={closeSheet}
      title="Assign programme"
      accent="trainer"
      height="default"
    >
      <View gap={16} testID="assign-program-sheet">
        {/* Picker — programme (client-anchored) or client (program-anchored). */}
        {clientAnchored ? (
          <View gap={8}>
            <SectionLabel>Programme</SectionLabel>
            {programmes.length === 0 ? (
              <Text fontFamily="$body" fontSize={13} color="$text3">
                No programmes yet — create one from the Programmes tab.
              </Text>
            ) : (
              programmes.map((p: ProgramSummary) => (
                <PickerRow
                  key={p.id}
                  title={p.name}
                  subtitle={
                    p.durationWeeks !== null
                      ? `${p.durationWeeks} wks · ${p.daysPerWeek} days/wk`
                      : `Ongoing · ${p.daysPerWeek} days/wk`
                  }
                  selected={p.id === selectedProgramId}
                  onPress={() => setSelectedProgramId(p.id)}
                  testID={`assign-program-${p.id}`}
                />
              ))
            )}
          </View>
        ) : (
          <View gap={8}>
            <SectionLabel>Client</SectionLabel>
            {activeClients.length === 0 ? (
              <Text fontFamily="$body" fontSize={13} color="$text3">
                No active clients yet — invite one from the Clients tab.
              </Text>
            ) : (
              activeClients.map((c: TrainerClient) => (
                <PickerRow
                  key={c.id}
                  title={c.name}
                  avatarInitials={c.initials}
                  selected={c.id === selectedClientId}
                  onPress={() => setSelectedClientId(c.id)}
                  testID={`assign-client-${c.id}`}
                />
              ))
            )}
          </View>
        )}

        {/* Start date. */}
        <View gap={8}>
          <SectionLabel>Start date</SectionLabel>
          <TextInput
            value={startDate}
            onChangeText={setStartDate}
            placeholder="YYYY-MM-DD"
            placeholderTextColor="#8A8A98"
            autoCapitalize="none"
            autoCorrect={false}
            testID="assign-start-date"
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

        {/* Visibility toggles. */}
        <ToggleRow
          label="Show in training plan"
          value={showInPlan}
          onValueChange={setShowInPlan}
          testID="assign-toggle-plan"
        />
        <ToggleRow
          label="Show in workouts library"
          value={showInLibrary}
          onValueChange={setShowInLibrary}
          testID="assign-toggle-library"
        />

        {error ? (
          <Text
            fontFamily="$body"
            fontSize={13}
            color="$error"
            testID="assign-error"
          >
            {error}
          </Text>
        ) : null}

        <Btn
          variant="filled"
          tone="trainer"
          disabled={!canAssign}
          onPress={handleAssign}
          testID="assign-submit"
        >
          {submitting ? "Assigning…" : "Assign programme"}
        </Btn>
      </View>
    </BottomSheet>
  );
}

function ToggleRow({
  label,
  value,
  onValueChange,
  testID,
}: {
  label: string;
  value: boolean;
  onValueChange: (next: boolean) => void;
  testID?: string;
}) {
  return (
    <View
      flexDirection="row"
      alignItems="center"
      justifyContent="space-between"
      gap={12}
    >
      <Text flex={1} fontFamily="$body" fontSize={14} color="$text2">
        {label}
      </Text>
      <Switch
        value={value}
        onValueChange={onValueChange}
        trackColor={{ true: SWITCH_ON }}
        testID={testID}
      />
    </View>
  );
}
