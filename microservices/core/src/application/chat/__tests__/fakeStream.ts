import { createHmac, timingSafeEqual } from "node:crypto";
import type { FetchLike } from "../streamClient";

/**
 * An in-memory stand-in for Stream's REST API (PER-120 tests). It answers the
 * calls `StreamChatClient` makes, checks every request carries a server token
 * signed with the test secret, and records state the tests assert on:
 * users, channels (members, frozen) and messages in order. Never the network.
 */

export const TEST_STREAM_KEY = "test-stream-key";
export const TEST_STREAM_SECRET = "test-stream-secret-not-real-000000";

/**
 * Verify a compact HS256 JWT (node:crypto, so the tests need no `jose`).
 * Returns the payload, or throws when the signature or expiry is wrong.
 */
export function verifyHs256(
  token: string,
  secret: string,
  now: Date = new Date(),
): Record<string, unknown> {
  const [header, payload, signature] = token.split(".");
  if (!header || !payload || !signature) throw new Error("malformed token");
  const decodedHeader = JSON.parse(
    Buffer.from(header, "base64url").toString("utf8"),
  ) as { alg?: string };
  if (decodedHeader.alg !== "HS256") throw new Error("not HS256");
  const expected = createHmac("sha256", secret)
    .update(`${header}.${payload}`)
    .digest();
  const given = Buffer.from(signature, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    throw new Error("bad signature");
  }
  const claims = JSON.parse(
    Buffer.from(payload, "base64url").toString("utf8"),
  ) as Record<string, unknown>;
  if (typeof claims.exp === "number" && claims.exp * 1000 < now.getTime()) {
    throw new Error("expired");
  }
  return claims;
}

export interface FakeChannel {
  createdBy: string;
  members: Set<string>;
  frozen: boolean;
  messages: { id: string; text: string; userId: string }[];
}

export interface FakeCall {
  method: string;
  path: string;
  body: Record<string, unknown>;
}

export class FakeStream {
  users = new Map<string, { id: string; name?: string; image?: string }>();
  channels = new Map<string, FakeChannel>();
  calls: FakeCall[] = [];
  /** Channel types and the grants per role set on each. */
  channelTypes = new Map<string, { grants: Record<string, string[]> }>();
  /** Hard-deleted users (`POST /users/delete`). */
  deletedUsers: string[] = [];
  /** Status the user-delete task reports (`completed` by default). */
  taskStatus: "completed" | "failed" | "running" = "completed";
  /** Every call fails with a 500 while true. */
  down = false;
  /** Fail calls whose "METHOD path" matches, `times` times (default always). */
  private failures: { match: RegExp; times: number }[] = [];

  failOn(match: RegExp, times = Infinity): void {
    this.failures.push({ match, times });
  }

  reset(): void {
    this.users.clear();
    this.channels.clear();
    this.channelTypes.clear();
    this.deletedUsers = [];
    this.taskStatus = "completed";
    this.calls = [];
    this.down = false;
    this.failures = [];
  }

  fetch: FetchLike = async (input, init) => {
    const url = new URL(input);
    const method = init.method ?? "GET";
    const path = url.pathname;
    const body = (init.body ? JSON.parse(init.body as string) : {}) as Record<
      string,
      unknown
    >;
    this.calls.push({ method, path, body });
    const headers = init.headers as Record<string, string>;
    if (
      url.searchParams.get("api_key") !== TEST_STREAM_KEY ||
      headers["stream-auth-type"] !== "jwt"
    ) {
      return reply(401, { code: 5, message: "bad api key" });
    }
    try {
      const payload = verifyHs256(headers.Authorization!, TEST_STREAM_SECRET);
      if (payload.server !== true) throw new Error("not a server token");
    } catch {
      return reply(401, { code: 5, message: "bad server token" });
    }
    if (this.down) return reply(500, { code: -1, message: "down" });
    const failure = this.failures.find(
      (f) => f.times > 0 && f.match.test(`${method} ${path}`),
    );
    if (failure) {
      failure.times -= 1;
      return reply(503, { code: -1, message: "injected failure" });
    }

    if (method === "POST" && path === "/users") {
      for (const u of Object.values(
        body.users as Record<string, { id: string }>,
      )) {
        this.users.set(u.id, u);
      }
      return reply(201, { users: body.users });
    }
    if (method === "POST" && path === "/channeltypes") {
      const name = body.name as string;
      if (this.channelTypes.has(name)) {
        return reply(400, {
          code: 4,
          message: `channel type ${name} already exists`,
        });
      }
      this.channelTypes.set(name, { grants: {} });
      return reply(201, { name });
    }
    const typeMatch = /^\/channeltypes\/([^/]+)$/.exec(path);
    if (method === "PUT" && typeMatch) {
      const type = this.channelTypes.get(typeMatch[1]!);
      if (!type) return reply(404, { code: 16, message: "no such type" });
      Object.assign(type.grants, body.grants as Record<string, string[]>);
      return reply(201, {});
    }
    if (method === "POST" && path === "/users/delete") {
      const ids = body.user_ids as string[];
      if (!ids.some((u) => this.users.has(u))) {
        return reply(404, { code: 16, message: "user does not exist" });
      }
      for (const u of ids) {
        this.users.delete(u);
        this.deletedUsers.push(u);
        for (const ch of this.channels.values()) {
          ch.members.delete(u);
          ch.messages = ch.messages.filter((x) => x.userId !== u);
        }
      }
      return reply(201, { task_id: "task-1" });
    }
    if (method === "GET" && path.startsWith("/tasks/")) {
      return reply(200, {
        status: this.taskStatus,
        ...(this.taskStatus === "failed"
          ? { error: { description: "boom" } }
          : {}),
      });
    }
    const m = /^\/channels\/([^/]+)\/([^/]+)(\/query|\/message)?$/.exec(path);
    if (!m) return reply(404, { code: 16, message: "unknown route" });
    if (!this.channelTypes.has(m[1]!)) {
      return reply(400, { code: 4, message: `channel type ${m[1]} unknown` });
    }
    const id = decodeURIComponent(m[2]!);
    const channel = this.channels.get(id);

    if (m[3] === "/query") {
      if (!channel) {
        const data = body.data as { created_by_id: string; members: string[] };
        for (const member of data.members) {
          if (!this.users.has(member)) {
            return reply(400, { code: 4, message: `user ${member} missing` });
          }
        }
        this.channels.set(id, {
          createdBy: data.created_by_id,
          members: new Set(data.members),
          frozen: false,
          messages: [],
        });
      }
      return reply(201, { channel: { id } });
    }
    if (!channel) {
      return reply(404, { code: 16, message: `channel ${id} does not exist` });
    }
    if (m[3] === "/message") {
      const msg = body.message as { id: string; text: string; user_id: string };
      if (channel.frozen) {
        return reply(403, { code: 17, message: "channel is frozen" });
      }
      if (this.allMessages().some((x) => x.id === msg.id)) {
        return reply(400, {
          code: 4,
          message: `a message with ID ${msg.id} already exists`,
        });
      }
      channel.messages.push({
        id: msg.id,
        text: msg.text,
        userId: msg.user_id,
      });
      return reply(201, { message: msg });
    }
    if (method === "PATCH") {
      const set = body.set as { frozen?: boolean };
      if (set.frozen !== undefined) channel.frozen = set.frozen;
      return reply(200, { channel: { id } });
    }
    for (const u of (body.add_members as string[] | undefined) ?? []) {
      channel.members.add(u);
    }
    for (const u of (body.remove_members as string[] | undefined) ?? []) {
      channel.members.delete(u);
    }
    return reply(201, { channel: { id } });
  };

  allMessages() {
    return [...this.channels.values()].flatMap((c) => c.messages);
  }
}

function reply(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  };
}
