import { RefreshControl, ScrollView } from "react-native";
import { Text, View } from "@tamagui/core";

import { IconClipboard } from "@/ui/components/icons";
import { EDITED_ELSEWHERE } from "@/domain/models/coachForms";
import type {
  LibrarySection,
  LibrarySectionKey,
} from "@/domain/services/coachForms.service";
import { PLogoDrawLoader } from "@/ui/components";
import { CountText, ListRow, OfflineNote, SectionHead } from "./kit";

/**
 * C10g — Library → Forms: forms grouped by when they go out, each with its
 * "done/reached" count, then Templates (empty: none are seeded yet).
 */
export type FormsLibraryPresenterProps = {
  sections: LibrarySection[];
  isLoading: boolean;
  isRefreshing: boolean;
  offline: boolean;
  onRefresh: () => void;
  onOpen: (formId: string, scheduleId: string | null) => void;
  onAdd: (section: LibrarySectionKey) => void;
};

export function FormsLibraryPresenter(p: FormsLibraryPresenterProps) {
  if (p.isLoading) {
    return (
      <View
        flex={1}
        alignItems="center"
        justifyContent="center"
        testID="forms-library-loader"
      >
        <PLogoDrawLoader />
      </View>
    );
  }
  return (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 140 }}
      refreshControl={
        <RefreshControl refreshing={p.isRefreshing} onRefresh={p.onRefresh} />
      }
      testID="forms-library"
    >
      {p.offline ? <OfflineNote /> : null}
      {p.sections.map((section, i) => (
        <View key={section.key} testID={`forms-section-${section.key}`}>
          <SectionHead
            title={section.title}
            first={i === 0}
            onAdd={section.addable ? () => p.onAdd(section.key) : undefined}
            addLabel={`Add a form to ${section.title}`}
            testID={`forms-section-${section.key}-head`}
          />
          {section.rows.length === 0 ? (
            <Text
              fontFamily="$body"
              fontSize={12.5}
              color="$text3"
              paddingVertical={12}
            >
              None yet.
            </Text>
          ) : (
            section.rows.map((row) => (
              <ListRow
                key={row.key}
                leading={<IconClipboard size={20} color="#8A8A98" />}
                title={row.title}
                subtitle={row.conflict ? EDITED_ELSEWHERE : row.subtitle}
                subtitleTone={row.conflict ? "warn" : "muted"}
                right={<CountText text={row.count} muted={row.countMuted} />}
                onPress={() => p.onOpen(row.formId, row.scheduleId)}
                accessibilityLabel={`${row.title}, ${row.subtitle}, ${row.count}`}
                testID={`forms-row-${row.key}`}
              />
            ))
          )}
        </View>
      ))}
      <SectionHead title="Templates" testID="forms-section-templates" />
      <Text
        fontFamily="$body"
        fontSize={12.5}
        lineHeight={17}
        color="$text3"
        paddingVertical={12}
        testID="forms-templates-empty"
      >
        No templates yet. Forms you build show up above.
      </Text>
    </ScrollView>
  );
}
