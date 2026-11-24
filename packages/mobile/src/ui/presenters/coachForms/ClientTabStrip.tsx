import { Pressable, ScrollView } from "react-native";
import { Text, View } from "@tamagui/core";

/**
 * PER-129 — the C3 client tab strip (canvas C3.3b/C10j): 36pt tabs, a violet
 * underline on the open one, scrolling sideways.
 */
export const CLIENT_TABS = [
  "overview",
  "training",
  "nutrition",
  "check-ins",
  "photos",
  "body",
  "habits",
  "messages",
  "resources",
  "notes",
  "settings",
] as const;
export type ClientTab = (typeof CLIENT_TABS)[number];

export const CLIENT_TAB_LABELS: Record<ClientTab, string> = {
  overview: "Overview",
  training: "Training",
  nutrition: "Nutrition",
  "check-ins": "Check-ins",
  photos: "Photos",
  body: "Body",
  habits: "Habits",
  messages: "Messages",
  resources: "Resources",
  notes: "Notes",
  settings: "Settings",
};

export function isClientTab(v: unknown): v is ClientTab {
  return (
    typeof v === "string" && (CLIENT_TABS as readonly string[]).includes(v)
  );
}

export function ClientTabStrip(p: {
  active: ClientTab;
  onChange: (tab: ClientTab) => void;
}) {
  return (
    <View paddingHorizontal={20} marginTop={10} testID="client-tabs">
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{
          gap: 2,
          borderBottomWidth: 1,
          borderBottomColor: "rgba(255,255,255,0.08)",
          flexGrow: 1,
        }}
        accessibilityRole="tablist"
      >
        {CLIENT_TABS.map((tab) => {
          const on = tab === p.active;
          return (
            <Pressable
              key={tab}
              onPress={() => p.onChange(tab)}
              accessibilityRole="tab"
              accessibilityState={{ selected: on }}
              testID={`client-tab-${tab}`}
            >
              <View
                height={36}
                paddingHorizontal={8}
                justifyContent="center"
                borderBottomWidth={2}
                borderBottomColor={on ? "#A78BFA" : "transparent"}
              >
                <Text
                  fontFamily="$body"
                  fontWeight="600"
                  fontSize={13}
                  color={on ? "$text" : "$text3"}
                >
                  {CLIENT_TAB_LABELS[tab]}
                </Text>
              </View>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}
