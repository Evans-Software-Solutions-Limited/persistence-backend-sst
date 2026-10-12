import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import type { CryptoProbeReport } from "@/diagnostics/together/cryptoProbe";
import type { CryptoBackendName } from "@/adapters/together/security/cryptoBackend";
import { colorPalette } from "@/ui/theme";

export interface TogetherProbePresenterProps {
  engine: string;
  platform: string;
  osVersion: string;
  devBuild: boolean;
  backend: CryptoBackendName;
  progress: string;
  error: string | null;
  report: CryptoProbeReport | null;
  onRun: () => void;
  onShare: () => void;
  onToggleBackend: () => void;
}

/**
 * Diagnostic-only presenter for the Together crypto probe (PER-20 / D16).
 * Pure: every value and action arrives through props. Not product UI, so
 * legacy fidelity does not apply; it is never mounted on production builds.
 */
export function TogetherProbePresenter({
  engine,
  platform,
  osVersion,
  devBuild,
  backend,
  progress,
  error,
  report,
  onRun,
  onShare,
  onToggleBackend,
}: TogetherProbePresenterProps) {
  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>Together crypto probe</Text>
        <Text style={styles.meta}>
          {`Engine: ${engine} · ${platform} ${osVersion}${
            devBuild ? " · DEBUG build (numbers misleading)" : " · release"
          } · crypto: ${backend}`}
        </Text>
        <Pressable
          onPress={onToggleBackend}
          style={({ pressed }) => [
            styles.button,
            styles.secondary,
            pressed && styles.pressed,
          ]}
          testID="together-probe-backend"
        >
          <Text style={styles.buttonText}>
            {backend === "native"
              ? "Switch to noble (pure JS)"
              : "Switch to native crypto"}
          </Text>
        </Pressable>
        <View style={styles.row}>
          <Pressable
            onPress={onRun}
            style={({ pressed }) => [styles.button, pressed && styles.pressed]}
            testID="together-probe-run"
          >
            <Text style={styles.buttonText}>Run</Text>
          </Pressable>
          <Pressable
            onPress={onShare}
            disabled={!report}
            style={({ pressed }) => [
              styles.button,
              !report && styles.disabled,
              pressed && styles.pressed,
            ]}
            testID="together-probe-share"
          >
            <Text style={styles.buttonText}>Share JSON</Text>
          </Pressable>
        </View>
        <Text style={styles.progress} testID="together-probe-progress">
          {progress}
        </Text>
        {error ? (
          <Text style={styles.error} testID="together-probe-error">
            {error}
          </Text>
        ) : null}
        {report ? (
          <View style={styles.table} testID="together-probe-table">
            <View style={[styles.tr, styles.th]}>
              <Text style={[styles.td, styles.name]}>Benchmark</Text>
              <Text style={[styles.td, styles.num]}>n</Text>
              <Text style={[styles.td, styles.num]}>total ms</Text>
              <Text style={[styles.td, styles.num]}>ms/op</Text>
            </View>
            {report.benchmarks.map((b) => (
              <View key={b.name} style={styles.tr}>
                <Text style={[styles.td, styles.name]}>{b.name}</Text>
                <Text style={[styles.td, styles.num]}>
                  {b.skipped ? "—" : b.iterations}
                </Text>
                <Text style={[styles.td, styles.num]}>
                  {b.skipped ? "skipped" : b.totalMs.toFixed(1)}
                </Text>
                <Text style={[styles.td, styles.num]}>
                  {b.skipped ? "—" : b.msPerOp.toFixed(3)}
                </Text>
              </View>
            ))}
            {report.estimates.map((e) => (
              <View key={e.participants} style={styles.estimate}>
                <Text style={styles.meta}>
                  {`Per-set crypto at ${e.participants} participants: sender ${e.sender.totalMs.toFixed(0)} ms · receiver ${e.receiver.totalMs.toFixed(0)} ms`}
                </Text>
              </View>
            ))}
            <Text style={styles.meta}>
              {`Roster ${report.fixture.rosterBytes} B · clone ${report.fixture.clonePayloadBytes} B · device ${report.environment.deviceModel ?? "unknown"}`}
            </Text>
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colorPalette.black },
  content: { padding: 16, gap: 12 },
  title: { color: colorPalette.white, fontSize: 20, fontWeight: "600" },
  meta: { color: colorPalette.white, fontSize: 12, opacity: 0.8 },
  row: { flexDirection: "row", gap: 12 },
  button: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: "center",
    backgroundColor: colorPalette.info,
  },
  pressed: { opacity: 0.7 },
  secondary: { backgroundColor: colorPalette.white, opacity: 0.85 },
  disabled: { opacity: 0.4 },
  buttonText: { color: colorPalette.black, fontWeight: "600" },
  progress: { color: colorPalette.white, fontSize: 14 },
  error: { color: colorPalette.error, fontSize: 13 },
  table: { gap: 4 },
  tr: { flexDirection: "row", gap: 6, paddingVertical: 4 },
  th: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colorPalette.white,
  },
  td: { color: colorPalette.white, fontSize: 11 },
  name: { flex: 3 },
  num: { flex: 1, textAlign: "right", fontVariant: ["tabular-nums"] },
  estimate: { paddingTop: 8 },
});
