import { Text, View } from "@tamagui/core";
import { Pressable } from "react-native";
import { Avatar } from "@/ui/components/foundation/Avatar";
import { Bar } from "@/ui/components/foundation/Bar";
import { Btn } from "@/ui/components/foundation/Btn";
import { Pill } from "@/ui/components/foundation/Pill";
import { toneHex } from "@/ui/components/foundation/tones";
import { IconChevronR, iconDefaults } from "@/ui/components/icons";
import type { TrainerClient } from "@/domain/models/trainerClient";
import { relativeTime } from "@/ui/presenters/coach/RecentActivityFeedPresenter";
import { BAND_DISPLAY } from "./clientBand";

/**
 * <ClientRow> — a single roster row. Ports the prototype `ClientRowV2`
 * (design-source/screens/coach.jsx:506-538) 1:1: trainer-toned Avatar + name +
 * optional flag pill(s) + "{programLabel · }{lastSeen} ago" subtitle +
 * adherence Bar (tone by band) + "{adh}% · {bandLabel}" caption + chevron.
 *
 * v1 fidelity: `programLabel` is always null (Programs slice not built), so the
 * subtitle renders just "{lastSeen} ago". When `adherence` is null (client has
 * no in-window assignments) the bar + caption are omitted entirely.
 *
 * Coach Mode Phase 8 (invite/QR) — net-new: a `pending` row can be CLIENT-
 * initiated (the athlete redeemed THIS coach's invite code and is awaiting
 * the coach's accept/decline). Core render is UNCHANGED for every other row;
 * a client-initiated pending row additionally gets an "Awaiting your OK"
 * pill + an Accept/Decline button pair (reuses `RequestsPresenter`'s
 * accept/decline shape). Both buttons nest inside this row's outer
 * `Pressable` — standard RN touch-responder negotiation means pressing a
 * button fires ONLY its own `onPress`, never bubbling to the row's
 * navigate-to-detail handler.
 */

const TABULAR: ["tabular-nums"] = ["tabular-nums"];

export type ClientRowProps = {
  client: TrainerClient;
  isLast?: boolean;
  onPress: (id: string) => void;
  /** Injected clock for deterministic relative-time tests. Defaults to now. */
  now?: number;
  testID?: string;
  /**
   * Accept a client-initiated pending row (Phase 8). Omit to render the row
   * with no accept/decline affordance regardless of status (e.g. the client
   * side of the app never wires these).
   */
  onAccept?: (relationshipId: string) => void;
  /** Decline a client-initiated pending row (Phase 8). */
  onDecline?: (relationshipId: string) => void;
  /** True while THIS row's accept/decline call is in flight — disables both buttons. */
  busy?: boolean;
};

/** "{programLabel · }{lastSeen} ago" — omits the programLabel segment when null. */
export function buildClientSubtitle(
  client: TrainerClient,
  now: number,
): string {
  const seen = client.lastSeenAt
    ? `${relativeTime(client.lastSeenAt, now)} ago`
    : "No sessions yet";
  if (client.programLabel) return `${client.programLabel} · ${seen}`;
  return seen;
}

export function ClientRow({
  client,
  isLast = false,
  onPress,
  now = Date.now(),
  testID,
  onAccept,
  onDecline,
  busy = false,
}: ClientRowProps) {
  const display = client.band ? BAND_DISPLAY[client.band] : null;
  const subtitle = buildClientSubtitle(client, now);
  const needsCoachAccept =
    client.status === "pending" &&
    client.initiatedBy === "client" &&
    client.relationshipId != null &&
    onAccept != null &&
    onDecline != null;

  return (
    <Pressable
      testID={testID}
      onPress={() => onPress(client.id)}
      accessibilityRole="button"
      accessibilityLabel={client.name}
      style={({ pressed }) => ({ opacity: pressed ? 0.8 : 1 })}
    >
      <View
        flexDirection="row"
        alignItems="center"
        gap={12}
        paddingVertical={12}
        paddingHorizontal={14}
        borderBottomWidth={isLast ? 0 : 1}
        borderColor="$border"
        minHeight={44}
      >
        <Avatar initials={client.initials} size={40} tone="trainer" />

        <View flex={1} minWidth={0}>
          <View
            flexDirection="row"
            alignItems="center"
            gap={6}
            marginBottom={2}
            flexWrap="wrap"
          >
            <Text
              fontFamily="$display"
              fontWeight="600"
              fontSize={20}
              color="$text"
              numberOfLines={1}
            >
              {client.name}
            </Text>
            {client.flags.map((flag, i) => (
              <Pill key={`${flag.label}-${i}`} tone={flag.tone} size="xs">
                {flag.label}
              </Pill>
            ))}
            {needsCoachAccept ? (
              <Pill tone="trainer" size="xs">
                Awaiting your OK
              </Pill>
            ) : null}
          </View>

          <Text
            fontFamily="$body"
            fontSize={11}
            color="$text3"
            numberOfLines={1}
          >
            {subtitle}
          </Text>

          {needsCoachAccept ? (
            <View flexDirection="row" gap={8} marginTop={8}>
              <View flex={1}>
                <Btn
                  variant="filled"
                  tone="trainer"
                  size="sm"
                  full
                  disabled={busy}
                  onPress={() => onAccept!(client.relationshipId!)}
                  testID={testID ? `${testID}-accept` : undefined}
                >
                  Accept
                </Btn>
              </View>
              <View flex={1}>
                <Btn
                  variant="ghost"
                  tone="error"
                  size="sm"
                  full
                  disabled={busy}
                  onPress={() => onDecline!(client.relationshipId!)}
                  testID={testID ? `${testID}-decline` : undefined}
                >
                  Decline
                </Btn>
              </View>
            </View>
          ) : null}

          {client.adherence !== null && display !== null ? (
            <View flexDirection="row" alignItems="center" gap={8} marginTop={8}>
              <View flex={1}>
                <Bar
                  pct={client.adherence / 100}
                  color={toneHex(display.tone).base}
                  height={4}
                  accessibilityLabel={`${client.name} adherence ${client.adherence}%`}
                />
              </View>
              <Text
                fontFamily="$mono"
                fontSize={10.5}
                fontWeight="600"
                color={toneHex(display.tone).base}
                fontVariant={TABULAR}
              >
                {`${client.adherence}% · ${display.label}`}
              </Text>
            </View>
          ) : null}
        </View>

        <IconChevronR {...iconDefaults({ size: 14 })} color="#8A8A98" />
      </View>
    </Pressable>
  );
}
