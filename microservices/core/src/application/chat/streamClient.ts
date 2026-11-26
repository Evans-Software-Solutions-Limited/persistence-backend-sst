import { signHs256Jwt } from "@persistence/api-utils/jwt";

/**
 * Stream Chat REST client (PER-120, design E). Server-only: the API secret
 * signs the server token and every user token, and never leaves the Lambda.
 *
 * No Stream server SDK (Brad, 25 Nov): native `fetch` against Stream's REST
 * API and HS256 tokens from `jose`, matching the codebase's outbound-HTTP
 * convention (`leads/resendClient.ts`, `revenuecat/revenueCatClient.ts`).
 *
 * Configuration is OPTIONAL and fail-safe: `StreamApiKey` / `StreamApiSecret`
 * (infra/secrets.ts) default to empty, and an empty value means "chat not
 * configured" — `getStreamConfig()` returns null, the routes answer 503
 * `chat_not_configured`, and every hook (provisioning, offboarding, the
 * scheduler job) is a no-op. Nothing crashes on a stage without the keys.
 */

export const STREAM_API_BASE = "https://chat.stream-io-api.com";
/**
 * Our own channel type (Inspector Brad, #570). Stream's default `messaging`
 * type lets any user with a token create channels and choose their members,
 * so a token would open chat outside a coaching relationship (and an
 * offboarded athlete could start a new channel with the coach). `coaching`
 * grants members only reading and writing in their channel: creating
 * channels and changing members is server-only (`ensureChannelType`).
 */
export const STREAM_CHANNEL_TYPE = "coaching";

/**
 * What a member may do in a `coaching` channel. Nothing else: no
 * `create-channel`, `update-channel`, `update-channel-members`,
 * `delete-channel` or `remove-own-channel-membership`. A frozen channel
 * refuses new messages even with these grants (freezing on offboarding).
 */
export const COACHING_MEMBER_GRANTS = [
  "read-channel",
  "read-channel-members",
  "create-message",
  "update-message-owner",
  "delete-message-owner",
  "create-reaction",
  "delete-reaction-owner",
  "create-attachment",
  "upload-attachment",
  "delete-attachment-owner",
  "create-mention",
  "add-links",
  "flag-message",
  "mute-channel",
  "send-custom-event",
] as const;

/**
 * Grants per role on the `coaching` type. Roles listed here are replaced;
 * `user`, `guest` and `anonymous` get nothing on this type, so a token alone
 * can't create, read or join a coaching channel. Server-side calls are not
 * subject to grants.
 */
export const COACHING_GRANTS: Record<string, readonly string[]> = {
  channel_member: COACHING_MEMBER_GRANTS,
  user: [],
  guest: [],
  anonymous: [],
};
/** Stream user tokens last 24 hours (design E: `POST /chat/token`). */
export const USER_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 8_000;

export interface StreamConfig {
  apiKey: string;
  apiSecret: string;
}

/** The stage's Stream keys, or null when chat is not configured. */
export function getStreamConfig(
  env: NodeJS.ProcessEnv = process.env,
): StreamConfig | null {
  const apiKey = env.STREAM_API_KEY?.trim() ?? "";
  const apiSecret = env.STREAM_API_SECRET?.trim() ?? "";
  if (!apiKey || !apiSecret) return null;
  return { apiKey, apiSecret };
}

/** A failed Stream call. `code` is Stream's own error code when it sent one. */
export class StreamApiError extends Error {
  readonly status: number;
  readonly code: number | null;

  constructor(message: string, status: number, code: number | null = null) {
    super(message);
    this.name = "StreamApiError";
    this.status = status;
    this.code = code;
  }
}

/** Stream's "does not exist" (a channel never created there). */
export function isNotFound(err: unknown): boolean {
  return (
    err instanceof StreamApiError && (err.status === 404 || err.code === 16)
  );
}

export interface StreamUser {
  id: string;
  name?: string;
  image?: string;
}

export type FetchLike = (
  input: string,
  init: RequestInit,
) => Promise<Pick<Response, "ok" | "status" | "text">>;

export class StreamChatClient {
  private readonly config: StreamConfig;
  private readonly fetchImpl: FetchLike;

  constructor(
    config: StreamConfig,
    fetchImpl: FetchLike = (input, init) => fetch(input, init),
  ) {
    this.config = config;
    this.fetchImpl = fetchImpl;
  }

  get apiKey(): string {
    return this.config.apiKey;
  }

  /** A 24-hour token for one Stream user. */
  async createUserToken(
    userId: string,
    now: Date = new Date(),
  ): Promise<{ token: string; expiresAt: Date }> {
    // Whole seconds, so `expiresAt` is exactly the token's `exp`.
    const issuedAt = new Date(Math.floor(now.getTime() / 1000) * 1000);
    const expiresAt = new Date(issuedAt.getTime() + USER_TOKEN_TTL_MS);
    const token = await signHs256Jwt(
      { user_id: userId },
      this.config.apiSecret,
      { issuedAt, expiresAt },
    );
    return { token, expiresAt };
  }

  /**
   * Make sure the `coaching` channel type exists with our grants. Idempotent:
   * an existing type is left in place and its grants are set again.
   */
  async ensureChannelType(): Promise<void> {
    try {
      await this.request("POST", "/channeltypes", {
        name: STREAM_CHANNEL_TYPE,
        typing_events: true,
        read_events: true,
        connect_events: true,
        reactions: true,
        replies: true,
        uploads: true,
        url_enrichment: true,
        push_notifications: true,
        mutes: true,
      });
    } catch (err) {
      if (
        !(
          err instanceof StreamApiError &&
          err.status === 400 &&
          /already exists/i.test(err.message)
        )
      ) {
        throw err;
      }
    }
    await this.request("PUT", `/channeltypes/${STREAM_CHANNEL_TYPE}`, {
      grants: COACHING_GRANTS,
    });
  }

  /**
   * Erase a user from Stream (account deletion): the user and all their
   * messages are hard-deleted; the other party's own messages stay
   * (`conversations: keep`). Stream runs it as a task, which is polled until
   * it finishes. A failed task throws (the caller retries); one still running
   * after the polls is left to finish on Stream's side. A user Stream never
   * had counts as erased.
   */
  async deleteUserHard(
    userId: string,
    options: { polls?: number; sleep?: (ms: number) => Promise<void> } = {},
  ): Promise<"deleted" | "pending" | "not_found"> {
    const polls = options.polls ?? 10;
    const sleep =
      options.sleep ??
      ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
    let taskId: string | null;
    try {
      const res = (await this.request("POST", "/users/delete", {
        user_ids: [userId],
        user: "hard",
        messages: "hard",
        conversations: "keep",
      })) as { task_id?: unknown } | null;
      taskId = typeof res?.task_id === "string" ? res.task_id : null;
    } catch (err) {
      if (isNotFound(err)) return "not_found";
      throw err;
    }
    if (!taskId) return "deleted";
    for (let i = 0; i < polls; i++) {
      const task = (await this.request(
        "GET",
        `/tasks/${encodeURIComponent(taskId)}`,
      )) as { status?: unknown; error?: { description?: unknown } } | null;
      if (task?.status === "completed") return "deleted";
      if (task?.status === "failed") {
        throw new StreamApiError(
          `Stream user delete task ${taskId} failed: ${typeof task.error?.description === "string" ? task.error.description : "unknown"}`,
          500,
        );
      }
      await sleep(1000);
    }
    return "pending";
  }

  /** Create or update users (`name`/`image` replace what Stream holds). */
  async upsertUsers(users: StreamUser[]): Promise<void> {
    if (users.length === 0) return;
    const body: Record<string, StreamUser> = {};
    for (const u of users) {
      body[u.id] = {
        id: u.id,
        ...(u.name ? { name: u.name } : {}),
        ...(u.image ? { image: u.image } : {}),
      };
    }
    await this.request("POST", "/users", { users: body });
  }

  /**
   * Get or create a channel. Idempotent: the id is deterministic, so a
   * second call returns the existing channel (its members are not changed
   * by this call; see `addMembers`).
   */
  async getOrCreateChannel(
    channelId: string,
    createdById: string,
    members: string[],
  ): Promise<void> {
    await this.request("POST", `${this.channelPath(channelId)}/query`, {
      data: { created_by_id: createdById, members },
      state: false,
      watch: false,
      presence: false,
    });
  }

  /** Add members (members already in the channel are left as they are). */
  async addMembers(channelId: string, userIds: string[]): Promise<void> {
    await this.request("POST", this.channelPath(channelId), {
      add_members: userIds,
    });
  }

  async removeMembers(channelId: string, userIds: string[]): Promise<void> {
    await this.request("POST", this.channelPath(channelId), {
      remove_members: userIds,
    });
  }

  /** Freeze (nobody can send; members can still read) or unfreeze. */
  async setFrozen(channelId: string, frozen: boolean): Promise<void> {
    await this.request("PATCH", this.channelPath(channelId), {
      set: { frozen },
    });
  }

  /**
   * Send a message as `userId` with a fixed id. Idempotent: Stream refuses a
   * second message with the same id, which counts as already sent.
   */
  async sendMessage(
    channelId: string,
    message: { id: string; text: string; userId: string },
  ): Promise<"sent" | "duplicate"> {
    try {
      await this.request("POST", `${this.channelPath(channelId)}/message`, {
        message: {
          id: message.id,
          text: message.text,
          user_id: message.userId,
        },
      });
      return "sent";
    } catch (err) {
      if (
        err instanceof StreamApiError &&
        err.status === 400 &&
        /already exists/i.test(err.message)
      ) {
        return "duplicate";
      }
      throw err;
    }
  }

  private channelPath(channelId: string): string {
    return `/channels/${STREAM_CHANNEL_TYPE}/${encodeURIComponent(channelId)}`;
  }

  private async request(
    method: "GET" | "POST" | "PUT" | "PATCH",
    path: string,
    body?: unknown,
  ): Promise<unknown> {
    const serverToken = await signHs256Jwt(
      { server: true },
      this.config.apiSecret,
    );
    const url = `${STREAM_API_BASE}${path}?api_key=${encodeURIComponent(this.config.apiKey)}`;
    let res: Pick<Response, "ok" | "status" | "text">;
    try {
      res = await this.fetchImpl(url, {
        method,
        headers: {
          Authorization: serverToken,
          "stream-auth-type": "jwt",
          "Content-Type": "application/json",
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      throw new StreamApiError(
        `Stream ${method} ${path} failed: ${err instanceof Error ? err.message : String(err)}`,
        0,
      );
    }
    const text = await res.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    if (!res.ok) {
      const detail = (json ?? {}) as { message?: unknown; code?: unknown };
      throw new StreamApiError(
        `Stream ${method} ${path} → ${res.status}: ${typeof detail.message === "string" ? detail.message : "error"}`,
        res.status,
        typeof detail.code === "number" ? detail.code : null,
      );
    }
    return json;
  }
}

/** The configured client, or null when chat is not configured. */
export function streamClientFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): StreamChatClient | null {
  const config = getStreamConfig(env);
  return config ? new StreamChatClient(config) : null;
}
