import { Text, View } from "@tamagui/core";
import { Btn, Card } from "@/ui/components/foundation";
import { IconPlus } from "@/ui/components/icons";
import type { CoachBusinessStats } from "@/domain/models/coachOverview";

/**
 * <BusinessStatsPresenter> — Coach You "YOUR BUSINESS / This month" section.
 * Ports the prototype's `BusinessStats` (design-source/screens/coach.jsx:
 * 86-133): a header (YOUR BUSINESS eyebrow + "This month" + the current month
 * on the right) over a 2×2 grid of stat cards — Active clients, Avg adherence,
 * Client PRs, Retention.
 *
 * THE ONE AUTHORIZED DEVIATION from the drawn prototype: an "Invite" button
 * (trainer tone, IconPlus) sits in the header's action slot, replacing the
 * static month label's right side — slot availability already shows in the
 * Active-clients card, so this is where inviting a client belongs.
 *
 * Null-safe: `slotsTotal` / `avgAdherence` / `retentionPct` can be null
 * (no tier limit / no assignments / no retention denominator) and render an
 * em-dash placeholder for the metric and drop the sub-caption.
 *
 * Exported separately so Coach Home can reuse it later.
 */

export type BusinessStatsPresenterProps = {
  stats: CoachBusinessStats;
  /** Current-month label, e.g. "March". */
  monthLabel: string;
  onInvite: () => void;
  testID?: string;
};

const EM_DASH = "—";

function StatCard({
  eyebrow,
  value,
  valueColor,
  suffix,
  badge,
  badgeColor,
  caption,
  testID,
}: {
  eyebrow: string;
  value: string;
  valueColor: string;
  suffix?: string;
  badge?: string;
  badgeColor?: string;
  caption?: string;
  testID?: string;
}) {
  return (
    <Card pad={14} radius={14} testID={testID} style={{ flex: 1 }}>
      <Text
        fontFamily="$display"
        fontSize={10.5}
        fontWeight="600"
        letterSpacing={1.7}
        textTransform="uppercase"
        color="$text3"
      >
        {eyebrow}
      </Text>
      <View flexDirection="row" alignItems="baseline" gap={6} marginTop={4}>
        <Text
          fontFamily="$mono"
          fontWeight="700"
          fontSize={28}
          letterSpacing={-1}
          color={valueColor}
        >
          {value}
          {suffix ? (
            <Text fontFamily="$mono" fontSize={14} color={valueColor}>
              {suffix}
            </Text>
          ) : null}
        </Text>
        {badge ? (
          <Text fontFamily="$mono" fontSize={11} color={badgeColor ?? "$text3"}>
            {badge}
          </Text>
        ) : null}
      </View>
      {caption ? (
        <Text fontFamily="$body" fontSize={11} color="$text3" marginTop={4}>
          {caption}
        </Text>
      ) : null}
    </Card>
  );
}

export function BusinessStatsPresenter({
  stats,
  monthLabel,
  onInvite,
  testID,
}: BusinessStatsPresenterProps) {
  const {
    activeClients,
    newClientsThisMonth,
    slotsTotal,
    slotsOpen,
    avgAdherence,
    adherenceDelta,
    clientPRsThisMonth,
    clientsWithPRs,
    retentionPct,
    churnThisQuarter,
  } = stats;

  const slotsCaption =
    slotsTotal !== null && slotsOpen !== null
      ? `${slotsOpen} of ${slotsTotal} slots open`
      : undefined;

  const adherenceDeltaBadge =
    adherenceDelta !== null && adherenceDelta !== 0
      ? `${adherenceDelta > 0 ? "▲" : "▼"} ${Math.abs(adherenceDelta)}`
      : undefined;

  return (
    <View testID={testID}>
      {/* Section header with the invite affordance (the authorized deviation). */}
      <View
        flexDirection="row"
        alignItems="flex-end"
        justifyContent="space-between"
        paddingHorizontal={2}
        marginBottom={10}
      >
        <View>
          <Text
            fontFamily="$display"
            fontSize={10.5}
            fontWeight="600"
            letterSpacing={1.7}
            textTransform="uppercase"
            color="$text3"
          >
            Your business
          </Text>
          <Text
            fontFamily="$display"
            fontWeight="700"
            fontSize={24}
            letterSpacing={-0.5}
            color="$text"
          >
            This month
          </Text>
        </View>
        <Btn
          variant="soft"
          tone="trainer"
          size="sm"
          icon={<IconPlus size={14} strokeWidth={2.2} />}
          onPress={onInvite}
          accessibilityLabel="Invite client"
          testID="coach-invite-btn"
        >
          Invite
        </Btn>
      </View>

      {/* 2×2 stat grid. */}
      <View gap={10}>
        <View flexDirection="row" gap={10}>
          <StatCard
            testID="coach-stat-active-clients"
            eyebrow="Active clients"
            value={String(activeClients)}
            valueColor="$accentTrainer"
            badge={
              newClientsThisMonth > 0 ? `+${newClientsThisMonth}` : undefined
            }
            badgeColor="$success"
            caption={slotsCaption}
          />
          <StatCard
            testID="coach-stat-adherence"
            eyebrow="Avg adherence"
            value={avgAdherence !== null ? String(avgAdherence) : EM_DASH}
            valueColor="$success"
            suffix={avgAdherence !== null ? "%" : undefined}
            badge={adherenceDeltaBadge}
            badgeColor="$success"
            caption={
              adherenceDelta !== null && avgAdherence !== null
                ? `${adherenceDelta >= 0 ? "up" : "down"} from ${
                    avgAdherence - adherenceDelta
                  }% last mo`
                : undefined
            }
          />
        </View>
        <View flexDirection="row" gap={10}>
          <StatCard
            testID="coach-stat-prs"
            eyebrow="Client PRs"
            value={String(clientPRsThisMonth)}
            valueColor="$gold"
            badge="this mo"
            caption={
              clientsWithPRs > 0
                ? `across ${clientsWithPRs} clients`
                : undefined
            }
          />
          <StatCard
            testID="coach-stat-retention"
            eyebrow="Retention"
            value={retentionPct !== null ? String(retentionPct) : EM_DASH}
            valueColor="$text"
            suffix={retentionPct !== null ? "%" : undefined}
            badge="90d"
            caption={
              churnThisQuarter > 0
                ? `${churnThisQuarter} churn this Q`
                : undefined
            }
          />
        </View>
      </View>
    </View>
  );
}
