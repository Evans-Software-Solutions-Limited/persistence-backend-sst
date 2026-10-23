import type { ReactNode } from "react";
import { RefreshControl, ScrollView, TextInput } from "react-native";
import { Text, View, useTheme } from "@tamagui/core";
import { Globe, QrCode, Radio, ShieldCheck } from "lucide-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Btn, Card, IconBtn } from "@/ui/components/foundation";
import {
  IconBack,
  IconSearch,
  IconWifiOff,
  iconDefaults,
} from "@/ui/components/icons";
import { TogetherAthleteAvatar } from "./TogetherAthleteAvatar";
import { TogetherEyebrow } from "./TogetherEyebrow";
import { LoadingSpinner } from "@/ui/components/LoadingSpinner";
import { color } from "@/ui/theme/tokens";

export type TogetherJoinRowKind =
  | "partner-nearby"
  | "nearby"
  | "online"
  | "full";
export interface TogetherJoinRow {
  id: string;
  /** Partner name, or the workout name when the nearby host is not a partner. */
  title: string;
  /** "Lower Body B · 3 of 4" */
  subtitle: string;
  kind: TogetherJoinRowKind;
  /** First name used in "Nearby · Kai lets you in"; omitted when unknown. */
  hostName?: string;
}
export type TogetherJoinSearch =
  | "searching"
  | "found"
  | "empty"
  | "failed"
  | "unavailable";

/** Canvas row 1: Join a session. Searches on open, stops at 30 s, refreshes on pull-down. */
export function TogetherJoinPresenter(p: {
  code: string;
  onCode(value: string): void;
  onContinue(): void;
  onScan(): void;
  scanner?: ReactNode;
  search: TogetherJoinSearch;
  elapsedSeconds?: number;
  rows: readonly TogetherJoinRow[];
  /** Copy for the failed state; the title is fixed. */
  failure?: string;
  refreshing: boolean;
  onRefresh(): void;
  onOpenSettings(): void;
  onSelect(id: string): void;
  busy?: boolean;
  notice?: string;
  onBack(): void;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const searching = p.search === "searching";
  const stat = (icon: ReactNode, text: string, tint?: string) => (
    <View flexDirection="row" alignItems="center" gap={6} minHeight={20}>
      {icon}
      <Text
        fontFamily="$body"
        fontSize={12}
        style={tint ? { color: tint } : undefined}
        color="$text3"
      >
        {text}
      </Text>
    </View>
  );
  const row = (r: TogetherJoinRow, first: boolean) => {
    const full = r.kind === "full";
    const action =
      r.kind === "nearby" ? "Ask to join" : full ? undefined : "Join";
    return (
      <View
        key={r.id}
        flexDirection="row"
        alignItems="center"
        gap={12}
        paddingVertical={12}
        borderTopWidth={first ? 0 : 1}
        borderColor="$border"
        opacity={full ? 0.55 : 1}
        testID={`together-join-row-${r.id}`}
      >
        <TogetherAthleteAvatar
          name={r.title}
          size={36}
          tone={r.kind === "online" ? "info" : "primary"}
        />
        <View flex={1} gap={2}>
          <Text
            fontFamily="$display"
            fontWeight="600"
            fontSize={14}
            color={full ? "$text3" : "$text"}
          >
            {r.title}
          </Text>
          <Text fontFamily="$body" fontSize={12} color="$text3">
            {r.subtitle}
          </Text>
          {r.kind === "partner-nearby" &&
            stat(
              <ShieldCheck
                size={16}
                color={color.$success}
                strokeWidth={1.75}
              />,
              "Verified partner · Nearby",
              color.$success,
            )}
          {r.kind === "nearby" &&
            stat(
              <Radio size={16} color={color.$text3} strokeWidth={1.75} />,
              r.hostName
                ? `Nearby · ${r.hostName} lets you in`
                : "Nearby · the host lets you in",
            )}
          {r.kind === "online" &&
            stat(
              <Globe size={16} color={color.$text3} strokeWidth={1.75} />,
              "Online · internet required",
            )}
        </View>
        {action ? (
          <Btn
            size="sm"
            variant={r.kind === "nearby" ? "outline" : "soft"}
            tone="primary"
            disabled={p.busy}
            accessibilityLabel={`${action} ${r.title}`}
            onPress={() => p.onSelect(r.id)}
          >
            {action}
          </Btn>
        ) : (
          <Text fontFamily="$body" fontSize={12} color="$text3">
            Full
          </Text>
        )}
      </View>
    );
  };
  const elapsed = p.elapsedSeconds ?? 0;
  const clock = `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, "0")}`;
  return (
    <View
      flex={1}
      backgroundColor="$bg"
      paddingTop={insets.top}
      testID="together-join-screen"
    >
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{
          paddingHorizontal: 20,
          paddingTop: 8,
          paddingBottom: insets.bottom + 30,
          gap: 14,
        }}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={p.refreshing}
            onRefresh={p.onRefresh}
            tintColor={theme.primary.val}
            title="Release to search again"
            titleColor={color.$text2}
          />
        }
        testID="together-join-scroll"
      >
        <IconBtn
          icon={<IconBack {...iconDefaults({ size: 20 })} />}
          tone="neutral"
          size={44}
          onPress={p.onBack}
          accessibilityLabel="Back"
        />
        <View gap={6}>
          <TogetherEyebrow>Train together</TogetherEyebrow>
          <Text
            fontFamily="$display"
            fontWeight="800"
            fontSize={32}
            letterSpacing={-1}
            color="$text"
          >
            Join a session
          </Text>
          <Text fontFamily="$body" fontSize={13} lineHeight={19} color="$text2">
            Enter the code they shared, or scan their QR.
          </Text>
        </View>
        <Card surface={0}>
          <View gap={10}>
            <Text
              fontFamily="$display"
              fontWeight="600"
              fontSize={14}
              color="$text"
            >
              Session code
            </Text>
            <TextInput
              value={p.code}
              onChangeText={p.onCode}
              autoCapitalize="none"
              autoCorrect={false}
              maxLength={12000}
              accessibilityLabel="Session code"
              testID="together-code"
              placeholder="Paste the code or link"
              placeholderTextColor={color.$text4}
              style={{
                height: 44,
                paddingHorizontal: 12,
                color: color.$text,
                backgroundColor: color.$surface3,
                borderRadius: 12,
                fontFamily: "Geist Mono",
                fontSize: 14,
              }}
            />
            <View flexDirection="row" gap={8}>
              <View flex={1}>
                <Btn
                  full
                  variant="outline"
                  tone="primary"
                  disabled={!p.code.trim() || p.busy}
                  onPress={p.onContinue}
                >
                  Continue
                </Btn>
              </View>
              <View flex={1.3}>
                <Btn
                  full
                  variant="soft"
                  disabled={p.busy}
                  icon={
                    <QrCode
                      size={16}
                      color={color.$primary}
                      strokeWidth={1.75}
                    />
                  }
                  onPress={p.onScan}
                >
                  Scan a QR code
                </Btn>
              </View>
            </View>
            {p.scanner}
          </View>
        </Card>
        {!!p.notice && (
          <Text
            fontFamily="$body"
            fontSize={13}
            color="$warning"
            accessibilityRole="alert"
          >
            {p.notice}
          </Text>
        )}
        <View
          flexDirection="row"
          alignItems="center"
          justifyContent="space-between"
          gap={8}
          minHeight={20}
        >
          <TogetherEyebrow>Sessions you can join</TogetherEyebrow>
          {searching &&
            stat(
              <LoadingSpinner size="sm" accessibilityLabel="Searching" />,
              `Searching nearby · ${clock}`,
            )}
          {p.search === "found" && (
            <Text fontFamily="$body" fontSize={12} color="$text3">
              Pull down to refresh
            </Text>
          )}
        </View>
        {searching && (
          <View gap={8} accessibilityLiveRegion="polite">
            {p.rows.length > 0 ? (
              <Card surface={0} pad={0} style={{ paddingHorizontal: 16 }}>
                {p.rows.map((r, i) => row(r, i === 0))}
              </Card>
            ) : (
              <Card surface={0} pad={0} style={{ paddingHorizontal: 16 }}>
                {[0, 1].map((i) => (
                  <View
                    key={i}
                    flexDirection="row"
                    alignItems="center"
                    gap={12}
                    paddingVertical={12}
                    borderTopWidth={i ? 1 : 0}
                    borderColor="$border"
                  >
                    <View
                      width={36}
                      height={36}
                      borderRadius={99}
                      backgroundColor="$surface3"
                      opacity={0.6}
                    />
                    <View flex={1} gap={6}>
                      <View
                        height={12}
                        width="55%"
                        borderRadius={6}
                        backgroundColor="$surface3"
                      />
                      <View
                        height={10}
                        width="80%"
                        borderRadius={5}
                        backgroundColor="$surface3"
                        opacity={0.7}
                      />
                    </View>
                  </View>
                ))}
              </Card>
            )}
            <Text fontFamily="$body" fontSize={12} color="$text3">
              Stops by itself after 30 seconds.
            </Text>
          </View>
        )}
        {p.search === "found" && (
          <Card surface={0} pad={0} style={{ paddingHorizontal: 16 }}>
            {p.rows.map((r, i) => row(r, i === 0))}
          </Card>
        )}
        {p.search === "empty" && (
          <Card surface={0}>
            <View alignItems="center" gap={10} paddingVertical={8}>
              <View
                width={48}
                height={48}
                borderRadius={99}
                backgroundColor="$surface3"
                alignItems="center"
                justifyContent="center"
              >
                <IconSearch
                  {...iconDefaults({ size: 20 })}
                  color={color.$text3}
                />
              </View>
              <Text
                fontFamily="$display"
                fontWeight="600"
                fontSize={14}
                color="$text"
              >
                No sessions nearby
              </Text>
              <Text
                fontFamily="$body"
                fontSize={12}
                lineHeight={17}
                color="$text3"
                textAlign="center"
              >
                Searched for 30 seconds. Ask the host to show their QR. Scanning
                it works even when a search doesn’t.
              </Text>
              <View alignSelf="stretch">
                <Btn full variant="soft" onPress={p.onRefresh}>
                  Search again
                </Btn>
              </View>
            </View>
          </Card>
        )}
        {p.search === "failed" && (
          <View gap={8}>
            <Card surface={0} accent="ember">
              <View gap={12}>
                <View flexDirection="row" gap={12} alignItems="flex-start">
                  <View
                    width={36}
                    height={36}
                    borderRadius={99}
                    backgroundColor="$emberDim"
                    alignItems="center"
                    justifyContent="center"
                  >
                    <IconWifiOff
                      size={18}
                      color={color.$ember}
                      strokeWidth={1.75}
                    />
                  </View>
                  <View flex={1} gap={2}>
                    <Text
                      fontFamily="$display"
                      fontWeight="600"
                      fontSize={14}
                      color="$text"
                    >
                      Can’t search nearby
                    </Text>
                    <Text
                      fontFamily="$body"
                      fontSize={12}
                      lineHeight={17}
                      color="$text2"
                    >
                      {p.failure ??
                        "Wi-Fi is off. Turn it on in Settings. You don’t need to join a network."}
                    </Text>
                  </View>
                </View>
                <View flexDirection="row" gap={8}>
                  <View flex={1}>
                    <Btn
                      full
                      variant="outline"
                      tone="primary"
                      onPress={p.onOpenSettings}
                    >
                      Open Settings
                    </Btn>
                  </View>
                  <View flex={1}>
                    <Btn full variant="soft" onPress={p.onRefresh}>
                      Try again
                    </Btn>
                  </View>
                </View>
              </View>
            </Card>
            {p.rows.length > 0 && (
              <Card surface={0} pad={0} style={{ paddingHorizontal: 16 }}>
                {p.rows.map((r, i) => row(r, i === 0))}
              </Card>
            )}
            <Text fontFamily="$body" fontSize={12} color="$text3">
              Online sessions from partners still show when you have internet.
            </Text>
          </View>
        )}
        {p.search === "unavailable" && (
          <View gap={8}>
            {p.rows.length > 0 && (
              <Card surface={0} pad={0} style={{ paddingHorizontal: 16 }}>
                {p.rows.map((r, i) => row(r, i === 0))}
              </Card>
            )}
            <Text fontFamily="$body" fontSize={12} color="$text3">
              Nearby search is not available on this phone. Scan the host’s QR
              or use their code.
            </Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}
