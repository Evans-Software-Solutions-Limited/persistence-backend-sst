import { Text, View } from "@tamagui/core";
import type { ReactNode } from "react";
import { Card } from "@/ui/components/foundation";
import { toneHex, type Tone } from "@/ui/components/foundation/tones";
import { IconCheck, IconMedal, IconX } from "@/ui/components/icons";
import type { RecentActivityEvent } from "@/domain/models/coachOverview";

/**
 * <RecentActivityFeedPresenter> — Coach You "Recent" feed.
 * Ports the prototype's `RecentActivity` (design-source/screens/coach.jsx:
 * 256-281): a "Recent" header over a Card list, one row per event with a
 * toned icon tile, a sentence (bold client name + action), and a relative
 * time stamp on the right.
 *
 * The backend emits three event types (session_completed | pr_achieved |
 * missed_day); each maps to the prototype's icon + tone:
 *   pr_achieved      → medal / gold
 *   session_completed→ check / success
 *   missed_day       → x / ember
 *
 * Empty feed → a placeholder row ("No recent activity").
 *
 * Exported separately so Coach Home can reuse it later.
 */

export type RecentActivityFeedPresenterProps = {
  events: RecentActivityEvent[];
  /** Inject a clock for deterministic relative-time tests. Defaults to now. */
  now?: number;
  testID?: string;
};

type EventVisual = {
  icon: ReactNode;
  tone: Tone;
  /** Sentence fragment AFTER the bold client name. */
  text: string;
};

/** Map a backend event to the prototype's icon + tone + copy. */
export function eventVisual(event: RecentActivityEvent): EventVisual {
  switch (event.type) {
    case "pr_achieved": {
      const recordType =
        typeof event.payload.recordType === "string"
          ? event.payload.recordType
          : null;
      return {
        icon: <IconMedal size={14} color={toneHex("gold").base} />,
        tone: "gold",
        text: recordType
          ? `hit a new ${recordType} PR`
          : "hit a new personal record",
      };
    }
    case "session_completed": {
      const name =
        typeof event.payload.sessionName === "string"
          ? event.payload.sessionName
          : null;
      return {
        icon: <IconCheck size={14} color={toneHex("success").base} />,
        tone: "success",
        text: name ? `completed ${name}` : "completed a session",
      };
    }
    case "missed_day":
    default:
      return {
        icon: <IconX size={14} color={toneHex("ember").base} />,
        tone: "ember",
        text: "missed a scheduled session",
      };
  }
}

/** Relative-time short label (e.g. "15m", "2h", "1d"). Exported pure for tests. */
export function relativeTime(occurredAt: string, now: number): string {
  const ts = new Date(occurredAt).getTime();
  if (Number.isNaN(ts)) return "";
  const diffMs = Math.max(0, now - ts);
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

export function RecentActivityFeedPresenter({
  events,
  now = Date.now(),
  testID,
}: RecentActivityFeedPresenterProps) {
  return (
    <View testID={testID}>
      <View paddingHorizontal={2} marginBottom={10}>
        <Text
          fontFamily="$display"
          fontWeight="700"
          fontSize={24}
          letterSpacing={-0.5}
          color="$text"
        >
          Recent
        </Text>
      </View>

      <Card pad={0} radius={14}>
        {events.length === 0 ? (
          <View padding={14} testID="coach-activity-empty">
            <Text fontFamily="$body" fontSize={13} color="$text3">
              No recent activity
            </Text>
          </View>
        ) : (
          events.map((event, i) => {
            const visual = eventVisual(event);
            const tileBg = toneHex(visual.tone).dim;
            return (
              <View
                key={`${event.type}-${event.clientId}-${event.occurredAt}-${i}`}
                flexDirection="row"
                alignItems="flex-start"
                gap={10}
                padding={11}
                paddingHorizontal={14}
                borderTopWidth={i ? 1 : 0}
                borderColor="$border"
              >
                <View
                  width={28}
                  height={28}
                  borderRadius={8}
                  alignItems="center"
                  justifyContent="center"
                  style={{ backgroundColor: tileBg, flexBasis: 28 }}
                >
                  {visual.icon}
                </View>
                <Text
                  flex={1}
                  color="$text2"
                  fontSize={12.5}
                  lineHeight={18}
                  fontFamily="$body"
                >
                  <Text fontWeight="700" color="$text">
                    {event.clientName || "A client"}
                  </Text>{" "}
                  {visual.text}
                </Text>
                <Text fontFamily="$mono" fontSize={10.5} color="$text3">
                  {relativeTime(event.occurredAt, now)}
                </Text>
              </View>
            );
          })
        )}
      </Card>
    </View>
  );
}
