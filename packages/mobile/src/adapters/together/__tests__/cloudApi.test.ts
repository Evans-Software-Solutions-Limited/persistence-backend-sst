/** @jest-environment node */
import { randomUUID } from "node:crypto";
import { createCloudApis } from "../cloudApi";
import { cloudSnapshot, consent, previous } from "../cloudSchema";
import { ok, fail } from "../../../shared/errors/result";
const id = randomUUID(),
  other = randomUUID(),
  key = randomUUID();
const plan = {
  name: "Workout",
  exercises: [
    {
      planExerciseId: randomUUID(),
      exerciseId: randomUUID(),
      order: 0,
      targetSets: 1,
    },
  ],
};
const execution = { exercises: [] };
const person = { userId: id, displayName: "Alex", avatarUrl: null };
const snapshot = {
  sessionId: id,
  state: "active",
  sharingActive: true,
  continuation: null,
  hostId: id,
  revision: 0,
  planVersion: 1,
  plan,
  participants: [
    {
      userId: id,
      status: "active",
      ownRevision: 0,
      delegationGeneration: 0,
      allowPartnerLogging: false,
      execution,
      numbersAvailable: true,
      previousValuesAvailable: true,
      previousConsent: { version: 0, recipientIds: [] },
      numbersConsent: { version: 0, recipientIds: [] },
      exerciseCatalog: {},
    },
  ],
  completion: {
    status: "active",
    historyId: null,
    ownRevision: 0,
    recoveryMayBePending: false,
  },
};
const date = "2026-10-05T00:00:00.000Z";
const finish = { status: "saved", historyId: other };
const cases: [string, string, unknown[], string, string, unknown][] = [
  [
    "cloud",
    "create",
    [key, { clientDraftId: other, plan, ownExecution: execution }],
    "/together/sessions",
    "POST",
    { sessionId: id, revision: 0, snapshot },
  ],
  [
    "cloud",
    "active",
    [],
    "/together/sessions/active",
    "GET",
    [{ sessionId: id, status: "active" }],
  ],
  ["cloud", "snapshot", [id], `/together/sessions/${id}`, "GET", snapshot],
  [
    "cloud",
    "invite",
    [id, key],
    `/together/sessions/${id}/invites`,
    "POST",
    { tokenId: other, token: "opaque", expiresAt: date },
  ],
  [
    "cloud",
    "revokeInvite",
    [id, other, key],
    `/together/sessions/${id}/invites/${other}`,
    "DELETE",
    { revoked: true },
  ],
  [
    "cloud",
    "join",
    [key, { sessionId: id }],
    "/together/join-requests",
    "POST",
    { requestId: other, sessionId: id, status: "approved" },
  ],
  [
    "cloud",
    "joinStatus",
    [other],
    `/together/join-requests/${other}`,
    "GET",
    { requestId: other, sessionId: id, status: "pending" },
  ],
  [
    "cloud",
    "cancelJoin",
    [other, key],
    `/together/join-requests/${other}`,
    "DELETE",
    { cancelled: true },
  ],
  [
    "cloud",
    "decide",
    [id, other, key, { decision: "approve", expectedRevision: 0 }],
    `/together/sessions/${id}/join-requests/${other}/decision`,
    "POST",
    snapshot,
  ],
  [
    "cloud",
    "remove",
    [id, other, key, 0],
    `/together/sessions/${id}/participants/${other}/remove`,
    "POST",
    { removed: true, snapshot },
  ],
  [
    "cloud",
    "command",
    [
      id,
      key,
      {
        commandId: key,
        expectedVersion: 0,
        target: { kind: "execution" },
        operation: { type: "rest", endsAt: null },
      },
    ],
    `/together/sessions/${id}/commands`,
    "POST",
    { commandId: key, revision: 1, event: { newVersion: 1 } },
  ],
  [
    "cloud",
    "delegation",
    [id, key, true],
    `/together/sessions/${id}/delegation`,
    "PUT",
    { generation: 1, allowed: true },
  ],
  [
    "cloud",
    "consent",
    [id, key, "numbers", { expectedVersion: 0, recipientIds: [other] }],
    `/together/sessions/${id}/numbers-consent`,
    "PUT",
    { sessionId: id, ownerId: id, version: 1, recipientIds: [other] },
  ],
  [
    "cloud",
    "previous",
    [id, other],
    `/together/sessions/${id}/previous/${other}`,
    "GET",
    {
      sessionId: id,
      ownerId: other,
      consentVersion: 1,
      revision: 1,
      planVersion: 1,
      ownRevision: 0,
      values: [
        {
          exerciseId: other,
          setNumber: 1,
          weightKg: 25,
          reps: 8,
          recordedAt: date,
        },
      ],
    },
  ],
  [
    "cloud",
    "visibility",
    [id, key, { audience: "friends", expiresAt: date }],
    `/together/sessions/${id}/visibility`,
    "PUT",
    { revision: 1 },
  ],
  [
    "cloud",
    "finish",
    [id, key, 0, false],
    `/together/sessions/${id}/finish`,
    "POST",
    finish,
  ],
  [
    "cloud",
    "finish",
    [id, key, 0, true],
    `/together/sessions/${id}/leave`,
    "POST",
    finish,
  ],
  [
    "cloud",
    "close",
    [
      id,
      key,
      { expectedRevision: 1, expectedOwnRevision: 0, mode: "save_own" },
    ],
    `/together/sessions/${id}/close`,
    "POST",
    { ...finish, revision: 1, ownRevision: 0, sharingActive: false },
  ],
  [
    "cloud",
    "review",
    [id, key, { expectedOwnRevision: 0, execution }],
    `/together/sessions/${id}/review`,
    "POST",
    {
      ...finish,
      reviewedRevision: 1,
      effectsPending: true,
      sharingActive: false,
    },
  ],
  [
    "social",
    "getProfile",
    [],
    "/social/profile",
    "GET",
    { discoverable: false },
  ],
  [
    "social",
    "profile",
    [key, true],
    "/social/profile",
    "PUT",
    { discoverable: true },
  ],
  [
    "social",
    "personCode",
    [key],
    "/social/person-code",
    "POST",
    { code: "opaque-code", expiresAt: date },
  ],
  [
    "social",
    "resolvePersonCode",
    ["opaque-code"],
    "/social/person-code/resolve",
    "POST",
    person,
  ],
  [
    "social",
    "request",
    [key, id, "opaque-code"],
    "/social/requests",
    "POST",
    { requestId: other, status: "pending" },
  ],
  [
    "social",
    "decide",
    [key, id, "accept"],
    `/social/requests/${id}/decision`,
    "POST",
    { requestId: id, status: "accepted" },
  ],
  [
    "social",
    "remove",
    [key, id],
    `/social/friends/${id}`,
    "DELETE",
    { removed: true },
  ],
  [
    "social",
    "block",
    [key, id, true],
    `/social/blocks/${id}`,
    "PUT",
    { blocked: true },
  ],
  [
    "social",
    "block",
    [key, id, false],
    `/social/blocks/${id}`,
    "DELETE",
    { blocked: false },
  ],
  [
    "social",
    "report",
    [key, { subjectUserId: id, context: "together", reason: "spam" }],
    "/social/reports",
    "POST",
    { reportId: other },
  ],
  [
    "social",
    "offer",
    [key, id, plan],
    "/together/templates",
    "POST",
    { shareId: other },
  ],
  [
    "social",
    "template",
    [id],
    `/together/templates/${id}`,
    "GET",
    { id, senderId: id, recipientId: other, plan, revoked: false },
  ],
  [
    "social",
    "copy",
    [key, id],
    `/together/templates/${id}/copy`,
    "POST",
    { workoutId: other },
  ],
  [
    "social",
    "revoke",
    [key, id],
    `/together/templates/${id}`,
    "DELETE",
    { revoked: true },
  ],
];
describe("authenticated Together cloud/social API contracts", () => {
  it.each(cases)(
    "%s.%s uses the exact route and rejects malformed success",
    (group, method, args, path, verb, response) => {
      let payload = response;
      const request = jest.fn(async (_path, options) =>
        options.validateResponse(payload)
          ? ok(payload)
          : fail({ kind: "api", code: "server", message: "invalid" }),
      );
      const api = createCloudApis(request as never, request as never) as any;
      return (async () => {
        expect((await api[group][method](...args)).ok).toBe(true);
        expect(request).toHaveBeenLastCalledWith(
          path,
          expect.objectContaining({ method: verb, timeoutMs: 15000 }),
        );
        const options = request.mock.calls[0][1];
        if (verb !== "GET" && method !== "resolvePersonCode")
          expect(options.idempotencyKey).toBe(key);
        payload = null;
        expect((await api[group][method](...args)).ok).toBe(false);
      })();
    },
  );
  it.each([
    [
      "cloud",
      "requests",
      [id],
      `/together/sessions/${id}/join-requests`,
      { ...person, requestId: other },
    ],
    [
      "cloud",
      "friends",
      [],
      "/together/discovery",
      { sessionId: id, host: person, occupancy: 2, expiresAt: date },
    ],
    ["social", "people", ["Al"], "/social/people", person],
    [
      "social",
      "friends",
      [],
      "/social/friends",
      { id, userId: id, friendId: other, status: "accepted" },
    ],
    [
      "social",
      "requests",
      [],
      "/social/requests",
      { id, userId: id, friendId: other, status: "pending" },
    ],
    [
      "social",
      "offers",
      [],
      "/together/templates",
      { id, senderId: id, recipientId: other, plan, revoked: false },
    ],
  ])(
    "%s.%s preserves pagination without unwrapping away the cursor",
    async (group, method, args, path, row) => {
      let response: any = { data: [row], nextCursor: "opaque" };
      const request = jest.fn(async () => ok(response));
      const api = createCloudApis(request as never, request as never) as any;
      expect(
        await api[group as string][method as string](...(args as any[])),
      ).toEqual(ok(response));
      expect(request).toHaveBeenCalledWith(
        path,
        expect.objectContaining({
          params: expect.objectContaining({ limit: 20 }),
        }),
      );
      response = { data: [null], nextCursor: null };
      expect(
        (await api[group as string][method as string](...(args as any[]))).ok,
      ).toBe(false);
    },
  );
  it("validates consent-scoped numeric visibility and bounded PREV data", () => {
    expect(cloudSnapshot(snapshot)).toBe(true);
    const denied = structuredClone(snapshot) as any;
    denied.participants[0].numbersAvailable = false;
    expect(cloudSnapshot(denied)).toBe(false);
    denied.participants[0].execution = null;
    expect(cloudSnapshot(denied)).toBe(true);
    expect(
      consent({
        sessionId: id,
        ownerId: other,
        version: 0,
        recipientIds: [id],
      }),
    ).toBe(true);
    expect(
      consent({
        sessionId: id,
        ownerId: other,
        version: -1,
        recipientIds: [id],
      }),
    ).toBe(false);
    expect(
      previous({
        sessionId: id,
        ownerId: other,
        consentVersion: 0,
        revision: 0,
        planVersion: 1,
        ownRevision: 0,
        values: [
          {
            exerciseId: id,
            setNumber: 1,
            weightKg: NaN,
            reps: 8,
            recordedAt: date,
          },
        ],
      }),
    ).toBe(false);
  });
  it("accepts valid template-only empty/zero-set plans and preserves network pagination failures", async () => {
    let response: any = {
      id,
      senderId: id,
      recipientId: other,
      plan: { name: "x".repeat(200), exercises: [] },
      revoked: false,
    };
    const request = jest.fn(async (_path, options) =>
      options.validateResponse(response)
        ? ok(response)
        : fail({ kind: "api", code: "server", message: "invalid" }),
    );
    const api = createCloudApis(request as never, request as never);
    expect((await api.social.template(id)).ok).toBe(true);
    response.plan.exercises = [{ ...plan.exercises[0], targetSets: 0 }];
    const zeroSet = await api.social.template(id);
    expect(zeroSet.ok).toBe(true);
    if (zeroSet.ok) expect(zeroSet.value.plan.exercises[0].targetSets).toBe(0);
    // Social copies are server-owned workout templates; they are not passed to
    // the local session-plan adoption validator (which requires planned sets).
    response = { workoutId: id };
    expect((await api.social.copy(other, id)).ok).toBe(true);
    expect(request).toHaveBeenLastCalledWith(
      `/together/templates/${id}/copy`,
      expect.objectContaining({ method: "POST" }),
    );
    response = {
      id,
      senderId: id,
      recipientId: other,
      plan: { name: "Template", exercises: [null] },
      revoked: false,
    };
    response.plan.exercises[0] = null;
    expect((await api.social.template(id)).ok).toBe(false);
    response.plan.name = "x".repeat(201);
    expect((await api.social.template(id)).ok).toBe(false);
    const raw = jest.fn(async (_path, options) => {
      expect(options.validateResponse(null)).toBe(true);
      return fail({ kind: "api", code: "network", message: "offline" });
    });
    expect(
      (await createCloudApis(request as never, raw as never).cloud.friends())
        .ok,
    ).toBe(false);
  });
});
