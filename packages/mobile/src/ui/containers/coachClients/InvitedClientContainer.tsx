import { useEffect, useMemo, useState } from "react";
import { Alert } from "react-native";
import * as Clipboard from "expo-clipboard";
import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import { Text, View } from "@tamagui/core";

import {
  checklistCount,
  daysLeft,
  expiresLine,
  firstName,
  inviteState,
  profileInitials,
  readyRows,
} from "@/domain/services/coachClientProfiles.service";
import { resolveProfileId } from "@/application/commands/coachClientProfiles.command";
import { useOnlineStatus } from "@/ui/hooks/useOnlineStatus";
import {
  INVITE_REFUSAL_COPY,
  useClientProfile,
  useCoachClientActions,
  useInviteActions,
} from "@/ui/hooks/useCoachClientProfiles";
import { InvitedClientPresenter } from "@/ui/presenters/coachClients/InvitedClientPresenter";
import { TopBar } from "@/ui/presenters/coachClients/kit";
import { DeclarationSheetContainer } from "./DeclarationSheetContainer";
import { coachClientRoutes } from "./routes";
import { useSetupLibrary } from "./useSetupLibrary";

/** The line under Resend / Copy link: the code's state. */
export function inviteLine(
  invite: Parameters<typeof inviteState>[0],
  status: string,
  now: number = Date.now(),
): string {
  if (status === "cancelled") return "Invite cancelled.";
  const state = inviteState(invite, now);
  if (state === "active" && invite) {
    return `Code ${(invite as { code?: string }).code ?? ""} · ${expiresLine(
      daysLeft(invite.expiresAt, now),
    )}`;
  }
  if (state === "expired")
    return "The code has expired. Resend to send a new one.";
  return "No code sent yet.";
}

/**
 * C11i — the invited client. Only Overview is open until they accept (Brad,
 * 18 Nov). Rows open the same section pages as set-up; Resend, Copy link and
 * Cancel invite need a connection. When the client accepts, this becomes
 * their client page.
 */
export function InvitedClientContainer() {
  const router = useRouter();
  const params = useLocalSearchParams<{ profileId: string }>();
  const rawId = params.profileId ?? "";
  const profile = useClientProfile(resolveProfileId(rawId));
  const online = useOnlineStatus();
  const actions = useCoachClientActions();
  const invite = useInviteActions();
  const { library } = useSetupLibrary();
  const [copied, setCopied] = useState(false);
  const detail = profile.data;

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1800);
    return () => clearTimeout(t);
  }, [copied]);

  const rows = useMemo(
    () => (detail ? readyRows(detail, library) : []),
    [detail, library],
  );

  if (!detail) {
    return (
      <View flex={1} testID="invited-missing">
        <TopBar backLabel="Clients" onBack={() => router.back()} />
        <Text
          paddingHorizontal={20}
          fontFamily="$body"
          fontSize={14}
          color="$text3"
        >
          {profile.isRefreshing ? "Loading…" : "We couldn't find this client."}
        </Text>
      </View>
    );
  }
  if (detail.status === "active" && detail.clientId) {
    return <Redirect href={`/(app)/clients/${detail.clientId}`} />;
  }

  const id = detail.id;
  const cancelled = detail.status === "cancelled";
  const live = inviteState(detail.invite) === "active" ? detail.invite : null;
  const count = checklistCount(detail);

  const confirmCancel = () =>
    Alert.alert(
      `Cancel ${firstName(detail.displayName)}'s invite?`,
      "Their code stops working. You can send a new invite later.",
      [
        { text: "Keep invite", style: "cancel" },
        {
          text: "Cancel invite",
          style: "destructive",
          onPress: () => void invite.cancel(id),
        },
      ],
    );

  return (
    <InvitedClientPresenter
      name={detail.displayName}
      initials={profileInitials(detail.displayName)}
      goal={detail.goal}
      clientFirst={firstName(detail.displayName)}
      rows={rows}
      canAddMore={count.done < count.total}
      notes={detail.privateNotes}
      inviteLine={inviteLine(detail.invite, detail.status)}
      cancelled={cancelled}
      offline={!online}
      busy={invite.busy}
      error={invite.refusal ? INVITE_REFUSAL_COPY[invite.refusal] : null}
      linkCopied={copied}
      conflict={!!detail.conflictAt}
      isRefreshing={profile.isRefreshing}
      onRefresh={() => void profile.refresh()}
      onBack={() => router.back()}
      onOpen={(section) => router.push(coachClientRoutes.section(id, section))}
      onAddMore={() => router.push(coachClientRoutes.setup(id, "edit"))}
      onEditDetails={() => router.push(coachClientRoutes.who(id, "edit"))}
      onResend={() => void invite.issue(id)}
      onCopyLink={() => {
        if (!live) return;
        void Clipboard.setStringAsync(live.link).then(() => setCopied(true));
      }}
      onCancelInvite={confirmCancel}
      onDismissConflict={() => actions.dismissProfileConflict(id)}
      declaration={
        <DeclarationSheetContainer
          visible={invite.declarationOpen}
          busy={invite.busy}
          onConfirm={invite.confirmDeclaration}
          onClose={invite.closeDeclaration}
        />
      }
    />
  );
}
