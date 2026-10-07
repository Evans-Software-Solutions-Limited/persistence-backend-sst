import type { Result, ApiError } from "../../shared/errors/result";
import { fail } from "../../shared/errors/result";
import type {
  TogetherCloudApi,
  CloudPage,
} from "../../domain/ports/togetherCloud.port";
import type { TogetherSocialApi } from "../../domain/ports/togetherSocial.port";
import {
  record,
  cloudSnapshot,
  page,
  person,
  finish,
  consent,
  previous,
  flag,
  idField,
} from "./cloudSchema";
import { uuid, integer } from "./security/schema";
import { recoveryPlan, recoveryResult } from "./recoverySchema";
interface Options {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  body?: unknown;
  idempotencyKey?: string;
  timeoutMs?: number;
  params?: Record<string, string | number | undefined>;
  validateResponse?: (value: unknown) => boolean;
}
type Request = <T>(
  path: string,
  options?: Options,
) => Promise<Result<T, ApiError>>;
const segment = encodeURIComponent;
export function createCloudApis(
  envelope: Request,
  raw: Request,
): { cloud: TogetherCloudApi; social: TogetherSocialApi } {
  const call = <T>(
    path: string,
    method: Options["method"],
    check: (v: unknown) => boolean,
    body?: unknown,
    key?: string,
  ) =>
    envelope<T>(path, {
      method,
      body,
      idempotencyKey: key,
      timeoutMs: 15_000,
      validateResponse: check,
    });
  const paged = async <T>(
    path: string,
    check: (v: unknown) => boolean,
    cursor?: string,
    params: Record<string, string> = {},
  ) => {
    const result = await raw<CloudPage<T>>(path, {
      params: { ...params, limit: 20, cursor },
      timeoutMs: 15_000,
      validateResponse: () => true,
    });
    return result.ok && !page(result.value, check)
      ? fail<ApiError>({
          kind: "api",
          code: "server",
          message: "Invalid Together response",
        })
      : result;
  };
  const session = (id: string) => `/together/sessions/${segment(id)}`;
  const command = (v: unknown) =>
    record(v) && uuid(v.commandId) && integer(v.revision) && record(v.event);
  const join = (v: unknown) =>
    record(v) &&
    uuid(v.requestId) &&
    uuid(v.sessionId) &&
    ["approved", "pending"].includes(String(v.status));
  const template = (v: unknown) =>
    record(v) &&
    uuid(v.id) &&
    uuid(v.senderId) &&
    uuid(v.recipientId) &&
    record(v.plan) &&
    typeof v.plan.name === "string" &&
    v.plan.name.length > 0 &&
    v.plan.name.length <= 200 &&
    Array.isArray(v.plan.exercises) &&
    v.plan.exercises.length <= 100 &&
    (v.plan.exercises.length === 0 ||
      recoveryPlan({
        ...v.plan,
        name: v.plan.name.slice(0, 120),
        exercises: v.plan.exercises.map((e) =>
          record(e) && e.targetSets === 0 ? { ...e, targetSets: 1 } : e,
        ),
      })) &&
    typeof v.revoked === "boolean";
  return {
    cloud: {
      create: (key, body) =>
        call(
          "/together/sessions",
          "POST",
          (v) =>
            record(v) &&
            uuid(v.sessionId) &&
            integer(v.revision) &&
            cloudSnapshot(v.snapshot),
          body,
          key,
        ),
      active: () =>
        call(
          "/together/sessions/active",
          "GET",
          (v) =>
            Array.isArray(v) &&
            v.every(
              (row) =>
                idField(row, "sessionId") &&
                record(row) &&
                typeof row.status === "string",
            ),
        ),
      snapshot: (id) => call(session(id), "GET", cloudSnapshot),
      invite: (id, key) =>
        call(
          `${session(id)}/invites`,
          "POST",
          (v) =>
            record(v) &&
            uuid(v.tokenId) &&
            typeof v.token === "string" &&
            typeof v.expiresAt === "string",
          { expiresInMinutes: 15 },
          key,
        ),
      revokeInvite: (id, tokenId, key) =>
        call(
          `${session(id)}/invites/${segment(tokenId)}`,
          "DELETE",
          (v) => flag(v, "revoked"),
          undefined,
          key,
        ),
      join: (key, target) =>
        call(
          "/together/join-requests",
          "POST",
          join,
          { ...target, consentVersion: "together-v1", consentAccepted: true },
          key,
        ),
      joinStatus: (requestId) =>
        call(
          `/together/join-requests/${segment(requestId)}`,
          "GET",
          (v) =>
            record(v) &&
            uuid(v.requestId) &&
            uuid(v.sessionId) &&
            ["pending", "approved", "rejected", "unavailable"].includes(
              String(v.status),
            ),
        ),
      cancelJoin: (requestId, key) =>
        call(
          `/together/join-requests/${segment(requestId)}`,
          "DELETE",
          (v) => flag(v, "cancelled"),
          undefined,
          key,
        ),
      requests: (id, cursor) =>
        paged(
          `${session(id)}/join-requests`,
          (v) => person(v) && idField(v, "requestId"),
          cursor,
        ),
      decide: (id, requestId, key, body) =>
        call(
          `${session(id)}/join-requests/${segment(requestId)}/decision`,
          "POST",
          cloudSnapshot,
          body,
          key,
        ),
      remove: (id, userId, key, expectedRevision) =>
        call(
          `${session(id)}/participants/${segment(userId)}/remove`,
          "POST",
          (v) => flag(v, "removed") && record(v) && cloudSnapshot(v.snapshot),
          { expectedRevision },
          key,
        ),
      command: (id, key, body) =>
        call(`${session(id)}/commands`, "POST", command, body, key),
      delegation: (id, key, allowed) =>
        call(
          `${session(id)}/delegation`,
          "PUT",
          (v) =>
            record(v) &&
            integer(v.generation) &&
            typeof v.allowed === "boolean",
          { allowPartnerLogging: allowed },
          key,
        ),
      consent: (id, key, kind, body) =>
        call(`${session(id)}/${kind}-consent`, "PUT", consent, body, key),
      previous: (id, ownerId) =>
        call(`${session(id)}/previous/${segment(ownerId)}`, "GET", previous),
      visibility: (id, key, body) =>
        call(
          `${session(id)}/visibility`,
          "PUT",
          (v) => record(v) && integer(v.revision),
          body,
          key,
        ),
      friends: (cursor) =>
        paged(
          "/together/discovery",
          (v) =>
            record(v) &&
            uuid(v.sessionId) &&
            person(v.host) &&
            integer(v.occupancy) &&
            v.occupancy < 4 &&
            typeof v.expiresAt === "string",
          cursor,
          { audience: "friends" },
        ),
      discard: (id, key) =>
        call(
          `${session(id)}/discard`,
          "POST",
          (v) => record(v) && v.retired === true,
          {},
          key,
        ),
      finish: (id, key, revision, leave) =>
        call(
          `${session(id)}/${leave ? "leave" : "finish"}`,
          "POST",
          finish,
          { expectedOwnRevision: revision },
          key,
        ),
      close: (id, key, body) =>
        call(
          `${session(id)}/close`,
          "POST",
          (v) =>
            finish(v) &&
            record(v) &&
            v.sharingActive === false &&
            integer(v.revision) &&
            integer(v.ownRevision),
          body,
          key,
        ),
      review: (id, key, body) =>
        call(`${session(id)}/review`, "POST", recoveryResult, body, key),
    },
    social: {
      getProfile: () =>
        call("/social/profile", "GET", (v) => flag(v, "discoverable")),
      personCode: (key) =>
        call(
          "/social/person-code",
          "POST",
          (v) =>
            record(v) &&
            typeof v.code === "string" &&
            typeof v.expiresAt === "string",
          {},
          key,
        ),
      resolvePersonCode: (code) =>
        call("/social/person-code/resolve", "POST", person, { code }),
      profile: (key, discoverable) =>
        call(
          "/social/profile",
          "PUT",
          (v) => flag(v, "discoverable"),
          { discoverable },
          key,
        ),
      people: (q, cursor) => paged("/social/people", person, cursor, { q }),
      friends: (cursor) =>
        paged(
          "/social/friends",
          (v) =>
            record(v) &&
            uuid(v.id) &&
            uuid(v.userId) &&
            uuid(v.friendId) &&
            v.status === "accepted",
          cursor,
        ),
      requests: (cursor) =>
        paged(
          "/social/requests",
          (v) =>
            record(v) &&
            uuid(v.id) &&
            uuid(v.userId) &&
            uuid(v.friendId) &&
            v.status === "pending",
          cursor,
        ),
      request: (key, userId, personCode) =>
        call(
          "/social/requests",
          "POST",
          (v) => idField(v, "requestId"),
          { userId, ...(personCode ? { personCode } : {}) },
          key,
        ),
      decide: (key, id, decision) =>
        call(
          `/social/requests/${segment(id)}/decision`,
          "POST",
          (v) => idField(v, "requestId"),
          { decision },
          key,
        ),
      remove: (key, userId) =>
        call(
          `/social/friends/${segment(userId)}`,
          "DELETE",
          (v) => flag(v, "removed"),
          undefined,
          key,
        ),
      block: (key, userId, blocked) =>
        call(
          `/social/blocks/${segment(userId)}`,
          blocked ? "PUT" : "DELETE",
          (v) => flag(v, "blocked"),
          blocked ? {} : undefined,
          key,
        ),
      report: (key, body) =>
        call(
          "/social/reports",
          "POST",
          (v) => idField(v, "reportId"),
          body,
          key,
        ),
      offer: (key, recipientUserId, plan) =>
        call(
          "/together/templates",
          "POST",
          (v) => idField(v, "shareId"),
          { recipientUserId, plan },
          key,
        ),
      offers: (cursor) => paged("/together/templates", template, cursor),
      template: (id) =>
        call(`/together/templates/${segment(id)}`, "GET", template),
      copy: (key, id) =>
        call(
          `/together/templates/${segment(id)}/copy`,
          "POST",
          (v) => idField(v, "workoutId"),
          {},
          key,
        ),
      revoke: (key, id) =>
        call(
          `/together/templates/${segment(id)}`,
          "DELETE",
          (v) => flag(v, "revoked"),
          undefined,
          key,
        ),
    },
  };
}
