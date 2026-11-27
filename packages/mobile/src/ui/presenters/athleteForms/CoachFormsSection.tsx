import { Text, View } from "@tamagui/core";

import { Btn } from "@/ui/components/foundation/Btn";
import {
  IconCheck,
  IconClipboard,
  IconClock,
  IconWifiOff,
} from "@/ui/components/icons";
import type {
  DoneRow,
  DueTone,
  FormCard,
} from "@/domain/services/athleteForms.service";

/**
 * PER-130: the forms part of the athlete's Coach tab. C10p: "To fill in"
 * leads the tab, one card per form with its due line and Fill in; then
 * "Done". C10r: late forms in amber, the offline note, and forms waiting to
 * send. Values from the boards' inline styles, in the app's tokens.
 */

export type CoachFormsSectionProps = {
  toFill: readonly FormCard[];
  done: readonly DoneRow[];
  /** C10r offline note, or null when online. */
  offlineNote: string | null;
  onOpen(requestId: string): void;
};

const DUE_COLOUR: Record<DueTone, string> = {
  due: "$accentTrainer",
  none: "$text3",
  late: "$warning",
};

function SectionTitle(p: { title: string; count?: number; rule?: boolean }) {
  return (
    <View
      flexDirection="row"
      alignItems="baseline"
      gap={8}
      marginTop={p.rule ? 8 : 18}
      paddingTop={p.rule ? 12 : 0}
      borderTopWidth={p.rule ? 1 : 0}
      borderTopColor="$border2"
      marginBottom={p.rule ? 0 : 10}
    >
      <Text
        flex={1}
        fontFamily="$body"
        fontWeight="600"
        fontSize={14.5}
        lineHeight={20}
        color="$text"
        accessibilityRole="header"
      >
        {p.title}
      </Text>
      {p.count !== undefined ? (
        <Text fontFamily="$mono" fontSize={12} color="$text3">
          {String(p.count)}
        </Text>
      ) : null}
    </View>
  );
}

function Card(p: { card: FormCard; first: boolean; onOpen(): void }) {
  const late = p.card.due.tone === "late";
  return (
    <View
      flexDirection="row"
      alignItems="center"
      gap={12}
      paddingVertical={14}
      borderTopWidth={p.first ? 1 : 0}
      borderBottomWidth={1}
      borderColor="rgba(255,255,255,0.08)"
      testID={`coach-form-card-${p.card.requestId}`}
    >
      {late ? (
        <IconClock size={20} color="#FBBF24" />
      ) : (
        <IconClipboard size={20} color="#A78BFA" />
      )}
      <View flex={1} minWidth={0}>
        <Text
          fontFamily="$body"
          fontWeight="600"
          fontSize={12.5}
          color={DUE_COLOUR[p.card.due.tone]}
        >
          {p.card.due.text}
        </Text>
        <Text
          fontFamily="$body"
          fontWeight="700"
          fontSize={17}
          lineHeight={22}
          color="$text"
        >
          {p.card.title}
        </Text>
        <Text fontFamily="$body" fontSize={12} color="$text3">
          {p.card.detail}
        </Text>
      </View>
      <Btn
        variant="filled"
        tone="trainer"
        size="sm"
        onPress={p.onOpen}
        accessibilityLabel={`Fill in ${p.card.title}`}
        testID={`coach-form-fill-${p.card.requestId}`}
      >
        Fill in
      </Btn>
    </View>
  );
}

function Done(p: { row: DoneRow }) {
  return (
    <View
      flexDirection="row"
      alignItems="center"
      gap={12}
      paddingVertical={12}
      borderBottomWidth={1}
      borderBottomColor="$border"
      testID={`coach-form-done-${p.row.requestId}`}
    >
      {p.row.waiting ? (
        <IconClock size={18} color="#8A8A98" />
      ) : (
        <IconCheck size={18} color={p.row.closed ? "#8A8A98" : "#34D399"} />
      )}
      <View flex={1} minWidth={0} gap={2}>
        <Text
          fontFamily="$body"
          fontWeight="500"
          fontSize={15}
          lineHeight={20}
          color="$text"
          numberOfLines={1}
        >
          {p.row.title}
        </Text>
        <Text fontFamily="$body" fontSize={12} lineHeight={16} color="$text3">
          {p.row.subtitle}
        </Text>
      </View>
      {p.row.waiting ? (
        <View
          height={22}
          paddingHorizontal={8}
          borderRadius={9999}
          backgroundColor="rgba(255,255,255,0.06)"
          alignItems="center"
          justifyContent="center"
        >
          <Text
            fontFamily="$body"
            fontWeight="600"
            fontSize={11}
            color="$text2"
          >
            Waiting
          </Text>
        </View>
      ) : null}
    </View>
  );
}

export function CoachFormsSection(p: CoachFormsSectionProps) {
  return (
    <View testID="coach-forms">
      {p.offlineNote ? (
        <View
          flexDirection="row"
          alignItems="center"
          gap={10}
          paddingVertical={10}
          paddingHorizontal={12}
          marginTop={14}
          borderRadius={12}
          backgroundColor="rgba(255,255,255,0.04)"
          accessibilityRole="alert"
          testID="coach-forms-offline"
        >
          <IconWifiOff size={16} color="#C2C2CE" />
          <Text
            flex={1}
            fontFamily="$body"
            fontSize={12.5}
            lineHeight={17}
            color="$text2"
          >
            {p.offlineNote}
          </Text>
        </View>
      ) : null}

      {p.toFill.length > 0 ? (
        <View testID="coach-forms-to-fill">
          <SectionTitle title="To fill in" count={p.toFill.length} />
          {p.toFill.map((card, i) => (
            <Card
              key={card.requestId}
              card={card}
              first={i === 0}
              onOpen={() => p.onOpen(card.requestId)}
            />
          ))}
        </View>
      ) : null}

      {p.done.length > 0 ? (
        <View testID="coach-forms-done">
          <SectionTitle title="Done" rule />
          {p.done.map((row) => (
            <Done key={row.requestId} row={row} />
          ))}
        </View>
      ) : null}
    </View>
  );
}
