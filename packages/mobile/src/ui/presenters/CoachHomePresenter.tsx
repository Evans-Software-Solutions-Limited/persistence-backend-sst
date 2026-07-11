import { RefreshControl, ScrollView } from "react-native";
import { Text, View } from "@tamagui/core";
import { Avatar, Btn, Card, IconBtn } from "@/ui/components/foundation";
import { ErrorState, PLogoDrawLoader } from "@/ui/components";
import { IconBell } from "@/ui/components/icons";
import type { ApiError } from "@/shared/errors";
import {
  FlaggedClientsPresenter,
  type FlaggedClientVM,
} from "./coach/FlaggedClientsPresenter";
import {
  ProgrammeAlertsPresenter,
  type ProgrammeAlertVM,
} from "./coach/ProgrammeAlertsPresenter";
import { TrainYourselfCardPresenter } from "./coach/TrainYourselfCardPresenter";
import {
  ScheduleHeroPresenter,
  type ScheduleItemVM,
} from "./coach/ScheduleHeroPresenter";

/**
 * <CoachHomePresenter> — the coach-mode Home tab: a daily TRIAGE screen. Ports
 * the prototype `CoachHome` (design-source/screens/coach-home.jsx) 1:1, minus
 * the deferred schedule hero. Blocks top-to-bottom: header → "Needs you today"
 * flagged clients → programme alerts → "Train yourself" mode-switch card.
 *
 * Pure presentational. The container (`CoachHomeContainer`) derives every
 * view-model from the existing `GET /trainers/me/clients` roster + athlete-mode
 * streak/home hooks — there is NO Coach-Home-specific backend.
 *
 * ⚠ Top safe-area inset is owned by the tab route (`app/(app)/(tabs)/index.tsx`,
 * which wraps both athlete + coach Home) — do NOT apply `insets.top` here (it
 * would double-offset). This mirrors <HomePresenter>, NOT <CoachYouPresenter>
 * (whose route wrapper doesn't own the inset).
 *
 * The `schedule` prop + <ScheduleHeroPresenter> are retained but never passed in
 * v1 (Brad decision #1 — no appointments backend). When the appointments spec
 * lands, the container passes a non-empty `schedule` and the hero renders here
 * unchanged.
 */

export type CoachHomePresenterProps = {
  /** Header date eyebrow, e.g. "MONDAY · MAR 25". */
  dateLabel: string;
  /** Header greeting, e.g. "Good morning". "Coach" is appended in trainer tone. */
  greeting: string;
  /** Header avatar initials. */
  initials: string;

  /** Whether the coach has ANY clients (drives the new-coach empty state). */
  hasClients: boolean;
  flaggedClients: FlaggedClientVM[];
  programmeAlerts: ProgrammeAlertVM[];
  /** "Train yourself" peek subtitle. */
  trainYourselfSubtitle: string;

  isLoading: boolean;
  isRefreshing: boolean;
  error?: ApiError | null;

  onRefresh: () => void;
  onOpenDrawer: () => void;
  onOpenNotifications: () => void;
  onOpenClient: (clientId: string) => void;
  onOpenClients: () => void;
  onTrainYourself: () => void;
  onInviteClient: () => void;

  // v1-DEFERRED — populated only once the appointments domain lands.
  schedule?: ScheduleItemVM[];
  onOpenAppointment?: (clientId: string) => void;
};

export function CoachHomePresenter(props: CoachHomePresenterProps) {
  const {
    dateLabel,
    greeting,
    initials,
    hasClients,
    flaggedClients,
    programmeAlerts,
    trainYourselfSubtitle,
    isLoading,
    isRefreshing,
    error,
    onRefresh,
    onOpenDrawer,
    onOpenNotifications,
    onOpenClient,
    onOpenClients,
    onTrainYourself,
    onInviteClient,
    schedule,
    onOpenAppointment,
  } = props;

  if (isLoading) {
    return (
      <View
        flex={1}
        alignItems="center"
        justifyContent="center"
        testID="coach-home-loader"
      >
        <PLogoDrawLoader />
      </View>
    );
  }
  if (error) {
    return (
      <View flex={1} testID="coach-home-error-state">
        <ErrorState
          message="Couldn't load your clients."
          onRetry={onRefresh}
          secondaryLabel="Switch to athlete mode"
          onSecondary={onTrainYourself}
        />
      </View>
    );
  }

  return (
    <View flex={1}>
      <ScrollView
        testID="coach-home-scroll"
        contentContainerStyle={{ paddingBottom: 140 }}
        refreshControl={
          <RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} />
        }
      >
        {/* Header. */}
        <View
          flexDirection="row"
          alignItems="center"
          justifyContent="space-between"
          paddingHorizontal={20}
          paddingTop={12}
          paddingBottom={16}
        >
          <View>
            <Text
              fontFamily="$display"
              fontSize={10.5}
              fontWeight="600"
              letterSpacing={1.7}
              textTransform="uppercase"
              color="$accentTrainer"
              marginBottom={4}
            >
              {dateLabel}
            </Text>
            <Text
              fontFamily="$display"
              fontWeight="800"
              fontSize={26}
              letterSpacing={-0.8}
              color="$text"
              numberOfLines={1}
            >
              {greeting}, <Text color="$accentTrainer">Coach</Text>
            </Text>
          </View>
          <View flexDirection="row" gap={8}>
            <IconBtn
              icon={<IconBell size={18} />}
              tone="ghost"
              onPress={onOpenNotifications}
              testID="coach-home-bell"
            />
            <Avatar
              initials={initials}
              size={36}
              tone="trainer"
              badge="COACH"
              onPress={onOpenDrawer}
              testID="coach-home-avatar"
            />
          </View>
        </View>

        <View paddingHorizontal={16} gap={16}>
          {/* v1-DEFERRED schedule hero — never rendered until appointments land. */}
          {schedule && schedule.length > 0 ? (
            <ScheduleHeroPresenter
              schedule={schedule}
              onOpenAppointment={onOpenAppointment ?? (() => {})}
              testID="coach-home-schedule"
            />
          ) : null}

          {hasClients ? (
            <>
              <FlaggedClientsPresenter
                clients={flaggedClients}
                onOpenClient={onOpenClient}
                onOpenClients={onOpenClients}
                testID="coach-home-flagged"
              />
              <ProgrammeAlertsPresenter
                alerts={programmeAlerts}
                onOpenClient={onOpenClient}
                testID="coach-home-alerts"
              />
            </>
          ) : (
            <Card
              pad={16}
              radius={16}
              accent="trainer"
              testID="coach-home-no-clients"
            >
              <Text
                fontFamily="$display"
                fontWeight="700"
                fontSize={17}
                color="$text"
              >
                Invite your first client
              </Text>
              <Text
                fontFamily="$body"
                fontSize={12}
                color="$text3"
                marginTop={4}
                marginBottom={12}
              >
                {
                  "Once clients join, you'll triage who needs you here each day."
                }
              </Text>
              <Btn
                variant="soft"
                tone="trainer"
                size="sm"
                onPress={onInviteClient}
                testID="coach-home-invite"
              >
                Add a client
              </Btn>
            </Card>
          )}

          <TrainYourselfCardPresenter
            subtitle={trainYourselfSubtitle}
            onTrainYourself={onTrainYourself}
            testID="coach-home-train"
          />
        </View>
      </ScrollView>
    </View>
  );
}
