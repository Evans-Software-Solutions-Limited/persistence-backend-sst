import { RefreshControl, ScrollView } from "react-native";
import { Text, View } from "@tamagui/core";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Btn } from "@/ui/components/foundation";
import {
  BackLink,
  EditedElsewhere,
  EyebrowHead,
  ListRow,
  OfflineNote,
  StatusPill,
  type PillTone,
} from "./kit";

/**
 * The form page behind C10h (back "Forms", title, "N questions"): Send,
 * Edit questions, its send rules (tap one to change it) and who still owes
 * it this round. The web's C10a side panel, one column.
 */
export type FormPageRule = { id: string; title: string; subtitle: string };
export type FormPageClient = {
  key: string;
  name: string;
  detail: string;
  pill: { tone: PillTone; text: string };
};

export type FormPagePresenterProps = {
  title: string;
  subtitle: string;
  rules: FormPageRule[];
  outstanding: FormPageClient[];
  found: boolean;
  offline: boolean;
  conflict: boolean;
  isRefreshing: boolean;
  onRefresh: () => void;
  onDismissConflict: () => void;
  onBack: () => void;
  onSend: () => void;
  onEdit: () => void;
  onOpenRule: (scheduleId: string) => void;
};

export function FormPagePresenter(p: FormPagePresenterProps) {
  const insets = useSafeAreaInsets();
  return (
    <View flex={1} paddingTop={insets.top} testID="form-page">
      <View paddingHorizontal={10} height={52} justifyContent="center">
        <BackLink label="Forms" onPress={p.onBack} testID="form-page-back" />
      </View>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 120 }}
        refreshControl={
          <RefreshControl refreshing={p.isRefreshing} onRefresh={p.onRefresh} />
        }
      >
        {!p.found ? (
          <Text
            fontFamily="$body"
            fontSize={14}
            color="$text3"
            testID="form-page-missing"
          >
            This form isn&apos;t in your library.
          </Text>
        ) : (
          <>
            <Text
              fontFamily="$display"
              fontWeight="800"
              fontSize={26}
              lineHeight={32}
              letterSpacing={-0.6}
              color="$text"
              accessibilityRole="header"
              testID="form-page-title"
            >
              {p.title}
            </Text>
            <Text fontFamily="$body" fontSize={13} color="$text3">
              {p.subtitle}
            </Text>
            {p.conflict ? (
              <EditedElsewhere
                onDismiss={p.onDismissConflict}
                testID="form-page-conflict"
              />
            ) : null}
            {p.offline ? <OfflineNote /> : null}
            <View flexDirection="row" gap={8} marginTop={16}>
              <View flex={1}>
                <Btn
                  variant="filled"
                  tone="trainer"
                  full
                  onPress={p.onSend}
                  testID="form-page-send"
                >
                  Send to clients
                </Btn>
              </View>
              <View flex={1}>
                <Btn
                  variant="outline"
                  tone="trainer"
                  full
                  onPress={p.onEdit}
                  testID="form-page-edit"
                >
                  Edit questions
                </Btn>
              </View>
            </View>

            <View marginTop={22}>
              <EyebrowHead title="Schedule" />
              {p.rules.length === 0 ? (
                <Text
                  fontFamily="$body"
                  fontSize={12.5}
                  color="$text3"
                  testID="form-page-no-rules"
                >
                  Not sent yet.
                </Text>
              ) : (
                p.rules.map((r) => (
                  <ListRow
                    key={r.id}
                    title={r.title}
                    subtitle={r.subtitle}
                    onPress={() => p.onOpenRule(r.id)}
                    accessibilityLabel={`Change ${r.title}`}
                    testID={`form-page-rule-${r.id}`}
                  />
                ))
              )}
            </View>

            {p.outstanding.length > 0 ? (
              <View marginTop={22}>
                <EyebrowHead title="This round" />
                {p.outstanding.map((c) => (
                  <ListRow
                    key={c.key}
                    title={c.name}
                    subtitle={c.detail}
                    right={<StatusPill tone={c.pill.tone} text={c.pill.text} />}
                    testID={`form-page-client-${c.key}`}
                  />
                ))}
              </View>
            ) : null}
          </>
        )}
      </ScrollView>
    </View>
  );
}
