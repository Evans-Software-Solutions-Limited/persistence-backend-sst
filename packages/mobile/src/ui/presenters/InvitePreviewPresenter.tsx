import { Pressable, ScrollView } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Text, View } from "@tamagui/core";
import { Btn } from "@/ui/components/foundation";
import { toneHex } from "@/ui/components/foundation/tones";
import { LoadingSpinner } from "@/ui/components/LoadingSpinner";
import { IconCheck, IconChevronL } from "@/ui/components/icons";
import { CoachAvatar, WarnNote } from "./coaching/coachingKit";

/**
 * <InvitePreviewPresenter> — canvas C11j (C7g consent + what's ready),
 * signed off 18 Nov. Shown after a code is entered and previewed
 * (`GET /invites/:code/preview`), before anything is shared.
 *
 * Consent (Brad, 23 Nov): the "<coach> can see" rows are a fixed,
 * read-only list — the backend records one consent, not per-area choices —
 * and a never-pre-ticked "I agree" tick gates "Accept and start"
 * (28-coach-data-sharing-consent, UK GDPR Art 9(2)(a)).
 *
 * Pure: the container owns the preview, the tick, connectivity and the
 * accept call.
 */

/** What a coach sees once accepted, in canvas C11j order. */
export const COACH_CAN_SEE: readonly { label: string; shared: boolean }[] = [
  { label: "Workouts and records", shared: true },
  { label: "Food and calories", shared: true },
  { label: "Weight and body", shared: true },
  { label: "Progress photos", shared: true },
  { label: "Sleep and heart data", shared: false },
];

export type InvitePreviewPresenterProps = {
  coachName: string;
  /** First name for the section headings ("Ellie has ready for you"). */
  coachFirstName: string;
  initials: string;
  /** "Lean bulk programme · 2 forms · …"; empty hides the section. */
  readyLine: string;
  agreed: boolean;
  isSubmitting: boolean;
  isOffline: boolean;
  /** The code ran out while this screen was open. */
  isExpired: boolean;
  /** Inline accept failure (seat cap, already connected, …). */
  errorMessage: string;
  onToggleAgree(): void;
  onAccept(): void;
  onCancel(): void;
  onOpenPrivacyPolicy(): void;
};

export function InvitePreviewPresenter(p: InvitePreviewPresenterProps) {
  const insets = useSafeAreaInsets();
  const canAccept = p.agreed && !p.isSubmitting && !p.isOffline && !p.isExpired;

  return (
    <View flex={1} backgroundColor="$bg" paddingTop={insets.top}>
      <View
        height={52}
        paddingHorizontal={10}
        flexDirection="row"
        alignItems="center"
      >
        <Pressable
          onPress={p.onCancel}
          accessibilityRole="button"
          accessibilityLabel="Cancel"
          hitSlop={4}
          testID="invite-preview-cancel"
          style={{
            minHeight: 44,
            flexDirection: "row",
            alignItems: "center",
            gap: 2,
          }}
        >
          <IconChevronL size={20} color="#C2C2CE" />
          <Text
            fontFamily="$body"
            fontWeight="500"
            fontSize={14}
            color="$text2"
          >
            Cancel
          </Text>
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 140 }}
        testID="invite-preview"
      >
        <View alignItems="center" gap={8}>
          <CoachAvatar initials={p.initials} size={64} fontSize={20} />
          <Text
            fontFamily="$body"
            fontWeight="600"
            fontSize={12.5}
            color="$accentTrainer"
          >
            Coaching invite
          </Text>
          <Text
            fontFamily="$display"
            fontWeight="800"
            fontSize={26}
            lineHeight={32}
            letterSpacing={-0.6}
            color="$text"
            textAlign="center"
            accessibilityRole="header"
          >
            {`${p.coachName} wants to coach you`}
          </Text>
          <Text
            fontFamily="$body"
            fontSize={13.5}
            lineHeight={19}
            color="$text2"
            textAlign="center"
          >
            You can leave any time from the Coach tab.
          </Text>
        </View>

        {p.readyLine !== "" && (
          <View testID="invite-preview-ready">
            <SectionHead>{`${p.coachFirstName} has ready for you`}</SectionHead>
            <Text
              fontFamily="$body"
              fontSize={13}
              lineHeight={19}
              color="$text2"
              marginTop={4}
            >
              {p.readyLine}
            </Text>
          </View>
        )}

        <SectionHead>{`${p.coachFirstName} can see`}</SectionHead>
        {COACH_CAN_SEE.map((row) => (
          <View
            key={row.label}
            flexDirection="row"
            alignItems="center"
            gap={12}
            paddingVertical={8}
            borderBottomWidth={1}
            borderBottomColor="$border"
            accessible
            accessibilityLabel={`${row.label}: ${row.shared ? "shared" : "not shared"}`}
            testID={`invite-preview-share-${row.shared ? "on" : "off"}`}
          >
            <Text
              flex={1}
              fontFamily="$body"
              fontWeight="500"
              fontSize={14}
              lineHeight={20}
              color="$text"
            >
              {row.label}
            </Text>
            <CheckBox checked={row.shared} />
          </View>
        ))}

        <Pressable
          onPress={p.onToggleAgree}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: p.agreed }}
          accessibilityLabel={`I agree to share this with ${p.coachFirstName}.`}
          testID="invite-preview-agree"
          style={{ marginTop: 16 }}
        >
          <View flexDirection="row" alignItems="center" gap={12} minHeight={44}>
            <Text
              flex={1}
              fontFamily="$body"
              fontWeight="600"
              fontSize={14}
              lineHeight={20}
              color="$text"
            >
              {`I agree to share this with ${p.coachFirstName}.`}
            </Text>
            <CheckBox checked={p.agreed} />
          </View>
        </Pressable>
        <Pressable
          onPress={p.onOpenPrivacyPolicy}
          accessibilityRole="link"
          testID="invite-preview-privacy"
          style={{ minHeight: 44, justifyContent: "center" }}
        >
          <Text
            fontFamily="$body"
            fontWeight="600"
            fontSize={13}
            color="$accentTrainer"
            textDecorationLine="underline"
          >
            Read our Privacy Policy
          </Text>
        </Pressable>
      </ScrollView>

      <View
        position="absolute"
        left={20}
        right={20}
        bottom={Math.max(insets.bottom, 20) + 14}
        gap={10}
      >
        {p.isOffline ? (
          <WarnNote testID="invite-preview-offline">
            {"You're offline. Accepting needs a connection."}
          </WarnNote>
        ) : p.isExpired ? (
          <WarnNote testID="invite-preview-expired">
            {`This code has expired. Ask ${p.coachFirstName} for a new one.`}
          </WarnNote>
        ) : p.errorMessage !== "" ? (
          <WarnNote testID="invite-preview-error">{p.errorMessage}</WarnNote>
        ) : null}
        <View flexDirection="row" gap={8}>
          <View flex={1}>
            <Btn
              variant="outline"
              tone="primary"
              size="lg"
              full
              onPress={p.onCancel}
              testID="invite-preview-not-now"
            >
              Not now
            </Btn>
          </View>
          <View flex={1.6}>
            <Btn
              variant="filled"
              tone="primary"
              size="lg"
              full
              disabled={!canAccept}
              onPress={p.onAccept}
              icon={
                p.isSubmitting ? (
                  <LoadingSpinner
                    size="sm"
                    color={toneHex("primary").ink}
                    accessibilityLabel="Accepting"
                  />
                ) : undefined
              }
              testID="invite-preview-accept"
            >
              Accept and start
            </Btn>
          </View>
        </View>
      </View>
    </View>
  );
}

/** Canvas: 14.5px `.st` heading over a hairline. */
function SectionHead(p: { children: string }) {
  return (
    <View
      marginTop={14}
      paddingTop={12}
      borderTopWidth={1}
      borderTopColor="$border2"
    >
      <Text
        fontFamily="$body"
        fontWeight="600"
        fontSize={14.5}
        lineHeight={20}
        color="$text"
        accessibilityRole="header"
      >
        {p.children}
      </Text>
    </View>
  );
}

/** Canvas `.box`: violet when ticked, an outline when not. */
function CheckBox(p: { checked: boolean }) {
  return (
    <View
      width={24}
      height={24}
      borderRadius={7}
      alignItems="center"
      justifyContent="center"
      backgroundColor={p.checked ? "$accentTrainer" : "transparent"}
      borderWidth={p.checked ? 0 : 1.5}
      borderColor="$text4"
    >
      {p.checked ? <IconCheck size={14} color="#1E1B4B" /> : null}
    </View>
  );
}
