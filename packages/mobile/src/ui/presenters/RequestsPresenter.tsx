import { RefreshControl, ScrollView } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Text, View } from "@tamagui/core";
import { Avatar, Btn, Card, HeaderBar, IconBtn } from "@/ui/components/foundation";
import { ErrorState, PLogoDrawLoader } from "@/ui/components";
import { IconBack, IconUser } from "@/ui/components/icons";
import { initialsOf } from "@/shared/utils";
import type { ApiError } from "@/shared/errors";
import type { ClientTrainerRelationship } from "@/domain/models/clientRelationship";

/**
 * <RequestsPresenter> — incoming coach requests the client can accept or
 * decline (10-trainer-features). Reached from the `pt_request` /
 * `physio_request` notification deeplink (persistencemobile://requests).
 * Pure presentational; mirrors the You/Coach surfaces (HeaderBar + Cards +
 * trainer-tone accents).
 */

export type RequestsPresenterProps = {
  requests: ClientTrainerRelationship[];
  pendingIds: ReadonlySet<string>;
  isLoading: boolean;
  isRefreshing: boolean;
  error?: ApiError | null;
  onRefresh: () => void;
  onBack: () => void;
  onAccept: (relationshipId: string) => void;
  onDecline: (relationshipId: string) => void;
};

/** Human label for a trainer role. */
export function roleLabel(role: string | null): string {
  switch (role) {
    case "physiotherapist":
      return "Physiotherapist";
    case "personal_trainer":
      return "Personal Trainer";
    case "admin":
      return "Coach";
    default:
      return "Trainer";
  }
}

function RequestCard({
  request,
  busy,
  onAccept,
  onDecline,
}: {
  request: ClientTrainerRelationship;
  busy: boolean;
  onAccept: () => void;
  onDecline: () => void;
}) {
  return (
    <Card testID={`request-card-${request.relationshipId}`}>
      <View flexDirection="row" alignItems="center" gap={12}>
        <Avatar
          size={44}
          tone="trainer"
          initials={initialsOf(request.trainerName) || "?"}
        />
        <View flex={1}>
          <Text fontFamily="$display" fontWeight="700" fontSize={16} color="$text">
            {request.trainerName}
          </Text>
          <Text fontSize={12.5} color="$text3" marginTop={2}>
            {roleLabel(request.trainerRole)}
            {request.relationshipReason ? ` · ${request.relationshipReason}` : ""}
          </Text>
        </View>
      </View>
      <View flexDirection="row" gap={10} marginTop={14}>
        <View flex={1}>
          <Btn
            variant="filled"
            tone="trainer"
            full
            disabled={busy}
            onPress={onAccept}
            testID={`request-accept-${request.relationshipId}`}
          >
            Accept
          </Btn>
        </View>
        <View flex={1}>
          <Btn
            variant="ghost"
            tone="error"
            full
            disabled={busy}
            onPress={onDecline}
            testID={`request-decline-${request.relationshipId}`}
          >
            Decline
          </Btn>
        </View>
      </View>
    </Card>
  );
}

export function RequestsPresenter(props: RequestsPresenterProps) {
  const {
    requests,
    pendingIds,
    isLoading,
    isRefreshing,
    error,
    onRefresh,
    onBack,
    onAccept,
    onDecline,
  } = props;
  const insets = useSafeAreaInsets();
  const hasAny = requests.length > 0;

  if (isLoading && !hasAny) {
    return (
      <View
        flex={1}
        alignItems="center"
        justifyContent="center"
        testID="requests-loader"
      >
        <PLogoDrawLoader />
      </View>
    );
  }
  if (error && !hasAny) {
    return (
      <View flex={1} testID="requests-error-state">
        <ErrorState
          message="Couldn't load your requests."
          onRetry={onRefresh}
        />
      </View>
    );
  }

  return (
    <View flex={1} paddingTop={insets.top}>
      <HeaderBar
        eyebrow="TRAINING"
        title="Requests"
        leading={
          <IconBtn
            icon={<IconBack size={20} />}
            tone="neutral"
            onPress={onBack}
            accessibilityLabel="Back"
          />
        }
      />
      <ScrollView
        testID="requests-scroll"
        contentContainerStyle={{ padding: 20, paddingBottom: 140, gap: 12 }}
        refreshControl={
          <RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} />
        }
      >
        {!hasAny ? (
          <View
            alignItems="center"
            justifyContent="center"
            paddingVertical={64}
            gap={12}
            testID="requests-empty"
          >
            <IconUser size={32} />
            <Text fontFamily="$display" fontWeight="700" fontSize={17} color="$text">
              No pending requests
            </Text>
            <Text fontSize={13} color="$text3" textAlign="center">
              When a coach invites you to connect, it'll show up here.
            </Text>
          </View>
        ) : (
          requests.map((r) => (
            <RequestCard
              key={r.relationshipId}
              request={r}
              busy={pendingIds.has(r.relationshipId)}
              onAccept={() => onAccept(r.relationshipId)}
              onDecline={() => onDecline(r.relationshipId)}
            />
          ))
        )}
      </ScrollView>
    </View>
  );
}
