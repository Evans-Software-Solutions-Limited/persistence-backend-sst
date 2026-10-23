import { Text, View, useTheme } from "@tamagui/core";
import {
  Image,
  Pressable,
  ScrollView,
  Switch,
  TextInput,
  RefreshControl,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { QrCode } from "lucide-react-native";
import { HeaderBar } from "@/ui/components/foundation/HeaderBar";
import { IconBtn } from "@/ui/components/foundation/IconBtn";
import { IconBack, iconDefaults } from "@/ui/components/icons";
import { BottomSheet } from "@/ui/components/foundation/BottomSheet";
import { Btn } from "@/ui/components/foundation/Btn";
import { Card } from "@/ui/components/foundation/Card";
import { Segmented } from "@/ui/components/foundation/Segmented";
import type {
  SocialPerson,
  TemplateOffer,
} from "@/domain/ports/togetherSocial.port";
export interface PartnerRow extends SocialPerson {
  requestId?: string;
  outgoing?: boolean;
  personCode?: string;
}
export interface TogetherPartnersPresenterProps {
  header?: React.ReactNode;
  embedded?: boolean;
  ownName?: string;
  onEditProfile?(): void;
  codeVisible: boolean;
  onCloseCode(): void;
  onShowCode(): void;
  code: string;
  ownCode: { code: string; expiresAt: string } | null;
  scanner?: React.ReactNode;
  qr?: React.ReactNode;
  onCode(value: string): void;
  onResolve(): void;
  onNewCode(): void;
  onCopyCode(): void;
  onShareCode(): void;
  onScan(): void;
  tab: string;
  query: string;
  busy: boolean;
  loading: boolean;
  refreshing?: boolean;
  available: boolean;
  error: string;
  notice: string;
  friends: PartnerRow[];
  requests: PartnerRow[];
  results: PartnerRow[];
  offers: TemplateOffer[];
  reporting: boolean;
  onReporting(value: boolean): void;
  selected: PartnerRow | null;
  selectedOffer: TemplateOffer | null;
  discoverable: boolean | null;
  onTab(value: string): void;
  onQuery(value: string): void;
  onSearch(): void;
  onRefresh(): void;
  onBack(): void;
  onSelect(value: PartnerRow | null): void;
  onRequest(id: string): void;
  onDecide(id: string, decision: "accept" | "reject"): void;
  onRemove(id: string): void;
  onBlock(id: string): void;
  onReport(
    id: string,
    reason: "harassment" | "spam" | "unsafe" | "other",
  ): void;
  onDiscoverable(value: boolean): void;
  onOffer(value: TemplateOffer | null): void;
  onCopy(id: string): void;
}
const Copy = ({ children }: { children: React.ReactNode }) => (
  <Text fontFamily="$body" fontSize={13} lineHeight={18} color="$text2">
    {children}
  </Text>
);
const name = (p: SocialPerson) => p.displayName?.trim() || "Training partner";
export function TogetherPartnersPresenter(p: TogetherPartnersPresenterProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const disabled = p.busy || !p.available;
  const row = (person: PartnerRow) => (
    <Pressable
      key={person.userId}
      accessibilityRole="button"
      accessibilityLabel={`View ${name(person)}`}
      onPress={() => p.onSelect(person)}
    >
      <View
        flexDirection="row"
        gap={12}
        alignItems="center"
        paddingVertical={16}
      >
        <View
          width={44}
          height={44}
          borderRadius={22}
          backgroundColor="$surface3"
          alignItems="center"
          justifyContent="center"
        >
          {person.avatarUrl ? (
            <Image
              source={{ uri: person.avatarUrl }}
              style={{ width: 44, height: 44, borderRadius: 22 }}
              accessibilityLabel={name(person)}
            />
          ) : (
            <Text fontFamily="$body" color="$primary">
              {name(person).slice(0, 1)}
            </Text>
          )}
        </View>
        <View flex={1} alignItems="flex-start" gap={4}>
          <Text color="$text" fontFamily="$body">
            {name(person)}
          </Text>
          {(!p.friends.some((f) => f.userId === person.userId) ||
            !!person.displayName?.trim()) && (
            <Copy>
              {p.friends.some((f) => f.userId === person.userId)
                ? "Training partner"
                : person.outgoing
                  ? "Invitation sent"
                  : "Name and photo only"}
            </Copy>
          )}
        </View>
        <Text fontFamily="$body" color="$text3">
          ›
        </Text>
      </View>
    </Pressable>
  );
  return (
    <View flex={1} backgroundColor="$bg" testID="together-partners-root">
      {!p.embedded && (
        <View paddingTop={insets.top} flexShrink={0}>
          <HeaderBar
            large
            eyebrow="Train together"
            title="Training partners"
            testID="together-partners-header"
            leading={
              <IconBtn
                icon={<IconBack {...iconDefaults({ size: 20 })} />}
                tone="ghost"
                onPress={p.onBack}
                accessibilityLabel="Go back"
              />
            }
            trailing={
              <IconBtn
                icon={<QrCode {...iconDefaults({ size: 20 })} />}
                tone="ghost"
                disabled={disabled}
                onPress={p.onShowCode}
                accessibilityLabel="My code and QR"
              />
            }
          />
        </View>
      )}
      <ScrollView
        style={{ flex: 1 }}
        refreshControl={
          <RefreshControl
            refreshing={p.refreshing ?? false}
            onRefresh={p.onRefresh}
            tintColor={theme.primary.val}
          />
        }
        contentContainerStyle={{
          paddingHorizontal: 20,
          paddingTop: 8,
          paddingBottom: insets.bottom + 20,
        }}
        keyboardShouldPersistTaps="handled"
        testID="together-partners-scroll"
      >
        <View gap={18} testID="together-partners">
          {p.header}
          {p.embedded && (
            <View
              flexDirection="row"
              alignItems="center"
              justifyContent="space-between"
            >
              <Text fontFamily="$display" fontSize={20} color="$text">
                Training partners
              </Text>
              <Btn
                size="sm"
                variant="ghost"
                onPress={p.onShowCode}
                disabled={disabled}
              >
                My QR
              </Btn>
            </View>
          )}
          {p.onEditProfile && !p.embedded && (
            <Card>
              <View gap={8}>
                <Text color="$text" fontFamily="$body">
                  {p.ownName || "Add your name and photo"}
                </Text>
                <Copy>
                  {p.ownName
                    ? "Help your partners recognise you."
                    : "Partners cannot recognise an account number. Set the name and photo you want to share."}
                </Copy>
                <Btn variant="ghost" onPress={p.onEditProfile}>
                  Edit my profile
                </Btn>
              </View>
            </Card>
          )}
          <Segmented
            options={["Partners", "Add"]}
            value={p.tab}
            onChange={p.onTab}
          />
          {p.error !== "" && !p.codeVisible && (
            <Text fontFamily="$body" accessibilityRole="alert" color="$warning">
              {p.error}
            </Text>
          )}
          {p.notice !== "" && <Copy>{p.notice}</Copy>}
          {p.loading && <Copy>Loading training partners…</Copy>}
          {p.tab === "Partners" ? (
            <>
              {p.requests.map((person) => (
                <Card key={person.requestId}>
                  <View
                    flexDirection="row"
                    gap={10}
                    alignItems="center"
                    flexWrap="wrap"
                  >
                    <View flex={1} minWidth={140} gap={4}>
                      <Pressable onPress={() => p.onSelect(person)}>
                        <Text fontFamily="$body" color="$text">
                          {name(person)}
                        </Text>
                      </Pressable>
                      <Copy>
                        {person.outgoing
                          ? "Invitation sent"
                          : "Wants to be a training partner"}
                      </Copy>
                    </View>
                    {!person.outgoing && (
                      <View flexDirection="row" gap={4}>
                        <Btn
                          disabled={disabled}
                          variant="ghost"
                          onPress={() =>
                            p.onDecide(person.requestId!, "reject")
                          }
                        >
                          No
                        </Btn>
                        <Btn
                          disabled={disabled}
                          onPress={() =>
                            p.onDecide(person.requestId!, "accept")
                          }
                        >
                          Accept
                        </Btn>
                      </View>
                    )}
                  </View>
                </Card>
              ))}
              <View gap={12}>
                <Text fontFamily="$display" fontSize={11} color="$text3">
                  {p.friends.length} PARTNERS
                </Text>
                {p.friends.length > 0 ? (
                  <View>{p.friends.map(row)}</View>
                ) : (
                  !p.loading && <Copy>No training partners yet.</Copy>
                )}
              </View>
              {!p.embedded && (
                <Copy>
                  Removing a partner hides your partner sessions from them and
                  cancels unused invites and shared plans.
                </Copy>
              )}
              <View
                paddingVertical={12}
                borderTopWidth={1}
                borderColor="$border"
              >
                <View flexDirection="row" gap={12} alignItems="center">
                  <View flex={1}>
                    <Text fontFamily="$body" color="$text">
                      Let people find me by name
                    </Text>
                    {!p.embedded && (
                      <Copy>
                        Off by default. Name and photo only — nothing about your
                        training.
                      </Copy>
                    )}
                    {p.discoverable === null && (
                      <Copy>Current preference unavailable.</Copy>
                    )}
                  </View>
                  <Switch
                    accessibilityLabel="Let people find me by name"
                    value={p.discoverable === true}
                    disabled={disabled || p.discoverable === null}
                    onValueChange={p.onDiscoverable}
                  />
                </View>
              </View>
              {!p.embedded && (
                <Copy>
                  Being partners shares no history, body metrics, food or
                  coaching. Session access never grants permission to log for
                  someone or view their previous numbers.
                </Copy>
              )}
              {p.offers.length > 0 && (
                <>
                  <Text fontFamily="$body" color="$text3">
                    SHARED WORKOUT PLANS
                  </Text>
                  {p.offers.map((offer) => (
                    <Btn
                      key={offer.id}
                      variant="outline"
                      disabled={disabled}
                      onPress={() => p.onOffer(offer)}
                    >
                      Review {offer.plan.name}
                    </Btn>
                  ))}
                </>
              )}
            </>
          ) : (
            <>
              <Text fontFamily="$body" color="$text">
                Find by name
              </Text>
              <TextInput
                accessibilityLabel="Find by name"
                value={p.query}
                onChangeText={p.onQuery}
                placeholder="Search for a training partner"
                placeholderTextColor={theme.text3?.val}
                style={{
                  color: theme.text?.val,
                  backgroundColor: theme.surface2?.val,
                  borderRadius: 12,
                  padding: 14,
                }}
                onSubmitEditing={p.onSearch}
              />
              <Copy>
                Only people who have turned on being findable appear. A name
                alone never reveals somebody who has not.
              </Copy>
              <Btn
                disabled={disabled || p.query.trim().length < 2}
                onPress={p.onSearch}
              >
                Search
              </Btn>
              <Copy>
                or use a partner’s code or QR, including when name search is
                off.
              </Copy>
              <TextInput
                accessibilityLabel="Partner code"
                value={p.code}
                onChangeText={p.onCode}
                autoCapitalize="none"
                autoCorrect={false}
                placeholder="Paste partner code"
                placeholderTextColor={theme.text3?.val}
                style={{
                  color: theme.text?.val,
                  backgroundColor: theme.surface2?.val,
                  borderRadius: 12,
                  padding: 14,
                }}
              />
              <View flexDirection="row" gap={10}>
                <Btn
                  disabled={disabled || p.code.trim().length !== 32}
                  onPress={p.onResolve}
                >
                  Find by code
                </Btn>
                <Btn disabled={disabled} variant="outline" onPress={p.onScan}>
                  Scan QR
                </Btn>
              </View>
              {p.scanner}
              {p.results.map((person) => (
                <Card key={person.userId}>
                  <View gap={10}>
                    {row(person)}
                    <Btn
                      disabled={disabled}
                      onPress={() => p.onRequest(person.userId)}
                    >
                      Invite as training partner
                    </Btn>
                  </View>
                </Card>
              ))}
            </>
          )}
        </View>
      </ScrollView>
      <BottomSheet
        testID="together-partner-code-sheet"
        visible={p.codeVisible}
        onClose={p.onCloseCode}
        title="Your code"
        height="default"
        footer={
          <View gap={8}>
            <View flexDirection="row" gap={8}>
              <View flex={1}>
                <Btn
                  full
                  disabled={disabled}
                  variant="outline"
                  onPress={p.onNewCode}
                >
                  New code
                </Btn>
              </View>
              <View flex={1}>
                <Btn
                  full
                  disabled={disabled || !p.ownCode}
                  onPress={p.onShareCode}
                >
                  Share
                </Btn>
              </View>
            </View>
            <Btn
              full
              size="sm"
              disabled={disabled || !p.ownCode}
              variant="ghost"
              onPress={p.onCopyCode}
            >
              Copy my code
            </Btn>
          </View>
        }
      >
        <View gap={16}>
          {!!p.error && (
            <Text fontFamily="$body" accessibilityRole="alert" color="$warning">
              {p.error}
            </Text>
          )}
          {!p.ownCode && !p.error && <Copy>Preparing your code…</Copy>}
          <Copy>
            Anyone with this can send you a partner request. It never exposes
            your training.
          </Copy>
          {p.ownCode && (
            <>
              {p.qr}
              <Text
                fontFamily="$body"
                selectable
                color="$primary"
                textAlign="center"
                fontSize={16}
                letterSpacing={1}
              >
                {p.ownCode.code}
              </Text>
              <Copy>
                Expires {new Date(p.ownCode.expiresAt).toLocaleDateString()}.
              </Copy>
              <Copy>
                A request still has to be accepted. Sharing a code does not add
                anybody automatically.
              </Copy>
            </>
          )}
        </View>
      </BottomSheet>
      <BottomSheet
        visible={p.selected !== null}
        onClose={() => p.onSelect(null)}
        title={p.selected ? name(p.selected) : "Training partner"}
        height="default"
      >
        {p.selected && (
          <View gap={16}>
            {p.selected.avatarUrl ? (
              <Image
                source={{ uri: p.selected.avatarUrl }}
                style={{
                  width: 72,
                  height: 72,
                  borderRadius: 36,
                  alignSelf: "center",
                }}
                accessibilityLabel={name(p.selected)}
              />
            ) : (
              <View
                width={72}
                height={72}
                borderRadius={36}
                backgroundColor="$surface3"
                alignItems="center"
                justifyContent="center"
                alignSelf="center"
              >
                <Text color="$primary" fontSize={24}>
                  {name(p.selected).slice(0, 1)}
                </Text>
              </View>
            )}
            {!p.selected.displayName?.trim() && (
              <Copy>
                This person has not added a display name yet. Confirm their
                identity with them before accepting.
              </Copy>
            )}
            <Copy>
              Name and photo only. Being partners shares no history, body
              metrics, food or coaching in either direction.
            </Copy>
            {p.friends.some((f) => f.userId === p.selected!.userId) && (
              <>
                <Btn
                  variant="outline"
                  disabled={disabled}
                  onPress={() => p.onRemove(p.selected!.userId)}
                >
                  Remove partner
                </Btn>
                <Copy>Bilateral. Cancels unused invites and plan offers.</Copy>
              </>
            )}
            {p.reporting ? (
              <>
                <Text fontFamily="$body" color="$text">
                  Report privately to the Persistence team
                </Text>
                {(["harassment", "spam", "unsafe", "other"] as const).map(
                  (reason) => (
                    <Btn
                      key={reason}
                      variant="ghost"
                      disabled={disabled}
                      onPress={() => p.onReport(p.selected!.userId, reason)}
                    >
                      Report {reason}
                    </Btn>
                  ),
                )}
                <Btn variant="ghost" onPress={() => p.onReporting(false)}>
                  Cancel report
                </Btn>
              </>
            ) : (
              <Btn
                variant="ghost"
                disabled={disabled}
                onPress={() => p.onReporting(true)}
              >
                Report
              </Btn>
            )}
            <Btn
              variant="outline"
              disabled={disabled}
              onPress={() => p.onBlock(p.selected!.userId)}
            >
              Block
            </Btn>
            <Copy>Immediate. Ends shared access both ways.</Copy>
            <Btn onPress={() => p.onSelect(null)}>Done</Btn>
          </View>
        )}
      </BottomSheet>
      <BottomSheet
        visible={p.selectedOffer !== null}
        onClose={() => p.onOffer(null)}
        title={p.selectedOffer?.plan.name}
        height="default"
      >
        {p.selectedOffer && (
          <View gap={16}>
            <Copy>
              Plan only — no loads or results. Save an independent copy to your
              workouts.
            </Copy>
            <Copy>{p.selectedOffer.plan.exercises.length} exercises</Copy>
            <Btn
              disabled={disabled}
              onPress={() => p.onCopy(p.selectedOffer!.id)}
            >
              Save my own copy
            </Btn>
          </View>
        )}
      </BottomSheet>
    </View>
  );
}
