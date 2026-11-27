import { useMemo } from "react";
import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import { Text, View } from "@tamagui/core";

import {
  IPHONE_SECTIONS,
  SECTION_TITLE,
  checklistCount,
  checklistSummary,
  firstName,
  itemsOf,
} from "@/domain/services/coachClientProfiles.service";
import { resolveProfileId } from "@/application/commands/coachClientProfiles.command";
import {
  INVITE_REFUSAL_COPY,
  useClientProfile,
  useCoachClientActions,
  useInviteActions,
} from "@/ui/hooks/useCoachClientProfiles";
import { useGetTrainerClients } from "@/ui/hooks/useGetTrainerClients";
import { SetupChecklistPresenter } from "@/ui/presenters/coachClients/SetupChecklistPresenter";
import { TopBar } from "@/ui/presenters/coachClients/kit";
import { coachClientRoutes, flowOf } from "./routes";
import { useSetupLibrary } from "./useSetupLibrary";

export const COPY_OFFLINE =
  "You're offline. Copying a set-up needs a connection.";

/**
 * C11g — Set up (checklist). In the add flow Back returns to Who, and Skip
 * and Next go to Invite (each replacing this step). From the invited client
 * (edit) Back just goes back.
 */
export function SetupChecklistContainer() {
  const router = useRouter();
  const params = useLocalSearchParams<{ profileId: string; flow?: string }>();
  const profileId = resolveProfileId(params.profileId ?? "");
  const flow = flowOf(params.flow);
  const profile = useClientProfile(profileId);
  const actions = useCoachClientActions();
  const invite = useInviteActions();
  const { library } = useSetupLibrary();
  const roster = useGetTrainerClients();
  const detail = profile.data;

  const rows = useMemo(
    () =>
      detail
        ? IPHONE_SECTIONS.map((section) => {
            const items = itemsOf(detail, section);
            return {
              section,
              title: SECTION_TITLE[section],
              summary: checklistSummary(
                section,
                items,
                library,
                detail.displayName,
              ),
              added: items.length > 0,
            };
          })
        : [],
    [detail, library],
  );

  if (!detail) {
    return (
      <View flex={1} testID="setup-missing">
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

  const count = checklistCount(detail);
  const copySources = (roster.data ?? [])
    .filter((c) => c.status === "active")
    .map((c) => ({ id: c.id, name: c.name }));

  return (
    <SetupChecklistPresenter
      clientFirst={firstName(detail.displayName)}
      mode={flow}
      rows={rows}
      done={count.done}
      total={count.total}
      conflict={!!detail.conflictAt}
      copySources={copySources}
      copyBusy={invite.busy}
      copyError={
        invite.refusal === "offline"
          ? COPY_OFFLINE
          : invite.refusal
            ? INVITE_REFUSAL_COPY[invite.refusal]
            : null
      }
      onOpen={(section) =>
        router.push(coachClientRoutes.section(detail.id, section))
      }
      onPreview={() => router.push(coachClientRoutes.preview(detail.id))}
      onCopyFrom={(clientId) => void invite.copyFrom(detail.id, clientId)}
      onBack={() =>
        flow === "add"
          ? router.replace(coachClientRoutes.who(detail.id, "add"))
          : router.back()
      }
      onSkip={() => router.replace(coachClientRoutes.invite(detail.id))}
      onNext={() => router.replace(coachClientRoutes.invite(detail.id))}
      onDismissConflict={() => actions.dismissProfileConflict(detail.id)}
    />
  );
}
