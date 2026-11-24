import { Text, View } from "@tamagui/core";

import { Btn } from "@/ui/components/foundation";
import { IconCheck, IconClipboard } from "@/ui/components/icons";
import type {
  HistoryRow,
  SentToRow,
} from "@/domain/services/coachForms.service";
import { PLogoDrawLoader } from "@/ui/components";
import { EyebrowHead, ListRow, OfflineNote, StatusPill } from "./kit";

/**
 * C3.3b — iPhone Check-ins: the latest response first (a "New · {date}" card
 * with a summary and Review), History with review state, then "Sent to
 * {name}" with last-done pills ("+ Add" sends another form).
 */
export type LatestCard = {
  responseId: string;
  eyebrow: string;
  title: string;
  summary: string;
};

export type CheckInsTabPresenterProps = {
  firstName: string;
  isLoading: boolean;
  offline: boolean;
  latest: LatestCard | null;
  history: HistoryRow[];
  sentTo: SentToRow[];
  onReview: (responseId: string) => void;
  onOpenForm: (formId: string) => void;
  onAddForm: () => void;
};

export function CheckInsTabPresenter(p: CheckInsTabPresenterProps) {
  if (p.isLoading) {
    return (
      <View paddingVertical={40} alignItems="center" testID="checkins-loader">
        <PLogoDrawLoader />
      </View>
    );
  }
  return (
    <View paddingHorizontal={20} testID="checkins-tab">
      {p.offline ? <OfflineNote testID="checkins-offline" /> : null}
      {p.latest ? (
        <View
          paddingVertical={12}
          borderBottomWidth={1}
          borderBottomColor="$border2"
          flexDirection="row"
          alignItems="center"
          gap={10}
          testID="checkins-latest"
        >
          <View flex={1}>
            <Text
              fontFamily="$body"
              fontWeight="600"
              fontSize={10}
              lineHeight={14}
              letterSpacing={2.6}
              textTransform="uppercase"
              color="$accentTrainer"
            >
              {p.latest.eyebrow}
            </Text>
            <Text
              fontFamily="$body"
              fontWeight="700"
              fontSize={16}
              color="$text"
            >
              {p.latest.title}
            </Text>
            <Text
              fontFamily="$body"
              fontSize={12}
              color="$text3"
              testID="checkins-latest-summary"
            >
              {p.latest.summary}
            </Text>
          </View>
          <Btn
            variant="filled"
            tone="trainer"
            size="sm"
            onPress={() => p.onReview(p.latest!.responseId)}
            testID="checkins-review"
          >
            Review
          </Btn>
        </View>
      ) : null}

      <View marginTop={p.latest ? 0 : 12}>
        <EyebrowHead title="History" testID="checkins-history-head" />
        {p.history.length === 0 ? (
          <Text
            fontFamily="$body"
            fontSize={12.5}
            color="$text3"
            paddingBottom={12}
            testID="checkins-history-empty"
          >
            No check-ins yet.
          </Text>
        ) : (
          p.history.map((h) => (
            <ListRow
              key={h.id}
              leading={
                h.toReview ? (
                  <IconClipboard size={18} color="#A78BFA" />
                ) : (
                  <IconCheck size={18} color="#8A8A98" />
                )
              }
              title={h.title}
              subtitle={h.subtitle}
              right={
                h.toReview ? (
                  <StatusPill tone="review" text="To review" />
                ) : null
              }
              onPress={() => p.onReview(h.id)}
              testID={`checkins-history-${h.id}`}
            />
          ))
        )}
      </View>

      <View marginTop={10}>
        <EyebrowHead
          title={`Sent to ${p.firstName}`}
          onAdd={p.onAddForm}
          addLabel={`Send a form to ${p.firstName}`}
          testID="checkins-sentto-head"
        />
        {p.sentTo.length === 0 ? (
          <Text
            fontFamily="$body"
            fontSize={12.5}
            color="$text3"
            paddingBottom={12}
            testID="checkins-sentto-empty"
          >
            No forms sent yet.
          </Text>
        ) : (
          p.sentTo.map((f) => (
            <ListRow
              key={f.formId}
              leading={<IconClipboard size={18} color="#8A8A98" />}
              title={f.title}
              subtitle={f.subtitle}
              right={<StatusPill tone={f.pill.tone} text={f.pill.text} />}
              onPress={() => p.onOpenForm(f.formId)}
              accessibilityLabel={`${f.title}, ${f.pill.text}. Set it up for ${p.firstName}`}
              testID={`checkins-sentto-${f.formId}`}
            />
          ))
        )}
      </View>
    </View>
  );
}
