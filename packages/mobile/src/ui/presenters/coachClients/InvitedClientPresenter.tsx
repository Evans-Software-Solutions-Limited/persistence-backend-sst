import type { ReactNode } from "react";
import { Pressable, RefreshControl, ScrollView } from "react-native";
import { Text, View } from "@tamagui/core";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  IconClipboard,
  IconDumbbell,
  IconFlame,
  IconLock,
  IconMail,
  IconNote,
} from "@/ui/components/icons";
import type { SetupSection } from "@/domain/models/coachClientProfiles";
import {
  CLIENT_TABS,
  CLIENT_TAB_LABELS,
} from "@/ui/presenters/coachForms/ClientTabStrip";
import { ListRow, Note } from "@/ui/presenters/coachForms/kit";
import {
  ErrorLine,
  GhostButton,
  PrimaryButton,
  TopBar,
  UpdatedElsewhere,
} from "./kit";

/**
 * C11i — the invited client. It looks like their client page, but only
 * Overview is open: the other tabs show a lock until they accept (Brad,
 * 18 Nov). Overview is what's ready (tap a row to change it, same pages as
 * C11l–r) and the private notes; Resend invite, Copy link, Cancel invite.
 */
export type InvitedRow = { section: SetupSection; title: string; sub: string };

export type InvitedClientPresenterProps = {
  name: string;
  initials: string;
  goal: string | null;
  clientFirst: string;
  rows: readonly InvitedRow[];
  canAddMore: boolean;
  notes: string | null;
  inviteLine: string;
  cancelled: boolean;
  offline: boolean;
  busy: boolean;
  error: string | null;
  linkCopied: boolean;
  conflict: boolean;
  isRefreshing: boolean;
  onRefresh: () => void;
  onBack: () => void;
  onOpen: (section: SetupSection) => void;
  onAddMore: () => void;
  onEditDetails: () => void;
  onResend: () => void;
  onCopyLink: () => void;
  onCancelInvite: () => void;
  onDismissConflict: () => void;
  declaration: ReactNode;
};

const ICON: Partial<Record<SetupSection, ReactNode>> = {
  starter_form: <IconClipboard size={18} color="#A78BFA" />,
  repeating_form: <IconClipboard size={18} color="#A78BFA" />,
  programme: <IconDumbbell size={18} color="#A78BFA" />,
  nutrition_target: <IconFlame size={18} color="#A78BFA" />,
  meal_plan: <IconFlame size={18} color="#A78BFA" />,
  resource: <IconNote size={18} color="#A78BFA" />,
  welcome_message: <IconMail size={18} color="#A78BFA" />,
};

function LockedTabs() {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{
        gap: 2,
        borderBottomWidth: 1,
        borderBottomColor: "rgba(255,255,255,0.08)",
        flexGrow: 1,
      }}
      accessibilityRole="tablist"
      testID="invited-tabs"
    >
      {CLIENT_TABS.map((tab) => {
        const open = tab === "overview";
        return (
          <View
            key={tab}
            height={36}
            paddingHorizontal={8}
            flexDirection="row"
            alignItems="center"
            gap={4}
            borderBottomWidth={2}
            borderBottomColor={open ? "#A78BFA" : "transparent"}
            accessibilityRole="tab"
            accessibilityState={{ selected: open, disabled: !open }}
            accessibilityLabel={
              open
                ? CLIENT_TAB_LABELS[tab]
                : `${CLIENT_TAB_LABELS[tab]}, opens when they accept`
            }
            testID={`invited-tab-${tab}`}
          >
            {open ? null : <IconLock size={12} color="#5C5C68" />}
            <Text
              fontFamily="$body"
              fontWeight="600"
              fontSize={13}
              color={open ? "$text" : "$text4"}
            >
              {CLIENT_TAB_LABELS[tab]}
            </Text>
          </View>
        );
      })}
    </ScrollView>
  );
}

export function InvitedClientPresenter(p: InvitedClientPresenterProps) {
  const insets = useSafeAreaInsets();
  return (
    <View flex={1} paddingTop={insets.top} testID="invited-client">
      <TopBar backLabel="Clients" onBack={p.onBack} testID="invited" />
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 120 }}
        refreshControl={
          <RefreshControl refreshing={p.isRefreshing} onRefresh={p.onRefresh} />
        }
      >
        <View flexDirection="row" gap={12} alignItems="center">
          <View
            width={40}
            height={40}
            borderRadius={9999}
            backgroundColor="rgba(244,114,182,0.14)"
            alignItems="center"
            justifyContent="center"
            accessibilityElementsHidden
          >
            <Text
              fontFamily="$body"
              fontWeight="700"
              fontSize={13}
              color="#F9A8D4"
            >
              {p.initials}
            </Text>
          </View>
          <Pressable
            onPress={p.onEditDetails}
            accessibilityRole="button"
            accessibilityLabel={`Edit ${p.name}'s details`}
            style={{ flex: 1 }}
            testID="invited-details"
          >
            <Text
              fontFamily="$body"
              fontWeight="800"
              fontSize={19}
              lineHeight={24}
              color="$text"
            >
              {p.name}
            </Text>
            {p.goal ? (
              <Text fontFamily="$body" fontSize={12} color="$text3">
                {p.goal}
              </Text>
            ) : null}
          </Pressable>
          <View
            height={22}
            paddingHorizontal={8}
            borderRadius={9999}
            backgroundColor="rgba(255,255,255,0.06)"
            flexDirection="row"
            alignItems="center"
            gap={4}
            testID="invited-pill"
          >
            <IconMail size={12} color="#C2C2CE" />
            <Text
              fontFamily="$body"
              fontWeight="600"
              fontSize={11}
              color="$text2"
            >
              {p.cancelled ? "Cancelled" : "Invited"}
            </Text>
          </View>
        </View>
        <View marginTop={10}>
          <LockedTabs />
        </View>
        {p.conflict ? (
          <UpdatedElsewhere
            onDismiss={p.onDismissConflict}
            testID="invited-conflict"
          />
        ) : null}
        {p.offline ? (
          <Note testID="invited-offline">
            You&apos;re offline. Changes are saved on this phone; Resend, Copy
            link and Cancel invite wait for a connection.
          </Note>
        ) : null}
        <View flexDirection="row" gap={8} marginTop={12}>
          <View flex={1}>
            <PrimaryButton
              label={p.cancelled ? "Send a new invite" : "Resend invite"}
              onPress={p.onResend}
              disabled={p.busy || p.offline}
              testID="invited-resend"
            />
          </View>
          <GhostButton
            label={p.linkCopied ? "Copied" : "Copy link"}
            onPress={p.onCopyLink}
            disabled={p.busy || p.offline || p.cancelled}
            height={52}
            full
            testID="invited-copy-link"
          />
        </View>
        <Text
          fontFamily="$body"
          fontSize={12}
          color="$text3"
          marginTop={6}
          testID="invited-invite-line"
        >
          {p.inviteLine}
        </Text>
        {p.error ? (
          <ErrorLine testID="invited-error">{p.error}</ErrorLine>
        ) : null}
        <View
          flexDirection="row"
          alignItems="center"
          marginTop={12}
          paddingTop={12}
          borderTopWidth={1}
          borderTopColor="$border2"
        >
          <Text
            flex={1}
            fontFamily="$body"
            fontWeight="600"
            fontSize={14.5}
            color="$text"
          >
            {`Ready when ${p.clientFirst} accepts`}
          </Text>
        </View>
        {p.rows.length === 0 ? (
          <Text
            fontFamily="$body"
            fontSize={13}
            color="$text3"
            marginTop={8}
            testID="invited-empty"
          >
            Nothing set up yet.
          </Text>
        ) : null}
        {p.rows.map((r) => (
          <ListRow
            key={r.section}
            title={r.title}
            subtitle={r.sub}
            leading={ICON[r.section]}
            onPress={() => p.onOpen(r.section)}
            accessibilityLabel={`Change ${r.title}`}
            testID={`invited-row-${r.section}`}
          />
        ))}
        {p.canAddMore ? (
          <Pressable
            onPress={p.onAddMore}
            accessibilityRole="button"
            testID="invited-add-more"
            style={{ minHeight: 44, justifyContent: "center" }}
          >
            <Text
              fontFamily="$body"
              fontWeight="600"
              fontSize={13}
              color="$accentTrainer"
            >
              + Add to the set-up
            </Text>
          </Pressable>
        ) : null}
        <ListRow
          title="Private notes"
          subtitle={p.notes ?? "Add a note only you see"}
          leading={<IconNote size={18} color="#A78BFA" />}
          onPress={p.onEditDetails}
          testID="invited-notes"
        />
        {!p.cancelled ? (
          <Pressable
            onPress={p.onCancelInvite}
            disabled={p.busy}
            accessibilityRole="button"
            testID="invited-cancel"
            style={{ minHeight: 44, justifyContent: "center", marginTop: 8 }}
          >
            <Text
              fontFamily="$body"
              fontWeight="600"
              fontSize={13}
              color="#FCA5A5"
            >
              Cancel invite
            </Text>
          </Pressable>
        ) : null}
      </ScrollView>
      {p.declaration}
    </View>
  );
}
