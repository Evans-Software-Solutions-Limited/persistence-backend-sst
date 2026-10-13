import { InMemoryApiAdapter } from "@/adapters/api/__tests__/in-memory-api.adapter";
import { InMemoryStorageAdapter } from "@/adapters/storage/__tests__/in-memory-storage.adapter";
import { fail, ok } from "@/shared/errors";
import { fetchUnreadCount } from "../unread-count";
import { makeNotification } from "./notification.fixture";

describe("fetchUnreadCount", () => {
  it("coalesces concurrent callers onto one request and separates later ones", async () => {
    const api = new InMemoryApiAdapter();
    const storage = new InMemoryStorageAdapter();
    const spy = jest.spyOn(api, "getNotifications").mockResolvedValue(
      ok({
        notifications: [makeNotification({ id: "n1", readAt: null })],
        unreadCount: 3,
        nextCursor: null,
      }),
    );
    const [a, b, c] = await Promise.all([
      fetchUnreadCount(api, storage),
      fetchUnreadCount(api, storage),
      fetchUnreadCount(api, storage),
    ]);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith({ unreadOnly: true });
    expect([a, b, c]).toEqual([3, 3, 3]);

    await fetchUnreadCount(api, storage);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("resolves null when the request fails so callers keep their last value", async () => {
    const api = new InMemoryApiAdapter();
    const storage = new InMemoryStorageAdapter();
    jest
      .spyOn(api, "getNotifications")
      .mockResolvedValue(
        fail({ kind: "api", code: "server", message: "503", status: 503 }),
      );
    await expect(fetchUnreadCount(api, storage)).resolves.toBeNull();
  });
});
