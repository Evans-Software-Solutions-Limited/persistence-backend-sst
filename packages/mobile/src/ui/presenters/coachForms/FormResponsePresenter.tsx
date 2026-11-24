import { useState } from "react";
import { Pressable, ScrollView } from "react-native";
import { Text, View } from "@tamagui/core";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Btn } from "@/ui/components/foundation";
import { IconCheck, IconChevronD } from "@/ui/components/icons";
import type { CompareRow } from "@/domain/services/coachForms.service";
import { REPLY_MAX } from "@/domain/models/coachForms";
import {
  BackLink,
  FieldInput,
  FieldLabel,
  OfflineNote,
  StatusPill,
} from "./kit";

/**
 * Review a response (C3.3 on iPhone): each answer against any earlier
 * response of the same form ("vs {date} ▾"), Mark reviewed, and a reply.
 * Text replies only (no voice replies; BRIEF).
 */
export type FormResponsePresenterProps = {
  found: boolean;
  title: string;
  dateLabel: string;
  late: boolean;
  reviewedLabel: string | null;
  rows: CompareRow[];
  compareOptions: { id: string; label: string }[];
  compareId: string | null;
  onCompare: (id: string | null) => void;
  compareLabel: string | null;
  reply: string;
  onReply: (v: string) => void;
  existingReply: string | null;
  canMarkReviewed: boolean;
  onMarkReviewed: () => void;
  onSendReply: () => void;
  offline: boolean;
  onBack: () => void;
};

export function FormResponsePresenter(p: FormResponsePresenterProps) {
  const insets = useSafeAreaInsets();
  const [choosing, setChoosing] = useState(false);
  return (
    <View flex={1} paddingTop={insets.top} testID="form-response">
      <View paddingHorizontal={10} height={52} justifyContent="center">
        <BackLink
          label="Check-ins"
          onPress={p.onBack}
          testID="form-response-back"
        />
      </View>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 140 }}
        keyboardShouldPersistTaps="handled"
      >
        {!p.found ? (
          <Text
            fontFamily="$body"
            fontSize={14}
            color="$text3"
            testID="form-response-missing"
          >
            This check-in isn&apos;t on this phone yet.
          </Text>
        ) : (
          <>
            <View flexDirection="row" alignItems="center" gap={8}>
              <Text
                flex={1}
                fontFamily="$display"
                fontWeight="800"
                fontSize={24}
                lineHeight={30}
                letterSpacing={-0.5}
                color="$text"
                accessibilityRole="header"
              >
                {p.title}
              </Text>
              {p.reviewedLabel === null ? (
                <StatusPill
                  tone="review"
                  text="To review"
                  testID="form-response-to-review"
                />
              ) : null}
            </View>
            <Text fontFamily="$body" fontSize={13} color="$text3">
              {p.late ? `${p.dateLabel} · late` : p.dateLabel}
            </Text>
            {p.reviewedLabel ? (
              <Text
                fontFamily="$body"
                fontSize={12.5}
                color="$success"
                marginTop={4}
                testID="form-response-reviewed"
              >
                {p.reviewedLabel}
              </Text>
            ) : null}
            {p.offline ? <OfflineNote testID="form-response-offline" /> : null}

            <View
              flexDirection="row"
              alignItems="center"
              marginTop={16}
              paddingBottom={8}
              borderBottomWidth={1}
              borderBottomColor="$border2"
            >
              <Text
                flex={1.2}
                fontFamily="$body"
                fontWeight="600"
                fontSize={11}
                letterSpacing={1.4}
                textTransform="uppercase"
                color="$text3"
              >
                Question
              </Text>
              <Text
                flex={1}
                fontFamily="$body"
                fontWeight="600"
                fontSize={11}
                letterSpacing={1.4}
                textTransform="uppercase"
                color="$text3"
              >
                Latest
              </Text>
              {p.compareOptions.length > 0 ? (
                <Pressable
                  style={{ flex: 1 }}
                  onPress={() => setChoosing((v) => !v)}
                  accessibilityRole="button"
                  accessibilityLabel={`Compare with ${p.compareLabel ?? "nothing"}`}
                  testID="form-response-compare"
                >
                  <View flexDirection="row" alignItems="center" gap={4}>
                    <Text
                      fontFamily="$body"
                      fontWeight="600"
                      fontSize={12}
                      color="$accentTrainer"
                      numberOfLines={1}
                    >
                      {p.compareLabel ? `vs ${p.compareLabel}` : "Compare"}
                    </Text>
                    <IconChevronD size={14} color="#A78BFA" />
                  </View>
                </Pressable>
              ) : null}
            </View>
            {choosing ? (
              <View paddingVertical={4} testID="form-response-compare-options">
                {[{ id: "", label: "No comparison" }, ...p.compareOptions].map(
                  (o) => {
                    const on = (p.compareId ?? "") === o.id;
                    return (
                      <Pressable
                        key={o.id || "none"}
                        onPress={() => {
                          p.onCompare(o.id || null);
                          setChoosing(false);
                        }}
                        accessibilityRole="radio"
                        accessibilityState={{ selected: on }}
                        testID={`form-response-compare-${o.id || "none"}`}
                      >
                        <View
                          flexDirection="row"
                          alignItems="center"
                          paddingVertical={9}
                          gap={8}
                        >
                          <Text
                            flex={1}
                            fontFamily="$body"
                            fontSize={14}
                            color={on ? "$accentTrainerBright" : "$text"}
                          >
                            {o.label}
                          </Text>
                          {on ? <IconCheck size={14} color="#A78BFA" /> : null}
                        </View>
                      </Pressable>
                    );
                  },
                )}
              </View>
            ) : null}
            {p.rows.map((r) => (
              <View
                key={r.id}
                flexDirection="row"
                alignItems="flex-start"
                gap={8}
                paddingVertical={10}
                borderBottomWidth={1}
                borderBottomColor="$border"
                testID={`form-response-row-${r.id}`}
              >
                <Text
                  flex={1.2}
                  fontFamily="$body"
                  fontSize={13}
                  color="$text2"
                >
                  {r.prompt}
                </Text>
                <Text
                  flex={1}
                  fontFamily="$body"
                  fontWeight="600"
                  fontSize={13}
                  color="$text"
                >
                  {r.arrow ? `${r.latest} ${r.arrow}` : r.latest}
                </Text>
                {p.compareOptions.length > 0 ? (
                  <Text
                    flex={1}
                    fontFamily="$body"
                    fontSize={13}
                    color="$text3"
                  >
                    {r.previous ?? ""}
                  </Text>
                ) : null}
              </View>
            ))}

            {p.existingReply ? (
              <View
                marginTop={16}
                padding={12}
                borderRadius={12}
                backgroundColor="$surface2"
                testID="form-response-existing-reply"
              >
                <Text
                  fontFamily="$body"
                  fontWeight="600"
                  fontSize={12}
                  color="$text3"
                >
                  You replied
                </Text>
                <Text
                  fontFamily="$body"
                  fontSize={14}
                  color="$text"
                  marginTop={4}
                >
                  {p.existingReply}
                </Text>
              </View>
            ) : null}
            <FieldLabel>Review and reply</FieldLabel>
            <FieldInput
              value={p.reply}
              onChangeText={p.onReply}
              placeholder="Write a reply"
              accessibilityLabel="Reply"
              multiline
              maxLength={REPLY_MAX}
              testID="form-response-reply"
            />
            <View flexDirection="row" gap={8} marginTop={12}>
              <View flex={1}>
                <Btn
                  variant="outline"
                  tone="trainer"
                  full
                  disabled={!p.canMarkReviewed}
                  onPress={p.onMarkReviewed}
                  testID="form-response-mark"
                >
                  Mark reviewed
                </Btn>
              </View>
              <View flex={1}>
                <Btn
                  variant="filled"
                  tone="trainer"
                  full
                  disabled={p.reply.trim().length === 0}
                  onPress={p.onSendReply}
                  testID="form-response-send"
                >
                  Send reply
                </Btn>
              </View>
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );
}
