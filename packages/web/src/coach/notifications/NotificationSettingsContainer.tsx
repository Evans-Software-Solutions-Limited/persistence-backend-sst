import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { useQueryClient } from "@tanstack/react-query";
import { applyValues, fieldMessages } from "@/lib/form";
import { isCoachApiError } from "../api/coachApi";
import { useOnline } from "../hooks/coachQueries";
import { CONFLICT_NOTICE } from "../lib/draft";
import { LoadError, Loading } from "../ui/parts";
import { useNotificationsApi } from "./api";
import { CHANNEL_LABELS, SETTINGS_ROWS, channelOptions, clock } from "./lib";
import { notificationKeys, useNotificationSettings } from "./queries";
import {
  DEFAULT_QUIET,
  notificationSettingsResolver,
  quietInput,
  quietServerError,
  settingsToValues,
  type NotificationSettingsValues,
} from "./settingsForm";
import type {
  Channel,
  NotificationSettings,
  NotificationSettingsInput,
} from "./types";
import { NotificationSettingsView } from "./NotificationSettingsView";
import "./notifications.css";

type TimeField = "quietFrom" | "quietUntil";

/**
 * Container for C6b (PER-131): `GET/PUT /trainers/me/notification-settings`.
 * Every change is checked by the form's resolver, then saved with the
 * settings' revision. A 409 loads the server's copy and says so; a 400 about
 * quiet hours lands on the time field.
 *
 * Saves run one at a time, each with the revision the previous one returned,
 * so two quick changes never conflict with each other. Time fields save when
 * the coach leaves the field, not on each keystroke (Inspector Brad, #578).
 */
export function NotificationSettingsContainer() {
  const api = useNotificationsApi();
  const queryClient = useQueryClient();
  const online = useOnline();
  const q = useNotificationSettings();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const form = useForm<NotificationSettingsValues>({
    resolver: notificationSettingsResolver,
  });

  /** The time field the coach is typing in, if any. */
  const focused = useRef<TimeField | null>(null);

  /**
   * Show the server's copy whenever it changes (a save landing, a refetch, a
   * 409's current copy), so nothing stays dirty and a stale value is never
   * sent later (Inspector Brad, #578). Only the time field the coach is
   * typing in keeps what they've typed; it saves when they leave it.
   */
  const data = q.data;
  useEffect(() => {
    if (!data) return;
    const next = settingsToValues(data);
    const typing = focused.current;
    if (typing) next[typing] = form.getValues(typing);
    form.reset(next, { keepErrors: true });
  }, [data, form]);

  const queue = useRef<Promise<void>>(Promise.resolve());
  const pending = useRef(0);

  /** Queue a save behind any save already in flight. */
  function save(input: NotificationSettingsInput): Promise<void> {
    pending.current += 1;
    setBusy(true);
    const run = queue.current.then(() => saveNow(input));
    queue.current = run.finally(() => {
      pending.current -= 1;
      if (pending.current === 0) setBusy(false);
    });
    return queue.current;
  }

  async function saveNow(input: NotificationSettingsInput) {
    // The newest copy: a save that just finished has put its revision here.
    const before = queryClient.getQueryData<NotificationSettings>(
      notificationKeys.settings,
    );
    if (!before) return;
    setError(null);
    setNotice(null);
    try {
      const saved = await api.putSettings({
        ...input,
        expectedRevision: before.revision,
      });
      queryClient.setQueryData(notificationKeys.settings, saved);
    } catch (e) {
      if (isCoachApiError(e) && e.code === "revision_conflict") {
        const latest = e.body?.current as NotificationSettings | undefined;
        queryClient.setQueryData(notificationKeys.settings, latest ?? before);
        form.reset(settingsToValues(latest ?? before));
        if (!latest) void q.refetch();
        setNotice(CONFLICT_NOTICE);
        return;
      }
      // Put the form back to what's saved, keeping a field error if any.
      form.reset(settingsToValues(before), { keepErrors: true });
      const onField = quietServerError(e);
      if (onField) {
        form.setError(onField.field, {
          type: "server",
          message: onField.message,
        });
        return;
      }
      setError(
        isCoachApiError(e) && e.offline
          ? "You're offline. Settings change when you're back online."
          : "We couldn't save that change.",
      );
    }
  }

  async function change(
    next: Partial<NotificationSettingsValues>,
    input: (v: NotificationSettingsValues) => NotificationSettingsInput,
  ) {
    const values = { ...form.getValues(), ...next };
    applyValues(form, values);
    form.clearErrors();
    if (!(await form.trigger())) return;
    await save(input(values));
  }

  if (q.isPending) return <Loading />;
  if (!q.data) {
    return (
      <LoadError
        message={
          online
            ? "We couldn't load your notification settings."
            : "You're offline. Settings load when you're back online."
        }
        onRetry={() => void q.refetch()}
      />
    );
  }

  const s = q.data;
  // Before the form has taken the loaded values, show them as loaded.
  const values = { ...settingsToValues(s), ...form.watch() };
  const channels = values.channels;
  return (
    <NotificationSettingsView
      rows={SETTINGS_ROWS.map((r) => {
        const value: Channel = channels[r.kind] ?? s.defaults[r.kind];
        return {
          kind: r.kind,
          label: r.label,
          value,
          options: channelOptions(s.emailAvailable, value).map((c) => ({
            value: c,
            label: CHANNEL_LABELS[c],
          })),
        };
      })}
      quietEnabled={values.quietEnabled}
      quietFrom={values.quietFrom}
      quietUntil={values.quietUntil}
      errors={fieldMessages(form.formState.errors, ["quietFrom", "quietUntil"])}
      timeZone={s.timeZone}
      emailAvailable={s.emailAvailable}
      busy={busy}
      offlineAsOf={online ? null : clock(new Date(q.dataUpdatedAt))}
      notice={notice}
      error={error}
      onChannel={(kind, channel) =>
        void change({ channels: { ...channels, [kind]: channel } }, () => ({
          channels: { [kind]: channel },
        }))
      }
      onQuietEnabled={(on) => {
        const v = form.getValues();
        void change(
          on
            ? {
                quietEnabled: true,
                quietFrom: v.quietFrom || DEFAULT_QUIET.from,
                quietUntil: v.quietUntil || DEFAULT_QUIET.until,
              }
            : { quietEnabled: false },
          quietInput,
        );
      }}
      onQuietTimeFocus={(field) => {
        focused.current = field;
      }}
      onQuietTime={(field, value) => {
        applyValues(form, { ...form.getValues(), [field]: value });
        form.clearErrors(field);
      }}
      onQuietTimeDone={() => {
        focused.current = null;
        const v = form.getValues();
        const saved = s.quietHours;
        if (
          v.quietFrom === (saved.from ?? "") &&
          v.quietUntil === (saved.until ?? "")
        ) {
          return;
        }
        void change({}, quietInput);
      }}
    />
  );
}
