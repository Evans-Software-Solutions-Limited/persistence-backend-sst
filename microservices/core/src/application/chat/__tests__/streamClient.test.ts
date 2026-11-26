import { describe, expect, it } from "vitest";
import {
  BUILT_IN_CHANNEL_TYPES,
  COACHING_GRANTS,
  LOCKED_TYPE_GRANTS,
  STREAM_CHANNEL_TYPE,
  getStreamConfig,
  isNotFound,
  STREAM_API_BASE,
  StreamApiError,
  StreamChatClient,
  streamClientFromEnv,
  USER_TOKEN_TTL_MS,
  type FetchLike,
} from "../streamClient";
import {
  FakeStream,
  TEST_STREAM_KEY,
  TEST_STREAM_SECRET,
  verifyHs256,
} from "./fakeStream";

const config = { apiKey: TEST_STREAM_KEY, apiSecret: TEST_STREAM_SECRET };

describe("getStreamConfig: empty means chat not configured", () => {
  it("is null when either key is missing, empty or blank", () => {
    expect(getStreamConfig({})).toBeNull();
    expect(getStreamConfig({ STREAM_API_KEY: "k" })).toBeNull();
    expect(getStreamConfig({ STREAM_API_SECRET: "s" })).toBeNull();
    expect(
      getStreamConfig({ STREAM_API_KEY: "", STREAM_API_SECRET: "" }),
    ).toBeNull();
    expect(
      getStreamConfig({ STREAM_API_KEY: " ", STREAM_API_SECRET: "s" }),
    ).toBeNull();
    expect(streamClientFromEnv({})).toBeNull();
  });

  it("returns trimmed keys when both are set", () => {
    expect(
      getStreamConfig({ STREAM_API_KEY: " k ", STREAM_API_SECRET: " s " }),
    ).toEqual({ apiKey: "k", apiSecret: "s" });
    const client = streamClientFromEnv({
      STREAM_API_KEY: "k",
      STREAM_API_SECRET: "s",
    });
    expect(client).toBeInstanceOf(StreamChatClient);
    expect(client!.apiKey).toBe("k");
  });
});

describe("StreamChatClient", () => {
  it("mints a 24-hour HS256 user token for exactly the given user", async () => {
    const client = new StreamChatClient(config);
    const now = new Date("2026-11-25T10:00:00Z");
    const { token, expiresAt } = await client.createUserToken("user-1", now);
    expect(expiresAt.getTime() - now.getTime()).toBe(USER_TOKEN_TTL_MS);
    const payload = verifyHs256(token, TEST_STREAM_SECRET, now);
    expect(() => verifyHs256(token, "another-secret-entirely-0000")).toThrow();
    expect(payload.user_id).toBe("user-1");
    expect(payload.exp).toBe(expiresAt.getTime() / 1000);
  });

  it("sends server-token-authenticated requests with the api key", async () => {
    const seen: { url: string; init: RequestInit }[] = [];
    const fetchImpl: FetchLike = async (url, init) => {
      seen.push({ url, init });
      return { ok: true, status: 201, text: async () => "" };
    };
    const client = new StreamChatClient(config, fetchImpl);
    await client.upsertUsers([
      { id: "a", name: "Ana", image: "https://x/a.png" },
      { id: "b" },
    ]);
    expect(seen[0]!.url).toBe(
      `${STREAM_API_BASE}/users?api_key=${TEST_STREAM_KEY}`,
    );
    const headers = seen[0]!.init.headers as Record<string, string>;
    expect(headers["stream-auth-type"]).toBe("jwt");
    expect(verifyHs256(headers.Authorization!, TEST_STREAM_SECRET)).toEqual({
      server: true,
    });
    expect(JSON.parse(seen[0]!.init.body as string)).toEqual({
      users: {
        a: { id: "a", name: "Ana", image: "https://x/a.png" },
        b: { id: "b" },
      },
    });
    await client.upsertUsers([]);
    expect(seen).toHaveLength(1);
  });

  it("creates, updates members, freezes and messages a channel", async () => {
    const stream = new FakeStream();
    const client = new StreamChatClient(config, stream.fetch);
    await client.ensureChannelType();
    await client.upsertUsers([{ id: "coach" }, { id: "athlete" }]);
    await client.getOrCreateChannel("coach-1", "coach", ["coach", "athlete"]);
    await client.getOrCreateChannel("coach-1", "coach", ["coach", "athlete"]);
    expect(stream.channels.size).toBe(1);
    expect(
      await client.sendMessage("coach-1", {
        id: "m1",
        text: "hi",
        userId: "coach",
      }),
    ).toBe("sent");
    // The same id again is "already sent", not an error.
    expect(
      await client.sendMessage("coach-1", {
        id: "m1",
        text: "hi",
        userId: "coach",
      }),
    ).toBe("duplicate");
    await client.removeMembers("coach-1", ["athlete"]);
    await client.setFrozen("coach-1", true);
    const ch = stream.channels.get("coach-1")!;
    expect([...ch.members]).toEqual(["coach"]);
    expect(ch.frozen).toBe(true);
    await client.addMembers("coach-1", ["athlete"]);
    await client.setFrozen("coach-1", false);
    expect([...ch.members].sort()).toEqual(["athlete", "coach"]);
    expect(ch.frozen).toBe(false);
  });

  it("other message errors still throw", async () => {
    const stream = new FakeStream();
    const client = new StreamChatClient(config, stream.fetch);
    await client.ensureChannelType();
    await expect(
      client.sendMessage("nope", { id: "m", text: "t", userId: "u" }),
    ).rejects.toSatisfy((e: unknown) => isNotFound(e));
  });

  it("turns HTTP errors into StreamApiError with Stream's code", async () => {
    const client = new StreamChatClient(config, async () => ({
      ok: false,
      status: 400,
      text: async () => JSON.stringify({ code: 4, message: "bad input" }),
    }));
    const err = await client.setFrozen("c", true).then(
      () => null,
      (e: unknown) => e as StreamApiError,
    );
    expect(err).toBeInstanceOf(StreamApiError);
    expect(err).toMatchObject({ status: 400, code: 4 });
    expect(err!.message).toContain("bad input");
    expect(isNotFound(err)).toBe(false);
  });

  it("copes with a non-JSON error body and a network failure", async () => {
    const htmlError = new StreamChatClient(config, async () => ({
      ok: false,
      status: 502,
      text: async () => "<html>bad gateway</html>",
    }));
    await expect(htmlError.addMembers("c", ["u"])).rejects.toMatchObject({
      status: 502,
      code: null,
    });
    const offline = new StreamChatClient(config, async () => {
      throw new Error("ECONNRESET");
    });
    await expect(offline.removeMembers("c", ["u"])).rejects.toMatchObject({
      status: 0,
      message: expect.stringContaining("ECONNRESET"),
    });
    const weird = new StreamChatClient(config, async () => {
      throw "boom";
    });
    await expect(weird.removeMembers("c", ["u"])).rejects.toMatchObject({
      message: expect.stringContaining("boom"),
    });
  });

  it("ensures the coaching channel type: members read and write; nobody but the server creates channels or changes members", async () => {
    const stream = new FakeStream();
    const client = new StreamChatClient(config, stream.fetch);
    expect(STREAM_CHANNEL_TYPE).toBe("coaching");
    // A channel can't be made in a type that doesn't exist yet.
    await client.upsertUsers([{ id: "coach" }]);
    await expect(
      client.getOrCreateChannel("coach-1", "coach", ["coach"]),
    ).rejects.toMatchObject({ status: 400 });

    await client.ensureChannelType();
    await client.ensureChannelType(); // idempotent: exists → grants set again
    const grants = stream.channelTypes.get("coaching")!.grants;
    expect(grants).toEqual(COACHING_GRANTS);
    for (const role of ["user", "guest", "anonymous"]) {
      expect(grants[role]).toEqual([]);
    }
    const member = grants.channel_member!;
    expect(member).toEqual(
      expect.arrayContaining(["read-channel", "create-message"]),
    );
    for (const forbidden of [
      "create-channel",
      "update-channel",
      "update-channel-members",
      "delete-channel",
      "remove-own-channel-membership",
      "update-channel-frozen",
    ]) {
      expect(member).not.toContain(forbidden);
    }
    const creates = stream.calls.filter((c) => c.path === "/channeltypes");
    expect(creates[0]!.body).toMatchObject({ name: "coaching" });
  });

  it("strips user, guest and anonymous grants from every built-in type, so no type lets a token create channels", async () => {
    const stream = new FakeStream();
    const client = new StreamChatClient(config, stream.fetch);
    expect(stream.channelTypes.get("messaging")!.grants.user).toContain(
      "create-channel",
    );
    await client.ensureChannelType();
    expect([...BUILT_IN_CHANNEL_TYPES]).toEqual([
      "messaging",
      "team",
      "livestream",
      "gaming",
      "commerce",
    ]);
    for (const type of [...BUILT_IN_CHANNEL_TYPES, STREAM_CHANNEL_TYPE]) {
      const grants = stream.channelTypes.get(type)!.grants;
      for (const role of ["user", "guest", "anonymous"]) {
        expect(grants[role], `${type}/${role}`).toEqual([]);
      }
    }
    // Other roles on built-in types are left alone.
    expect(stream.channelTypes.get("team")!.grants.channel_member).toEqual([
      "read-channel",
      "create-message",
    ]);
    expect(LOCKED_TYPE_GRANTS).toEqual({ user: [], guest: [], anonymous: [] });
  });

  it("a built-in type the app doesn't have is skipped; other failures throw", async () => {
    const stream = new FakeStream();
    stream.channelTypes.delete("gaming");
    const client = new StreamChatClient(config, stream.fetch);
    await client.ensureChannelType();
    expect(stream.channelTypes.get("commerce")!.grants.user).toEqual([]);
    stream.failOn(/PUT \/channeltypes\/livestream/);
    await expect(client.ensureChannelType()).rejects.toMatchObject({
      status: 503,
    });
  });

  it("a failed channel type create (other than 'already exists') throws", async () => {
    const stream = new FakeStream();
    stream.failOn(/POST \/channeltypes/);
    const client = new StreamChatClient(config, stream.fetch);
    await expect(client.ensureChannelType()).rejects.toMatchObject({
      status: 503,
    });
  });

  it("hard-deletes a user with their messages and waits for the task", async () => {
    const stream = new FakeStream();
    const client = new StreamChatClient(config, stream.fetch);
    await client.ensureChannelType();
    await client.upsertUsers([{ id: "coach" }, { id: "athlete" }]);
    await client.getOrCreateChannel("coach-1", "coach", ["coach", "athlete"]);
    await client.sendMessage("coach-1", {
      id: "a1",
      text: "x",
      userId: "athlete",
    });
    await client.sendMessage("coach-1", {
      id: "c1",
      text: "y",
      userId: "coach",
    });
    expect(await client.deleteUserHard("athlete")).toBe("deleted");
    const del = stream.calls.find((c) => c.path === "/users/delete")!;
    expect(del.body).toEqual({
      user_ids: ["athlete"],
      user: "hard",
      messages: "hard",
      conversations: "keep",
    });
    expect(stream.channels.get("coach-1")!.messages.map((m) => m.id)).toEqual([
      "c1",
    ]);
    // Again: Stream no longer has the user, which counts as done.
    expect(await client.deleteUserHard("athlete")).toBe("not_found");
  });

  it("a failed delete task throws; one still running is reported pending", async () => {
    const stream = new FakeStream();
    const client = new StreamChatClient(config, stream.fetch);
    const sleep = async () => {};
    await client.upsertUsers([{ id: "u1" }, { id: "u2" }]);
    stream.taskStatus = "failed";
    await expect(client.deleteUserHard("u1", { sleep })).rejects.toThrow(
      /task task-1 failed: boom/,
    );
    stream.taskStatus = "running";
    expect(await client.deleteUserHard("u2", { sleep, polls: 2 })).toBe(
      "pending",
    );
    stream.failOn(/POST \/users\/delete/);
    await expect(client.deleteUserHard("u3")).rejects.toMatchObject({
      status: 503,
    });
  });

  it("a delete with no task id counts as done; a failed task without detail still throws", async () => {
    const replies = [
      { ok: true, status: 201, text: async () => "{}" },
      { ok: true, status: 201, text: async () => '{"task_id":"t"}' },
      { ok: true, status: 200, text: async () => '{"status":"failed"}' },
    ];
    const client = new StreamChatClient(config, async () => replies.shift()!);
    expect(await client.deleteUserHard("u")).toBe("deleted");
    await expect(
      client.deleteUserHard("u", { sleep: async () => {} }),
    ).rejects.toThrow(/failed: unknown/);
  });

  it("isNotFound recognises a 404 and Stream's code 16 only", () => {
    expect(isNotFound(new StreamApiError("x", 404))).toBe(true);
    expect(isNotFound(new StreamApiError("x", 400, 16))).toBe(true);
    expect(isNotFound(new StreamApiError("x", 500))).toBe(false);
    expect(isNotFound(new Error("x"))).toBe(false);
  });
});
