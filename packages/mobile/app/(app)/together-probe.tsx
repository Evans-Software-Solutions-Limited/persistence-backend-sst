/* eslint-disable @typescript-eslint/no-require-imports -- optional native module probed lazily. */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { openDatabaseSync } from "expo-sqlite";
import {
  assertFixtureVerifies,
  runCryptoProbe,
  type CryptoProbeReport,
  type ProbeBenchmarkName,
} from "@/adapters/together/diagnostics/cryptoProbe";
import {
  getCryptoBackend,
  installCryptoBackend,
  installNativeTogetherCrypto,
  nobleCryptoBackend,
  type CryptoBackendName,
} from "@/adapters/together/security/cryptoBackend";
import { colorPalette } from "@/ui/theme";

/**
 * Hidden diagnostic route — PER-20 Hermes crypto probe.
 *
 * No navigation entry anywhere; reach it with
 * `xcrun simctl openurl booted "<scheme>://together-probe"` (the scheme is
 * `persistencemobile` for production, `persistencemobile-staging` for the
 * staging variant). The `(app)` group requires sign-in. This is not product
 * UI: legacy fidelity rules do not apply, and nothing here is reachable from
 * an existing screen. The runner lives in
 * `src/adapters/together/diagnostics/cryptoProbe.ts`; this screen only owns
 * the button, the progress line, the table, console output and Share.
 */
export default function TogetherProbeScreen() {
  const [report, setReport] = useState<CryptoProbeReport | null>(null);
  const [progress, setProgress] = useState("Idle");
  const [error, setError] = useState<string | null>(null);
  const running = useRef(false);
  const [backend, setBackend] = useState<CryptoBackendName>(
    () => getCryptoBackend().name,
  );
  useEffect(() => {
    // Same installation path as the Together factories; noble stays if absent.
    setBackend(installNativeTogetherCrypto());
  }, []);
  const toggleBackend = useCallback(() => {
    if (running.current) return;
    if (getCryptoBackend().name === "native") {
      installCryptoBackend(nobleCryptoBackend);
      setBackend("noble");
    } else {
      setBackend(installNativeTogetherCrypto(undefined, { force: true }));
    }
    setReport(null);
    setProgress("Idle");
  }, []);

  const run = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    setError(null);
    setReport(null);
    setProgress("Verifying fixture…");
    let db: ReturnType<typeof openDatabaseSync> | null = null;
    try {
      assertFixtureVerifies();
      db = openDatabaseSync("together-crypto-probe.db");
      const next = await runCryptoProbe({
        database: db,
        environment: {
          platform: Platform.OS,
          osVersion: String(Platform.Version),
          deviceModel: deviceModel(),
          devBuild: __DEV__,
        },
        onProgress: (step: ProbeBenchmarkName, index, total) =>
          setProgress(
            index >= total
              ? `Done (${total} benchmarks)`
              : `${index + 1}/${total} ${step}`,
          ),
      });
      setReport(next);
      console.log("[together-probe] report", JSON.stringify(next, null, 2));
    } catch (e) {
      setError(e instanceof Error ? `${e.name}: ${e.message}` : String(e));
      setProgress("Failed");
    } finally {
      db?.closeSync();
      running.current = false;
    }
  }, []);

  const share = useCallback(async () => {
    if (!report) return;
    const message = JSON.stringify(report, null, 2);
    try {
      await Share.share({ message, title: "Together crypto probe" });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [report]);

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>Together crypto probe</Text>
        <Text style={styles.meta}>
          {`Engine: ${engineLabel()} · ${Platform.OS} ${String(Platform.Version)}${
            __DEV__ ? " · DEBUG build (numbers misleading)" : " · release"
          } · crypto: ${backend}`}
        </Text>
        <Pressable
          onPress={toggleBackend}
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
            onPress={run}
            style={({ pressed }) => [styles.button, pressed && styles.pressed]}
            testID="together-probe-run"
          >
            <Text style={styles.buttonText}>Run</Text>
          </Pressable>
          <Pressable
            onPress={share}
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
        {error ? <Text style={styles.error}>{error}</Text> : null}
        {report ? (
          <View style={styles.table}>
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

function engineLabel(): string {
  const internal = (globalThis as { HermesInternal?: unknown }).HermesInternal;
  return internal ? "Hermes" : "not Hermes (JSC/other)";
}

/** Device model only through the already-installed `expo-device`; never a new dependency. */
function deviceModel(): string | null {
  try {
    const device = require("expo-device") as typeof import("expo-device");
    return device.modelName ?? null;
  } catch {
    return null;
  }
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
