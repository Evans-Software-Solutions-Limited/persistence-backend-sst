import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import type { RequestLogEntry } from "@/adapters/api/requestLog";
import { colorPalette } from "@/ui/theme";

export interface RequestLogPresenterProps {
  entries: RequestLogEntry[];
  onRefresh: () => void;
  onShare: () => void;
  onClear: () => void;
}

/** Milliseconds since the first entry, padded for a monospace column. */
function offset(entry: RequestLogEntry, origin: number): string {
  return `+${String(entry.startedAt - origin).padStart(6, " ")}ms`;
}

function duration(entry: RequestLogEntry): string {
  return entry.endedAt === null ? "…" : `${entry.endedAt - entry.startedAt}ms`;
}

function outcome(entry: RequestLogEntry): string {
  if (entry.error) return entry.error;
  return entry.status === null ? "pending" : String(entry.status);
}

export function RequestLogPresenter({
  entries,
  onRefresh,
  onShare,
  onClear,
}: RequestLogPresenterProps) {
  const origin = entries[0]?.startedAt ?? 0;
  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>API request log</Text>
        <Text style={styles.meta}>
          {`${entries.length} request${entries.length === 1 ? "" : "s"} since launch · offsets from the first`}
        </Text>
        <View style={styles.actions}>
          <Pressable
            accessibilityRole="button"
            onPress={onRefresh}
            style={styles.button}
            testID="request-log-refresh"
          >
            <Text style={styles.buttonText}>Refresh</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={onShare}
            disabled={entries.length === 0}
            style={[styles.button, entries.length === 0 && styles.disabled]}
            testID="request-log-share"
          >
            <Text style={styles.buttonText}>Share JSON</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={onClear}
            style={styles.button}
            testID="request-log-clear"
          >
            <Text style={styles.buttonText}>Clear</Text>
          </Pressable>
        </View>
        {entries.length === 0 ? (
          <Text style={styles.empty}>No requests recorded yet.</Text>
        ) : (
          entries.map((entry) => (
            <View key={entry.id} style={styles.row} testID="request-log-row">
              <Text style={styles.mono}>
                {`${offset(entry, origin)} ${entry.method.padEnd(6, " ")} ${entry.path}`}
              </Text>
              <Text style={styles.monoDim}>
                {`${outcome(entry)} · ${duration(entry)}`}
              </Text>
            </View>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colorPalette.black },
  content: { padding: 16, gap: 8 },
  title: { color: colorPalette.white, fontSize: 20, fontWeight: "600" },
  meta: { color: colorPalette.white, opacity: 0.7, fontSize: 13 },
  actions: { flexDirection: "row", gap: 8, marginVertical: 8 },
  button: {
    backgroundColor: colorPalette.info,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
  },
  disabled: { opacity: 0.4 },
  buttonText: { color: colorPalette.black, fontSize: 14, fontWeight: "600" },
  empty: { color: colorPalette.white, opacity: 0.7, marginTop: 8 },
  row: { paddingVertical: 4 },
  mono: { color: colorPalette.white, fontFamily: "Menlo", fontSize: 11 },
  monoDim: {
    color: colorPalette.white,
    opacity: 0.6,
    fontFamily: "Menlo",
    fontSize: 11,
  },
});
