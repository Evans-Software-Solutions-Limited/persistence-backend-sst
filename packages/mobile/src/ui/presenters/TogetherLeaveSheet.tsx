import { Text, View } from "@tamagui/core";
import { BottomSheet } from "@/ui/components/foundation";
import { IconX, iconDefaults } from "@/ui/components/icons";
import { listNames } from "./summaryFormat";
import { TogetherBtn } from "./TogetherBtn";
import { TogetherPill } from "./TogetherPill";
import type { WorkoutSession } from "@/domain/models/session";

/** Completed sets: a session starts with an empty row per planned set. */
export function loggedSets(workout: WorkoutSession | null | undefined) {
  return (
    workout?.exercises.reduce(
      (n, e) => n + e.sets.filter((s) => s.isCompleted).length,
      0,
    ) ?? 0
  );
}
/** Row 3's toast after leaving: "You left Brad’s session. Your 6 sets are here." */
export function leftCopy(hostName: string, logged: number) {
  return `You left ${hostName}’s session. ${
    logged
      ? `Your ${logged} ${logged === 1 ? "set is" : "sets are"} here.`
      : "Your workout carries on."
  }`;
}
export const ENDED_COPY = "Live session ended. Your workout carries on.";
export const hostEndedCopy = (hostName: string) =>
  `${hostName} ended the live session. Your workout carries on.`;
/** The leave warning's count and names, from the partner outbox. */
export function unsentFor(
  rows: readonly { ownerId: string; count: number }[],
  name: (id: string) => string,
) {
  const count = rows.reduce((n, r) => n + r.count, 0);
  return count ? { count, names: rows.map((r) => name(r.ownerId)) } : null;
}
export const LEAVE_FAILED_COPY =
  "Could not leave the session. Your workout is safe. Try again.";

/** Sets typed into partners' workouts that have not reached them. */
export type TogetherUnsent = { count: number; names: readonly string[] };

/**
 * Canvas row 3 (`Leave.dc.html` phones 2 and 4): the strip's Leave (guest)
 * or End (host) opens one sentence and two buttons with an orange confirm.
 * Leaving keeps your workout; ending lets everyone carry on solo.
 */
export function TogetherLeaveSheet(p: {
  visible: boolean;
  role: "host" | "guest";
  /** The host, for a guest's title. */
  hostName: string;
  /** Everyone else in the session, for a guest's sentence. */
  others: readonly string[];
  /** Your completed sets. */
  loggedSets: number;
  unsent?: TogetherUnsent | null;
  busy?: boolean;
  onStay(): void;
  onConfirm(): void;
}) {
  const host = p.role === "host";
  const title = host
    ? "End the live session?"
    : `Leave ${p.hostName}’s session?`;
  const sets = `${p.loggedSets} logged ${p.loggedSets === 1 ? "set" : "sets"}`;
  const body = host
    ? "Everyone keeps their own workout and carries on solo. Nobody new can join."
    : `Your workout carries on here${p.loggedSets ? ` with your ${sets}` : ""}.${
        p.others.length
          ? ` ${listNames(p.others)} ${p.others.length === 1 ? "keeps" : "keep"} training.`
          : ""
      }`;
  const unsent = p.unsent?.count ? p.unsent : null;
  return (
    <BottomSheet
      visible={p.visible}
      onClose={p.onStay}
      height={unsent ? 35 : 27}
      contentPadding={{ top: 4, bottom: 28 }}
      testID="together-leave-sheet"
    >
      <View gap={16} accessibilityLabel={title}>
        <View flexDirection="row" alignItems="flex-start" gap={12}>
          <View flex={1} gap={8}>
            <Text
              fontFamily="$display"
              fontWeight="700"
              fontSize={22}
              lineHeight={28}
              letterSpacing={-0.5}
              color="$text"
              accessibilityRole="header"
            >
              {title}
            </Text>
            <Text
              fontFamily="$body"
              fontSize={14}
              lineHeight={20}
              color="$text2"
            >
              {body}
            </Text>
          </View>
          <TogetherPill
            onPress={p.onStay}
            accessibilityLabel="Close"
            icon={<IconX {...iconDefaults({ size: 16 })} />}
          />
        </View>
        {unsent && (
          <View
            flexDirection="row"
            gap={10}
            alignItems="flex-start"
            paddingVertical={12}
            paddingHorizontal={14}
            borderRadius={14}
            borderWidth={1}
            borderColor="$ember"
            backgroundColor="$emberDim"
            accessibilityRole="alert"
            testID="together-leave-unsent"
          >
            <View
              width={6}
              height={6}
              borderRadius={999}
              backgroundColor="$ember"
              marginTop={6}
            />
            <Text
              flex={1}
              fontFamily="$body"
              fontSize={12}
              lineHeight={17}
              color="$text2"
            >
              {`${unsent.count} ${unsent.count === 1 ? "set hasn’t" : "sets haven’t"} reached ${listNames(
                unsent.names,
              )} yet. If you ${host ? "end" : "leave"} now, ${
                unsent.count === 1 ? "it" : "they"
              } won’t be sent.`}
            </Text>
          </View>
        )}
        <View flexDirection="row" gap={10}>
          <View flex={1}>
            <TogetherBtn
              variant="ghost"
              onPress={p.onStay}
              testID="together-leave-stay"
            >
              {host ? "Keep it live" : "Stay"}
            </TogetherBtn>
          </View>
          <View flex={1.4}>
            <TogetherBtn
              variant="ember"
              onPress={p.onConfirm}
              disabled={p.busy}
              testID="together-leave-confirm"
            >
              {host ? "End session" : "Leave"}
            </TogetherBtn>
          </View>
        </View>
      </View>
    </BottomSheet>
  );
}
