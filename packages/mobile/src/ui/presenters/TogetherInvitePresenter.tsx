import type { ReactNode } from "react";
import { Text, View } from "@tamagui/core";
import { Btn } from "@/ui/components/foundation/Btn";
import { Card } from "@/ui/components/foundation/Card";

/** Reviewed v2 invite card; the QR contains the actual authenticated invitation. */
export function TogetherInvitePresenter(p: {
  qr: ReactNode;
  notice?: string;
  scanInstruction?: string;
  pendingCount: number;
  personal: boolean;
  friendsOnly?: boolean;
  onCopy(): void;
  onShare(): void;
  onSettings(): void;
}) {
  return (
    <View gap={12}>
      <Text color="$text2" fontFamily="$body" fontSize={13}>
        {p.friendsOnly
          ? "Only accepted training partners can use this invitation and choose to join."
          : "Share this invitation. Accepted training partners choose to join; anyone else needs your approval."}{" "}
        Up to four athletes, each with qualifying paid access.
      </Text>
      <Card surface={0} pad={16} radius={16} accent="primary">
        <View gap={14}>
          <View flexDirection="row" alignItems="center" gap={14}>
            {p.qr}
            <View flex={1} gap={6}>
              <Text
                color="$text3"
                fontFamily="$body"
                fontSize={10}
                letterSpacing={1}
              >
                SESSION INVITATION
              </Text>
              <Text
                color="$primary"
                fontFamily="$display"
                fontWeight="600"
                fontSize={19}
              >
                Scan to join
              </Text>
              <Text color="$text3" fontFamily="$body" fontSize={11}>
                {p.scanInstruction ?? "Or copy and send the secure invitation."}
              </Text>
            </View>
          </View>
          <View flexDirection="row" gap={8}>
            <View flex={1}>
              <Btn full variant="soft" onPress={p.onCopy}>
                Copy
              </Btn>
            </View>
            <View flex={1}>
              <Btn full variant="soft" onPress={p.onShare}>
                Share
              </Btn>
            </View>
          </View>
        </View>
      </Card>
      {!!p.notice && (
        <Text color="$text2" accessibilityLiveRegion="polite">
          {p.notice}
        </Text>
      )}
      {p.personal && (
        <Text color="$text2" fontFamily="$body" fontSize={12}>
          Your workout is still personal. Open settings to share your current
          workout while keeping your logged sets.
        </Text>
      )}
      <Card
        surface={1}
        pad={13}
        radius={12}
        onPress={p.onSettings}
        accessibilityRole="button"
        accessibilityLabel="Session settings"
      >
        <View gap={5}>
          <Text
            color="$text"
            fontFamily="$display"
            fontSize={14}
            fontWeight="600"
          >
            Session settings
          </Text>
          <Text color="$text3" fontFamily="$body" fontSize={12}>
            My workout, sharing permissions and people
          </Text>
          {p.pendingCount > 0 && (
            <Text
              color="$primary"
              fontFamily="$body"
              fontSize={12}
              accessibilityLiveRegion="polite"
            >
              {p.pendingCount}{" "}
              {p.pendingCount === 1 ? "athlete waiting" : "athletes waiting"}{" "}
              for approval
            </Text>
          )}
        </View>
      </Card>
    </View>
  );
}
