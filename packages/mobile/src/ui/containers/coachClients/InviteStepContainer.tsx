import { useEffect, useRef, useState } from "react";
import { Share } from "react-native";
import * as Clipboard from "expo-clipboard";
import { Redirect, useLocalSearchParams, useRouter } from "expo-router";

import {
  daysLeft,
  expiresLine,
  firstName,
  inviteShareMessage,
  inviteState,
} from "@/domain/services/coachClientProfiles.service";
import { resolveProfileId } from "@/application/commands/coachClientProfiles.command";
import { useOnlineStatus } from "@/ui/hooks/useOnlineStatus";
import {
  INVITE_REFUSAL_COPY,
  useClientProfile,
  useInviteActions,
} from "@/ui/hooks/useCoachClientProfiles";
import {
  InviteStepPresenter,
  type InviteView,
} from "@/ui/presenters/coachClients/InviteStepPresenter";
import { DeclarationSheetContainer } from "./DeclarationSheetContainer";
import { coachClientRoutes } from "./routes";

/**
 * C11h — Add client · 3 Invite. Issues the client's personal code on
 * arrival when there isn't one, deciding from a fresh read (issuing always
 * expires the live code, so a code made on another device must not be
 * voided). Online only; offline shows the C9c state and waits.
 */
export function InviteStepContainer() {
  const router = useRouter();
  const params = useLocalSearchParams<{ profileId: string }>();
  const rawId = params.profileId ?? "";
  const profile = useClientProfile(resolveProfileId(rawId));
  const online = useOnlineStatus();
  const actions = useInviteActions();
  const [copied, setCopied] = useState(false);
  const [checked, setChecked] = useState(false);
  const tried = useRef(false);
  const detail = profile.data;
  const state = inviteState(detail?.invite);

  // A fresh read first (the create may still be draining too).
  const refresh = profile.refresh;
  useEffect(() => {
    let live = true;
    void refresh({ silent: true }).finally(() => {
      if (live) setChecked(true);
    });
    return () => {
      live = false;
    };
  }, [refresh]);

  const issue = actions.issue;
  useEffect(() => {
    if (!checked || tried.current || !detail || !online) return;
    if (detail.status !== "invited" || state !== "none") return;
    tried.current = true;
    void issue(rawId);
  }, [checked, detail, online, state, issue, rawId]);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1800);
    return () => clearTimeout(t);
  }, [copied]);

  if (detail?.status === "active" && detail.clientId) {
    return <Redirect href={`/(app)/clients/${detail.clientId}`} />;
  }

  const clientFirst = detail ? firstName(detail.displayName) : "your client";
  const live = state === "active" && detail?.invite ? detail.invite : null;
  const invite: InviteView = live
    ? {
        kind: "code",
        code: live.code,
        link: live.link,
        expires: expiresLine(daysLeft(live.expiresAt)),
      }
    : detail?.status === "cancelled"
      ? { kind: "cancelled" }
      : state === "expired"
        ? { kind: "expired" }
        : actions.busy || (!checked && online)
          ? { kind: "working" }
          : { kind: "none" };

  return (
    <InviteStepPresenter
      clientFirst={clientFirst}
      invite={invite}
      offline={!online}
      busy={actions.busy}
      error={actions.refusal ? INVITE_REFUSAL_COPY[actions.refusal] : null}
      copied={copied}
      onShare={() => {
        if (!live) return;
        // A share error (not a cancel) rejects; nothing to show for it.
        Share.share({
          message: inviteShareMessage({
            clientFirst,
            code: live.code,
            link: live.link,
          }),
        }).catch(() => {});
      }}
      onCopy={() => {
        if (!live) return;
        void Clipboard.setStringAsync(live.code).then(() => setCopied(true));
      }}
      onIssue={() => void issue(rawId)}
      onBack={() =>
        router.replace(coachClientRoutes.setup(resolveProfileId(rawId), "add"))
      }
      onDone={() =>
        router.replace(coachClientRoutes.invited(resolveProfileId(rawId)))
      }
      declaration={
        <DeclarationSheetContainer
          visible={actions.declarationOpen}
          busy={actions.busy}
          onConfirm={actions.confirmDeclaration}
          onClose={actions.closeDeclaration}
        />
      }
    />
  );
}
