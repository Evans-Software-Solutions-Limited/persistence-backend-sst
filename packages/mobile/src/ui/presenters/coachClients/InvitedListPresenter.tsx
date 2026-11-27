import { Pressable } from "react-native";
import { Text, View } from "@tamagui/core";

import { IconChevronR } from "@/ui/components/icons";
import { Card } from "@/ui/components/foundation";
import { Eyebrow } from "@/ui/presenters/coaching/coachingKit";

/**
 * PER-125: the Clients list's Invited section, above the roster (canvas
 * C11e, one column). A row opens the invited client (C11i).
 */
export type InvitedListRow = {
  id: string;
  name: string;
  initials: string;
  line: string;
};

export function InvitedListPresenter(p: {
  rows: readonly InvitedListRow[];
  onOpen: (profileId: string) => void;
}) {
  if (p.rows.length === 0) return null;
  return (
    <View gap={8} testID="invited-section">
      <Eyebrow>{`Invited · ${p.rows.length}`}</Eyebrow>
      <Card pad={0} radius={14}>
        {p.rows.map((r, i) => (
          <Pressable
            key={r.id}
            onPress={() => p.onOpen(r.id)}
            accessibilityRole="button"
            accessibilityLabel={`${r.name}, invited`}
            testID={`invited-list-row-${r.id}`}
          >
            <View
              flexDirection="row"
              alignItems="center"
              gap={12}
              paddingHorizontal={14}
              paddingVertical={12}
              borderBottomWidth={i === p.rows.length - 1 ? 0 : 1}
              borderBottomColor="$border"
            >
              <View
                width={36}
                height={36}
                borderRadius={9999}
                backgroundColor="rgba(244,114,182,0.14)"
                alignItems="center"
                justifyContent="center"
              >
                <Text
                  fontFamily="$body"
                  fontWeight="700"
                  fontSize={12}
                  color="#F9A8D4"
                >
                  {r.initials}
                </Text>
              </View>
              <View flex={1} minWidth={0} gap={2}>
                <Text
                  fontFamily="$body"
                  fontWeight="600"
                  fontSize={15}
                  color="$text"
                  numberOfLines={1}
                >
                  {r.name}
                </Text>
                <Text
                  fontFamily="$body"
                  fontSize={12}
                  color="$text3"
                  numberOfLines={1}
                >
                  {r.line}
                </Text>
              </View>
              <IconChevronR size={16} color="#5C5C68" />
            </View>
          </Pressable>
        ))}
      </Card>
    </View>
  );
}
