import { Pressable, RefreshControl, ScrollView } from "react-native";
import { Text, View } from "@tamagui/core";

import { BottomSheet, Btn } from "@/ui/components/foundation";
import { IconLink, IconPlus } from "@/ui/components/icons";
import type { CoachResource } from "@/domain/models/coachResources";
import {
  dayMonth,
  resourceMeta,
} from "@/domain/services/coachResources.service";
import { Note } from "@/ui/presenters/coachForms/kit";
import { ResourceRow, SearchField, SmallButton, TickBox } from "./resourceKit";

export type ResourceFilter = "all" | "file" | "link";

const FILTERS: { key: ResourceFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "file", label: "Files" },
  { key: "link", label: "Links" },
];

/**
 * Library → Resources on iPhone (C5c's Resources segment, C5b's content):
 * search, All · Files · Links, the list, Upload and Add link. Tapping a
 * resource offers Share (with several clients) and Delete.
 */
export function ResourcesLibraryPresenter(p: {
  rows: CoachResource[] | null;
  counts: Record<ResourceFilter, number>;
  filter: ResourceFilter;
  onFilter: (f: ResourceFilter) => void;
  query: string;
  onQuery: (q: string) => void;
  offline: boolean;
  notice: string | null;
  onDismissNotice: () => void;
  isRefreshing: boolean;
  onRefresh: () => void;
  onUpload: () => void;
  onLink: () => void;
  onRow: (r: CoachResource) => void;
}) {
  return (
    <ScrollView
      contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 120 }}
      refreshControl={
        <RefreshControl refreshing={p.isRefreshing} onRefresh={p.onRefresh} />
      }
      testID="resources-library"
    >
      <View flexDirection="row" gap={8} marginTop={4} marginBottom={12}>
        <SmallButton
          label="Add link"
          icon={<IconLink size={16} color="#F4F4F8" />}
          onPress={p.onLink}
          testID="resources-library-link"
        />
        <SmallButton
          label="Upload"
          filled
          icon={<IconPlus size={16} color="#1E1B4B" />}
          onPress={p.onUpload}
          disabled={p.offline}
          testID="resources-library-upload"
        />
      </View>
      <SearchField
        value={p.query}
        onChangeText={p.onQuery}
        placeholder="Search resources"
        testID="resources-library-search"
      />
      <View flexDirection="row" gap={8} marginTop={12}>
        {FILTERS.map((f) => {
          const on = p.filter === f.key;
          return (
            <Pressable
              key={f.key}
              onPress={() => p.onFilter(f.key)}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              accessibilityLabel={`${f.label}, ${p.counts[f.key]}`}
              testID={`resources-library-filter-${f.key}`}
            >
              <View
                height={34}
                paddingHorizontal={13}
                borderRadius={9999}
                borderWidth={1}
                borderColor={on ? "rgba(167,139,250,0.5)" : "$border2"}
                backgroundColor={on ? "rgba(167,139,250,0.14)" : "$surface"}
                flexDirection="row"
                alignItems="center"
                gap={6}
              >
                <Text
                  fontFamily="$body"
                  fontWeight="600"
                  fontSize={13}
                  color={on ? "$text" : "$text2"}
                >
                  {f.label}
                </Text>
                <Text
                  fontFamily="$mono"
                  fontWeight="600"
                  fontSize={12}
                  color="$text3"
                >
                  {p.counts[f.key]}
                </Text>
              </View>
            </Pressable>
          );
        })}
      </View>
      {p.offline ? (
        <Note testID="resources-library-offline">
          {
            "You're offline. Links are saved on this phone and send when you're back. Uploading, sharing and deleting need a connection."
          }
        </Note>
      ) : null}
      {p.notice ? (
        <Note onDismiss={p.onDismissNotice} testID="resources-library-notice">
          {p.notice}
        </Note>
      ) : null}
      <View marginTop={8}>
        {p.rows === null ? (
          <Text
            marginTop={12}
            fontFamily="$body"
            fontSize={13}
            color="$text3"
            testID="resources-library-loading"
          >
            Loading resources…
          </Text>
        ) : p.rows.length === 0 ? (
          <Text
            marginTop={12}
            fontFamily="$body"
            fontSize={13}
            lineHeight={18}
            color="$text3"
            testID="resources-library-empty"
          >
            {p.counts.all === 0
              ? "No resources yet. Upload a photo or add a link, then share it with your clients."
              : "Nothing matches."}
          </Text>
        ) : (
          p.rows.map((r) => (
            <ResourceRow
              key={r.id}
              kind={r.kind}
              mime={r.mime}
              title={r.title}
              subtitle={`${resourceMeta(r)} · added ${dayMonth(r.createdAt)}`}
              chevron
              onPress={() => p.onRow(r)}
              testID={`resources-library-row-${r.id}`}
            />
          ))
        )}
      </View>
    </ScrollView>
  );
}

/** Share one resource with several clients at once. */
export function ShareResourceSheetPresenter(p: {
  visible: boolean;
  onClose: () => void;
  title: string;
  clients: { id: string; name: string }[];
  query: string;
  onQuery: (q: string) => void;
  picked: readonly string[];
  onToggle: (clientId: string) => void;
  busy: boolean;
  error: string | null;
  onShare: () => void;
}) {
  const q = p.query.trim().toLowerCase();
  const shown = p.clients.filter((c) => c.name.toLowerCase().includes(q));
  const n = p.picked.length;
  return (
    <BottomSheet
      visible={p.visible}
      onClose={p.onClose}
      title={`Share ${p.title}`}
      accent="trainer"
      height="tall"
      testID="share-resource-sheet"
      footer={
        <View paddingHorizontal={20} paddingTop={6}>
          <Btn
            variant="filled"
            tone="trainer"
            size="lg"
            full
            disabled={n === 0 || p.busy}
            onPress={p.onShare}
            testID="share-resource-save"
          >
            {p.busy
              ? "Sharing…"
              : n === 0
                ? "Share"
                : `Share with ${n === 1 ? "1 client" : `${n} clients`}`}
          </Btn>
        </View>
      }
    >
      <SearchField
        value={p.query}
        onChangeText={p.onQuery}
        placeholder="Search clients"
        testID="share-resource-search"
      />
      {p.error ? <Note testID="share-resource-error">{p.error}</Note> : null}
      {p.clients.length === 0 ? (
        <Text
          marginTop={12}
          fontFamily="$body"
          fontSize={13}
          color="$text3"
          testID="share-resource-empty"
        >
          You have no active clients to share with yet.
        </Text>
      ) : (
        shown.map((c) => {
          const on = p.picked.includes(c.id);
          return (
            <Pressable
              key={c.id}
              onPress={() => p.onToggle(c.id)}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: on }}
              accessibilityLabel={c.name}
              testID={`share-resource-client-${c.id}`}
            >
              <View
                flexDirection="row"
                alignItems="center"
                gap={12}
                paddingVertical={12}
                borderBottomWidth={1}
                borderBottomColor="$border"
              >
                <Text
                  flex={1}
                  fontFamily="$body"
                  fontWeight="500"
                  fontSize={15}
                  color="$text"
                >
                  {c.name}
                </Text>
                <TickBox checked={on} />
              </View>
            </Pressable>
          );
        })
      )}
    </BottomSheet>
  );
}
