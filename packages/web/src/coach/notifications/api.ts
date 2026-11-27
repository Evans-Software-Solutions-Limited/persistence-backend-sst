import { createContext, useContext } from "react";
import { coachFetch } from "../api/coachApi";
import type {
  FeedPage,
  NotificationSettings,
  NotificationSettingsInput,
  TodayPayload,
} from "./types";

/**
 * The coach notifications routes (PER-117), for Today, Notifications and
 * notification settings on the web (PER-131). Its own context, like
 * `CoachApiContext`, so tests hand in a fake.
 */

/** The feed keeps the latest 200 (the route's maximum page). */
export const FEED_LIMIT = 200;

type Data<T> = { data: T };

const send = (method: string, body: unknown) => ({
  method,
  body: JSON.stringify(body),
});

export const notificationsApi = {
  feed: () =>
    coachFetch<FeedPage>(`/trainers/me/notifications?limit=${FEED_LIMIT}`),

  markRead: async (ids: string[] | "all") =>
    (
      await coachFetch<Data<{ updated: number }>>(
        "/trainers/me/notifications/read",
        send("POST", ids === "all" ? { all: true } : { ids }),
      )
    ).data.updated,

  today: async () =>
    (await coachFetch<Data<TodayPayload>>("/trainers/me/today")).data,

  actioned: async (eventId: string) =>
    (
      await coachFetch<Data<{ eventId: string; actionedAt: string }>>(
        `/trainers/me/today/${encodeURIComponent(eventId)}/actioned`,
        send("POST", {}),
      )
    ).data,

  settings: async () =>
    (
      await coachFetch<Data<NotificationSettings>>(
        "/trainers/me/notification-settings",
      )
    ).data,

  putSettings: async (input: NotificationSettingsInput) =>
    (
      await coachFetch<Data<NotificationSettings>>(
        "/trainers/me/notification-settings",
        send("PUT", input),
      )
    ).data,
};

export type NotificationsApi = typeof notificationsApi;

export const NotificationsApiContext =
  createContext<NotificationsApi>(notificationsApi);

export function useNotificationsApi(): NotificationsApi {
  return useContext(NotificationsApiContext);
}
