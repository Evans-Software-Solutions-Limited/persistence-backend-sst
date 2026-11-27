import { Text, View } from "@tamagui/core";

import { BottomSheet } from "@/ui/components/foundation";
import type { CoachResource } from "@/domain/models/coachResources";
import { resourceMeta } from "@/domain/services/coachResources.service";
import { Note } from "@/ui/presenters/coachForms/kit";
import { ResourceRow, SearchField, SmallButton, TickBox } from "./resourceKit";

/**
 * C3.7c — "Add resources for {name}": search the library, tick several,
 * or Upload (the app's photo picker, online only) or Link, then "Add N".
 * Uploads and links go to the Library too and are shared with this client.
 */
export type AddResourcesSheetPresenterProps = {
  visible: boolean;
  onClose: () => void;
  firstName: string;
  candidates: CoachResource[];
  libraryCount: number;
  query: string;
  onQuery: (q: string) => void;
  selected: readonly string[];
  onToggle: (resourceId: string) => void;
  busy: boolean;
  offline: boolean;
  error: string | null;
  onUpload: () => void;
  onLink: () => void;
  onAdd: () => void;
};

export function AddResourcesSheetPresenter(p: AddResourcesSheetPresenterProps) {
  const n = p.selected.length;
  return (
    <BottomSheet
      visible={p.visible}
      onClose={p.onClose}
      title={`Add resources for ${p.firstName}`}
      accent="trainer"
      height="tall"
      testID="add-resources-sheet"
      footer={
        <View
          flexDirection="row"
          alignItems="center"
          gap={8}
          paddingHorizontal={20}
          paddingTop={6}
        >
          <SmallButton
            label="Upload"
            onPress={p.onUpload}
            disabled={p.busy || p.offline}
            testID="add-resources-upload"
          />
          <SmallButton
            label="Link"
            onPress={p.onLink}
            disabled={p.busy}
            testID="add-resources-link"
          />
          <View flex={1} />
          <SmallButton
            label={n === 0 ? "Add" : `Add ${n}`}
            filled
            onPress={p.onAdd}
            disabled={n === 0 || p.busy}
            testID="add-resources-add"
          />
        </View>
      }
    >
      <SearchField
        value={p.query}
        onChangeText={p.onQuery}
        placeholder="Search your resources"
        testID="add-resources-search"
      />
      {p.offline ? (
        <Note testID="add-resources-offline">
          Uploading needs a connection. Shares and links send when you're back.
        </Note>
      ) : null}
      {p.error ? <Note testID="add-resources-error">{p.error}</Note> : null}
      {p.candidates.length === 0 ? (
        <Text
          marginTop={12}
          fontFamily="$body"
          fontSize={13}
          color="$text3"
          testID="add-resources-empty"
        >
          {p.libraryCount === 0
            ? "Your Library has no resources yet. Upload a photo or add a link."
            : p.query.trim()
              ? "Nothing matches that search."
              : `${p.firstName} already has everything in your Library.`}
        </Text>
      ) : (
        <View marginTop={4}>
          {p.candidates.map((r) => {
            const on = p.selected.includes(r.id);
            return (
              <ResourceRow
                key={r.id}
                kind={r.kind}
                mime={r.mime}
                title={r.title}
                subtitle={resourceMeta(r)}
                right={<TickBox checked={on} />}
                onPress={() => p.onToggle(r.id)}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: on, disabled: p.busy }}
                testID={`add-resources-row-${r.id}`}
              />
            );
          })}
        </View>
      )}
      <Text marginTop={12} fontFamily="$body" fontSize={12} color="$text3">
        Uploads go to your Library too, so you can share them again.
      </Text>
    </BottomSheet>
  );
}
