import { useCallback, useEffect, useState } from "react";
import { ScrollView } from "react-native";
import { View } from "@tamagui/core";
import { useAdapters } from "../../../src/ui/hooks/useAdapters";
import { useAuth } from "../../../src/ui/hooks/useAuth";
import { useSync } from "../../../src/ui/hooks/useSync";
import {
  Text,
  Card,
  Row,
  Column,
  Button,
  Badge,
  LoadingSpinner,
} from "../../../src/ui/components";
import { colorPalette } from "../../../src/ui/theme";

type ConnectionStatus = "checking" | "connected" | "error";

export default function Home() {
  const { session } = useAuth();
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
    <ScrollView
      style={{ flex: 1, backgroundColor: colorPalette.neutral1000 }}
      contentContainerStyle={{ padding: 16, gap: 16 }}
    >
      {/* Greeting */}
      <Card>
        <Column gap="xs">
          <Text variant="label" secondary>
            WELCOME BACK
          </Text>
          <Text variant="h3">{session?.email ?? "Lifter"}</Text>
        </Column>
      </Card>

      {/* API connection status */}
      <Card>
        <Column gap="sm">
          <Text variant="label" secondary>
            SST API
          </Text>
          <Row gap="sm">
            <View
              width={8}
              height={8}
              borderRadius="$full"
              backgroundColor={
                apiStatus === "connected"
                  ? "$success"
                  : apiStatus === "error"
                    ? "$error"
                    : "$warning"
              }
            />
            <Text variant="body">
              {apiStatus === "checking" && "Checking connection..."}
              {apiStatus === "connected" && "Connected"}
              {apiStatus === "error" && (apiError ?? "Connection failed")}
            </Text>
            {apiStatus === "checking" && <LoadingSpinner size="sm" />}
          </Row>
          {apiStatus === "error" && (
            <Button
              label="Retry"
              onPress={checkApiHealth}
              variant="secondary"
              size="sm"
            />
          )}
        </Column>
      </Card>

      {/* Offline sync status */}
      <Card>
        <Column gap="sm">
          <Text variant="label" secondary>
            OFFLINE SYNC
          </Text>
          {syncState.isClean ? (
            <Text variant="body">All changes synced</Text>
          ) : (
            <>
              {syncState.pending > 0 && (
                <Text variant="body">
                  {syncState.pending} change
                  {syncState.pending !== 1 ? "s" : ""} pending
                </Text>
              )}
              {syncState.inFlight > 0 && (
                <Text variant="body">{syncState.inFlight} syncing...</Text>
              )}
              {syncState.failed > 0 && (
                <Text variant="body" style={{ color: colorPalette.error }}>
                  {syncState.failed} failed
                </Text>
              )}
            </>
          )}
        </Column>
      </Card>

      {/* Foundation status */}
      <Card>
        <Column gap="sm">
          <Text variant="label" secondary>
            FOUNDATION STATUS
          </Text>
          <StatusItem label="Auth (Supabase)" ok={!!session} />
          <StatusItem label="API Client" ok={apiStatus === "connected"} />
          <StatusItem label="Offline DB" ok />
          <StatusItem label="Sync Queue" ok />
        </Column>
      </Card>
    </ScrollView>
  );
}

function StatusItem({ label, ok }: { label: string; ok: boolean }) {
  return (
    <Row gap="sm">
      <Badge
        label={ok ? "OK" : "--"}
        variant={ok ? "success" : "error"}
        size="sm"
      />
      <Text variant="body">{label}</Text>
    </Row>
  );
}
