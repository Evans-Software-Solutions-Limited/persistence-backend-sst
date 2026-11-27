import type { ReactNode } from "react";
import { ScrollView } from "react-native";
import { Text, View } from "@tamagui/core";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import QRCode from "react-native-qrcode-svg";

import { IconShare } from "@/ui/components/icons";
import { Note } from "@/ui/presenters/coachForms/kit";
import {
  ErrorLine,
  GhostButton,
  PageTitle,
  PrimaryButton,
  Steps,
  TopBar,
} from "./kit";

/**
 * C11h — Add client · 3 Invite. The personal code just for this client
 * (7 days), its QR, Share invite (the system sheet with the code and link,
 * C7e) and Copy code. Issuing a code needs a connection (C9c offline state).
 */
export type InviteView =
  | { kind: "code"; code: string; link: string; expires: string }
  | { kind: "working" }
  | { kind: "expired" }
  | { kind: "cancelled" }
  | { kind: "none" };

export type InviteStepPresenterProps = {
  clientFirst: string;
  invite: InviteView;
  offline: boolean;
  busy: boolean;
  error: string | null;
  copied: boolean;
  onShare: () => void;
  onCopy: () => void;
  onIssue: () => void;
  onBack: () => void;
  onDone: () => void;
  declaration: ReactNode;
};

/** Raw white: a QR's quiet zone must stay light whatever the theme (named
 * per the `*Color` convention the design-system lint rule exempts). */
const qrBackgroundColor = "#FFFFFF";
const qrForegroundColor = "#0B0B12";

export function InviteStepPresenter(p: InviteStepPresenterProps) {
  const insets = useSafeAreaInsets();
  const live = p.invite.kind === "code" ? p.invite : null;
  return (
    <View flex={1} paddingTop={insets.top} testID="invite-step">
      <TopBar
        backLabel="Back"
        onBack={p.onBack}
        right={{ label: "Done", onPress: p.onDone, testID: "invite-done" }}
        testID="invite"
      />
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 24 }}
      >
        <PageTitle>{`Invite ${p.clientFirst}`}</PageTitle>
        <View marginTop={4} marginBottom={14}>
          <Steps states={["done", "done", "current"]} />
        </View>
        {p.offline ? (
          <Note testID="invite-offline">
            You&apos;re offline. Sending an invite needs a connection.
          </Note>
        ) : null}
        <View
          alignItems="center"
          gap={10}
          paddingTop={8}
          paddingBottom={16}
          borderBottomWidth={1}
          borderBottomColor="$border2"
        >
          {live ? (
            <>
              <Text
                fontFamily="$body"
                fontWeight="600"
                fontSize={12.5}
                color="$text2"
              >
                {`${p.clientFirst}'s code`}
              </Text>
              <Text
                fontFamily="$mono"
                fontWeight="700"
                fontSize={46}
                lineHeight={50}
                letterSpacing={5}
                color="$text"
                testID="invite-code"
                selectable
              >
                {live.code}
              </Text>
              <Text
                fontFamily="$body"
                fontSize={12.5}
                color="$text3"
                testID="invite-expires"
              >
                {`Just for ${p.clientFirst} · ${live.expires}`}
              </Text>
              <View
                padding={12}
                borderRadius={16}
                marginTop={6}
                testID="invite-qr"
                style={{ backgroundColor: qrBackgroundColor }}
              >
                <QRCode
                  value={live.link}
                  size={150}
                  color={qrForegroundColor}
                  backgroundColor={qrBackgroundColor}
                />
              </View>
            </>
          ) : (
            <Text
              fontFamily="$body"
              fontSize={13.5}
              lineHeight={19}
              color="$text2"
              textAlign="center"
              testID="invite-state"
            >
              {p.invite.kind === "working"
                ? `Making ${p.clientFirst}'s code…`
                : p.invite.kind === "expired"
                  ? `${p.clientFirst}'s code has expired. Send a new one.`
                  : p.invite.kind === "cancelled"
                    ? "This invite was cancelled. Send a new one to invite them again."
                    : `${p.clientFirst} doesn't have a code yet.`}
            </Text>
          )}
          {p.error ? (
            <ErrorLine testID="invite-error">{p.error}</ErrorLine>
          ) : null}
        </View>
      </ScrollView>
      <View
        paddingHorizontal={20}
        paddingTop={8}
        paddingBottom={Math.max(insets.bottom, 16) + 8}
        gap={8}
      >
        {live ? (
          <>
            <PrimaryButton
              label="Share invite"
              icon={<IconShare size={18} color="#1E1B4B" />}
              onPress={p.onShare}
              testID="invite-share"
            />
            <GhostButton
              label={p.copied ? "Copied" : "Copy code"}
              onPress={p.onCopy}
              height={52}
              testID="invite-copy"
            />
          </>
        ) : p.invite.kind !== "working" ? (
          <PrimaryButton
            label={p.invite.kind === "none" ? "Make a code" : "Send a new code"}
            onPress={p.onIssue}
            disabled={p.busy || p.offline}
            testID="invite-issue"
          />
        ) : null}
      </View>
      {p.declaration}
    </View>
  );
}
