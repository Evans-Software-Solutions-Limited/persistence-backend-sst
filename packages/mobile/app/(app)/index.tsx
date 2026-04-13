import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useAdapters } from "../../src/ui/hooks/useAdapters";
import { useAuth } from "../../src/ui/hooks/useAuth";
import { useSync } from "../../src/ui/hooks/useSync";

type ConnectionStatus = "checking" | "connected" | "error";

export default function Home() {
  const { session, signOut } = useAuth();
  const { api } = useAdapters();
  const syncState = useSync();
  const [apiStatus, setApiStatus] = useState<ConnectionStatus>("checking");
  const [apiError, setApiError] = useState<string | null>(null);

  const checkApiHealth = useCallback(async () => {
    setApiStatus("checking");
    setApiError(null);
    const result = await api.healthCheck();
    if (result.ok) {
      setApiStatus("connected");
    } else {
      setApiStatus("error");
      setApiError(result.error.message);
    }
  }, [api]);

  useEffect(() => {
    checkApiHealth();
  }, [checkApiHealth]);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* User info */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Account</Text>
        <Text style={styles.cardText}>{session?.email ?? "Unknown"}</Text>
        <Pressable style={styles.secondaryButton} onPress={signOut}>
          <Text style={styles.secondaryButtonText}>Sign Out</Text>
        </Pressable>
      </View>

      {/* API connection status */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>SST API</Text>
        <View style={styles.statusRow}>
          <View
            style={[
              styles.statusDot,
              apiStatus === "connected" && styles.statusConnected,
              apiStatus === "error" && styles.statusError,
              apiStatus === "checking" && styles.statusChecking,
            ]}
          />
          <Text style={styles.cardText}>
            {apiStatus === "checking" && "Checking connection..."}
            {apiStatus === "connected" && "Connected"}
            {apiStatus === "error" && (apiError ?? "Connection failed")}
          </Text>
          {apiStatus === "checking" && (
            <ActivityIndicator size="small" color="#A9B3C1" />
          )}
        </View>
        {apiStatus === "error" && (
          <Pressable style={styles.secondaryButton} onPress={checkApiHealth}>
            <Text style={styles.secondaryButtonText}>Retry</Text>
          </Pressable>
        )}
      </View>

      {/* Offline sync status */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Offline Sync</Text>
        {syncState.isClean ? (
          <Text style={styles.cardText}>All changes synced</Text>
        ) : (
          <>
            {syncState.pending > 0 && (
              <Text style={styles.cardText}>
                {syncState.pending} change{syncState.pending !== 1 ? "s" : ""}{" "}
                pending
              </Text>
            )}
            {syncState.inFlight > 0 && (
              <Text style={styles.cardText}>
                {syncState.inFlight} syncing...
              </Text>
            )}
            {syncState.failed > 0 && (
              <Text style={[styles.cardText, styles.errorText]}>
                {syncState.failed} failed
              </Text>
            )}
          </>
        )}
      </View>

      {/* Foundation status */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Foundation Status</Text>
        <StatusItem label="Auth (Supabase)" ok={!!session} />
        <StatusItem label="API Client" ok={apiStatus === "connected"} />
        <StatusItem label="Offline DB" ok />
        <StatusItem label="Sync Queue" ok />
      </View>
    </ScrollView>
  );
}

function StatusItem({ label, ok }: { label: string; ok: boolean }) {
  return (
    <View style={styles.statusRow}>
      <Text
        style={[styles.statusIndicator, ok ? styles.okText : styles.errorText]}
      >
        {ok ? "[OK]" : "[--]"}
      </Text>
      <Text style={styles.cardText}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0C0F17",
  },
  content: {
    padding: 16,
    gap: 16,
  },
  card: {
    backgroundColor: "#121826",
    borderRadius: 12,
    padding: 16,
    gap: 8,
  },
  cardTitle: {
    fontSize: 14,
    fontWeight: "600",
    color: "#A9B3C1",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  cardText: {
    fontSize: 16,
    color: "#E5E9F0",
  },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  statusConnected: {
    backgroundColor: "#22C55E",
  },
  statusError: {
    backgroundColor: "#EF4444",
  },
  statusChecking: {
    backgroundColor: "#F97316",
  },
  statusIndicator: {
    fontSize: 12,
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
    fontWeight: "600",
  },
  okText: {
    color: "#22C55E",
  },
  errorText: {
    color: "#EF4444",
  },
  secondaryButton: {
    borderColor: "#1E90FF",
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 16,
    alignSelf: "flex-start",
    marginTop: 4,
  },
  secondaryButtonText: {
    color: "#1E90FF",
    fontSize: 14,
    fontWeight: "600",
  },
});
