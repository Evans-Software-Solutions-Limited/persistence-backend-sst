import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  proofDdl,
  proofSchema,
  RecoveryProof,
  type Operation,
  type SetInput,
} from "./recoveryProof";

const host = randomUUID(),
  guest = randomUUID(),
  outsider = randomUUID();
const set = (weightKg = 40): SetInput => ({
  setId: randomUUID(),
  reps: 8,
  weightKg,
  completed: true,
});
let pg: PGlite, proof: RecoveryProof, session: string, now: number;
const run = (actor: string, op: Operation, key = randomUUID()) =>
  proof.execute(actor, session, key, op);
const write = (
  actor: string,
  expectedVersion = 0,
  input = set(),
): Operation => ({
  kind: "set",
  commandId: randomUUID(),
  athleteId: actor,
  expectedVersion,
  set: input,
});
async function request(actor = guest) {
  const invite = await run(host, { kind: "invite" });
  return run(actor, {
    kind: "request",
    token: proof.token(session, invite.tokenId!),
    consentVersion: "together-v1",
    consentAccepted: true,
  });
}
async function pair() {
  const req = await request();
  await run(host, {
    kind: "approve",
    requestId: req.requestId!,
    expectedRevision: req.revision,
  });
}
beforeEach(async () => {
  now = 1000000000;
  pg = await PGlite.create();
  await pg.exec(proofDdl);
  proof = new RecoveryProof(
    drizzle(pg, { schema: proofSchema }),
    "test-server-secret",
    () => now,
  );
  session = await proof.seed(host, [host, guest, outsider]);
});
afterEach(async () => {
  if (!pg.closed) await pg.close();
});

describe("PER-20 private transport recovery proof", () => {
  it("requires consent and host approval; tokens expose no snapshot or events and are stored hashed", async () => {
    const invite = await run(host, { kind: "invite" });
    const token = proof.token(session, invite.tokenId!);
    await expect(
      run(guest, {
        kind: "request",
        token,
        consentVersion: "together-v1",
        consentAccepted: false,
      } as unknown as Operation),
    ).rejects.toThrow("INVALID_INPUT");
    await run(guest, {
      kind: "request",
      token,
      consentVersion: "together-v1",
      consentAccepted: true,
    });
    await expect(proof.snapshot(guest, session)).rejects.toThrow("FORBIDDEN");
    await expect(proof.replay(guest, session, 0)).rejects.toThrow("FORBIDDEN");
    await expect(run(guest, { kind: "invite" })).rejects.toThrow("FORBIDDEN");
    const dump =
      JSON.stringify(await pg.query("select state from proof_sessions")) +
      JSON.stringify(await pg.query("select * from proof_receipts")) +
      JSON.stringify(await pg.query("select * from proof_events"));
    expect(dump).not.toContain(token);
  });
  it("serializes competing approvals to exactly two seats", async () => {
    const a = await request();
    const invite = (await proof.db.select().from(proofSchema.sessions))[0].state
      .invite!;
    const b = await run(outsider, {
      kind: "request",
      token: proof.token(session, invite.id),
      consentVersion: "together-v1",
      consentAccepted: true,
    });
    const outcomes = await Promise.allSettled(
      [a, b].map((req) =>
        run(host, {
          kind: "approve",
          requestId: req.requestId!,
          expectedRevision: b.revision,
        }),
      ),
    );
    expect(outcomes.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.find((r) => r.status === "rejected")).toMatchObject({
      reason: new Error("SESSION_FULL"),
    });
    expect(
      Object.keys((await proof.snapshot(host, session)).members),
    ).toHaveLength(2);
  });
  it("rejects expiry, revoked invitations, free applicants and stale approval versions", async () => {
    const req = await request();
    await expect(
      run(host, {
        kind: "approve",
        requestId: req.requestId!,
        expectedRevision: 0,
      }),
    ).rejects.toThrow("VERSION_CONFLICT");
    await proof.policy(session, [host]);
    await expect(
      run(host, {
        kind: "approve",
        requestId: req.requestId!,
        expectedRevision: req.revision,
      }),
    ).rejects.toThrow("FORBIDDEN");
    await expect(
      run(guest, {
        kind: "request",
        token: "a".repeat(64),
        consentVersion: "together-v1",
        consentAccepted: true,
      }),
    ).rejects.toThrow("FORBIDDEN");
    await proof.policy(session, [host, guest]);
    now += 900001;
    await expect(
      run(host, {
        kind: "approve",
        requestId: req.requestId!,
        expectedRevision: req.revision,
      }),
    ).rejects.toThrow("INVITE_EXPIRED");
    const invite = await run(host, { kind: "invite" });
    await run(host, { kind: "revokeInvite" });
    await expect(
      run(guest, {
        kind: "request",
        token: proof.token(session, invite.tokenId!),
        consentVersion: "together-v1",
        consentAccepted: true,
      }),
    ).rejects.toThrow("FORBIDDEN");
  });
  it("keeps athlete executions independent under simultaneous edits and rejects stale ordering", async () => {
    await pair();
    const h = set(90),
      g = set(25);
    await Promise.all([
      run(host, write(host, 0, h)),
      run(guest, write(guest, 0, g)),
    ]);
    await expect(run(host, write(host, 0, set(95)))).rejects.toThrow(
      "VERSION_CONFLICT",
    );
    await run(host, write(host, 1, { ...h, reps: 9 }));
    const state = await proof.snapshot(guest, session);
    expect(state.members[host].sets).toEqual([{ ...h, reps: 9 }]);
    expect(state.members[guest].sets).toEqual([g]);
    const outcomes = await Promise.allSettled([
      run(guest, write(guest, 1)),
      run(guest, write(guest, 1)),
    ]);
    expect(outcomes.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  });
  it("deduplicates a lost acknowledgement without repeating effects; rejects changed body", async () => {
    const key = randomUUID(),
      op = write(host);
    const first = await run(host, op, key);
    expect(await run(host, op, key)).toEqual(first);
    const retryKey = randomUUID();
    expect(await run(host, op, retryKey)).toEqual(first);
    await expect(run(host, write(host, 1), retryKey)).rejects.toThrow(
      "IDEMPOTENCY_MISMATCH",
    );
    await expect(
      run(host, { ...op, set: set(999) } as Operation),
    ).rejects.toThrow("IDEMPOTENCY_MISMATCH");
    await expect(run(host, write(host), key)).rejects.toThrow(
      "IDEMPOTENCY_MISMATCH",
    );
    expect((await proof.snapshot(host, session)).members[host].revision).toBe(
      1,
    );
    expect(await proof.db.select().from(proofSchema.events)).toHaveLength(1);
  });
  it("reauthorizes delegated retries and rejects queued old generations after revocation", async () => {
    await pair();
    await expect(run(host, write(guest))).rejects.toThrow("DELEGATION_REVOKED");
    const grant = await run(guest, { kind: "delegate", allowed: true });
    const key = randomUUID(),
      op = { ...write(guest), generation: grant.generation } as Operation;
    await run(host, op, key);
    await run(guest, { kind: "delegate", allowed: false });
    await expect(run(host, op, key)).rejects.toThrow("DELEGATION_REVOKED");
    await run(guest, { kind: "delegate", allowed: true });
    await expect(
      run(host, { ...op, expectedVersion: 1 } as Operation),
    ).rejects.toThrow("DELEGATION_REVOKED");
    expect((await proof.snapshot(guest, session)).members[guest].revision).toBe(
      1,
    );
  });
  it.each(["block", "expiry", "leave"])(
    "%s strips partner visibility/replay but preserves independent own recovery",
    async (reason) => {
      await pair();
      await run(host, write(host));
      const grant = await run(guest, { kind: "delegate", allowed: true });
      const key = randomUUID(),
        op = { ...write(guest), generation: grant.generation } as Operation;
      await run(host, op, key);
      if (reason === "leave")
        await run(host, { kind: "leave", expectedOwnRevision: 1 });
      else
        await proof.policy(
          session,
          reason === "expiry" ? [] : [host, guest],
          reason === "block",
        );
      await expect(run(host, op, key)).rejects.toThrow("FORBIDDEN");
      await expect(proof.replay(guest, session, 0)).rejects.toThrow(
        "FORBIDDEN",
      );
      expect(
        Object.keys((await proof.snapshot(guest, session)).members),
      ).toEqual([guest]);
      await run(guest, { kind: "delegate", allowed: false });
      await run(guest, write(guest, 1));
      await run(guest, { kind: "finish", expectedOwnRevision: 2 });
      expect((await proof.complete(session, guest)).status).toBe("saved");
      await proof.policy(session, [host, guest]);
      await expect(proof.replay(guest, session, 0)).rejects.toThrow(
        "FORBIDDEN",
      );
    },
  );
  it("atomically rolls back execution, receipts and outbox on failure then retries", async () => {
    const key = randomUUID(),
      op = write(host);
    await expect(
      proof.execute(host, session, key, op, "beforeCommit"),
    ).rejects.toThrow("INJECTED");
    expect((await proof.snapshot(host, session)).members[host].revision).toBe(
      0,
    );
    expect(await proof.db.select().from(proofSchema.receipts)).toEqual([]);
    expect(await proof.db.select().from(proofSchema.events)).toEqual([]);
    await run(host, op, key);
    expect((await proof.snapshot(host, session)).members[host].revision).toBe(
      1,
    );
  });
  it("retries content-free wakeups after disconnect and replays ordered bounded durable events", async () => {
    await pair();
    await run(host, write(host));
    await run(guest, write(guest));
    const delivered: unknown[] = [];
    await expect(
      proof.dispatch(async (_sessionId, hint) => {
        delivered.push(hint);
        throw new Error("disconnect after send");
      }),
    ).rejects.toThrow("disconnect");
    await proof.dispatch(async (_sessionId, hint) => {
      delivered.push(hint);
    });
    expect(
      delivered.every(
        (hint) => JSON.stringify(hint) === '{"type":"sync_required"}',
      ),
    ).toBe(true);
    const count = delivered.length;
    await proof.dispatch(async () => {
      throw new Error("unexpected resend");
    });
    expect(delivered).toHaveLength(count);
    const events = await proof.replay(guest, session, 3);
    expect(events.map((e) => e.revision)).toEqual([4, 5, 6]);
    await expect(proof.replay(host, session, 99)).rejects.toThrow(
      "VERSION_CONFLICT",
    );
    now += 86400001;
    await expect(proof.replay(host, session, 0)).rejects.toThrow(
      "CURSOR_EXPIRED",
    );
    expect(await proof.replay(host, session, 6)).toEqual([]);
    expect(
      (await proof.snapshot(host, session)).members[host].sets,
    ).toHaveLength(1);
  });
  it("freezes each finish at its revision, retries crashes and applies one recording/effect per athlete", async () => {
    await pair();
    const h = set(100),
      g = set(30);
    await run(host, write(host, 0, h));
    await run(guest, write(guest, 0, g));
    await expect(
      run(host, { kind: "finish", expectedOwnRevision: 0 }),
    ).rejects.toThrow("VERSION_CONFLICT");
    await Promise.all([
      run(host, { kind: "finish", expectedOwnRevision: 1 }),
      run(host, { kind: "finish", expectedOwnRevision: 1 }),
    ]);
    await expect(run(host, write(host, 1))).rejects.toThrow("INVALID_STATE");
    await expect(proof.complete(session, host, "afterRecord")).rejects.toThrow(
      "INJECTED_AFTER_RECORD",
    );
    await expect(
      proof.complete(session, host, "beforeMapping"),
    ).rejects.toThrow("INJECTED_BEFORE_MAPPING");
    expect(await proof.db.select().from(proofSchema.recordings)).toEqual([]);
    expect((await proof.snapshot(host, session)).members[host].status).toBe(
      "finalizing",
    );
    await run(guest, write(guest, 1, { ...g, reps: 12 }));
    await run(guest, { kind: "finish", expectedOwnRevision: 2 });
    const finishKey = randomUUID();
    await run(host, { kind: "finish", expectedOwnRevision: 1 }, finishKey);
    const [saved, duplicate] = await Promise.all([
      proof.complete(session, host),
      proof.complete(session, host),
      proof.complete(session, guest),
    ]);
    expect(saved.historyId).toBe(duplicate.historyId);
    expect(
      await run(host, { kind: "finish", expectedOwnRevision: 1 }, finishKey),
    ).toMatchObject({ status: "saved", historyId: saved.historyId });
    const results = await proof.db.select().from(proofSchema.recordings);
    expect(results).toHaveLength(2);
    expect(results.find((r) => r.actor === host)?.sets).toEqual([h]);
    expect(results.find((r) => r.actor === guest)?.sets).toEqual([
      { ...g, reps: 12 },
    ]);
    expect(results.map((r) => r.effects)).toEqual([1, 1]);
    expect(
      (await run(host, { kind: "finish", expectedOwnRevision: 1 })).historyId,
    ).toBe(saved.historyId);
  });
  it("distinguishes completed empty from a history and handles finish versus pending edit race", async () => {
    const outcomes = await Promise.allSettled([
      run(host, { kind: "finish", expectedOwnRevision: 0 }),
      run(host, write(host)),
    ]);
    expect(outcomes[0].status).toBe("fulfilled");
    expect(outcomes[1]).toMatchObject({
      status: "rejected",
      reason: new Error("INVALID_STATE"),
    });
    expect((await proof.complete(session, host)).status).toBe("finished_empty");
    expect(
      (await run(host, { kind: "finish", expectedOwnRevision: 0 })).status,
    ).toBe("finished_empty");
    expect(await proof.db.select().from(proofSchema.recordings)).toEqual([]);
  });
  it("reopens on-disk storage with dedup, undelivered outbox and frozen jobs intact", async () => {
    await pg.close();
    const directory = await mkdtemp(join(tmpdir(), "together-proof-"));
    try {
      pg = await PGlite.create(directory);
      await pg.exec(proofDdl);
      proof = new RecoveryProof(
        drizzle(pg, { schema: proofSchema }),
        "disk-secret",
      );
      session = await proof.seed(host, [host]);
      const key = randomUUID(),
        op = write(host);
      const ack = await run(host, op, key);
      await run(host, { kind: "finish", expectedOwnRevision: 1 });
      const jobId = (await proof.db.select().from(proofSchema.jobs))[0].id;
      await pg.close();
      pg = await PGlite.create(directory);
      proof = new RecoveryProof(
        drizzle(pg, { schema: proofSchema }),
        "disk-secret",
      );
      expect(await run(host, op, key)).toEqual(ack);
      expect((await proof.complete(session, host)).historyId).toBe(jobId);
      let count = 0;
      await proof.dispatch(async () => {
        count++;
      });
      expect(count).toBe(3);
      expect((await proof.complete(session, host)).historyId).toBe(jobId);
    } finally {
      await pg.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
  it("publishes completion transactionally once and reauthorizes completion replay", async () => {
    await pair();
    await run(host, write(host));
    const pending = await run(host, { kind: "finish", expectedOwnRevision: 1 });
    await expect(
      proof.complete(session, host, "beforeMapping"),
    ).rejects.toThrow("INJECTED_BEFORE_MAPPING");
    expect(await proof.replay(guest, session, pending.revision)).toEqual([]);
    const saved = await proof.complete(session, host);
    const completed = await proof.replay(guest, session, pending.revision);
    expect(completed).toEqual([
      {
        revision: pending.revision + 1,
        actor: host,
        operation: {
          kind: "completed",
          status: "saved",
          historyId: saved.historyId,
        },
      },
    ]);
    await proof.complete(session, host);
    expect(await proof.replay(guest, session, pending.revision)).toEqual(
      completed,
    );
    expect((await proof.snapshot(host, session)).revision).toBe(
      pending.revision + 1,
    );
    await proof.policy(session, [host, guest], true);
    await expect(
      proof.replay(guest, session, pending.revision),
    ).rejects.toThrow("FORBIDDEN");
    expect((await proof.snapshot(host, session)).members[host].historyId).toBe(
      saved.historyId,
    );
  });

  it("routes hints by server-side session and retains failed deliveries for their session", async () => {
    const otherSession = await proof.seed(outsider, [outsider]);
    await run(host, write(host));
    await proof.execute(outsider, otherSession, randomUUID(), write(outsider));
    const delivered: { sessionId: string; payload: unknown }[] = [];
    await expect(
      proof.dispatch(async (sessionId, payload) => {
        if (sessionId === otherSession)
          throw new Error("second session unavailable");
        delivered.push({ sessionId, payload });
      }),
    ).rejects.toThrow("second session unavailable");
    await proof.dispatch(async (sessionId, payload) => {
      delivered.push({ sessionId, payload });
    });
    expect(delivered.filter((hint) => hint.sessionId === session)).toEqual([
      { sessionId: session, payload: { type: "sync_required" } },
    ]);
    expect(delivered.filter((hint) => hint.sessionId === otherSession)).toEqual(
      [{ sessionId: otherSession, payload: { type: "sync_required" } }],
    );
    expect(
      (await proof.db.select().from(proofSchema.events)).every(
        (event) => event.delivered,
      ),
    ).toBe(true);
  });

  it("validates malicious fixture inputs and refuses inaccessible records", async () => {
    const bad = [
      write(host, -1),
      write(host, 0, set(-1)),
      write(host, 0, { ...set(), reps: 10001 }),
      write(host, 0, { ...set(), weightKg: Infinity }),
      { kind: "delegate", allowed: "yes" },
      { kind: "unknown" },
      {
        kind: "request",
        token: "bad",
        consentAccepted: true,
        consentVersion: "together-v1",
      },
    ];
    for (const op of bad)
      await expect(run(host, op as Operation)).rejects.toThrow("INVALID_INPUT");
    await expect(
      proof.execute("body-user", session, randomUUID(), write(host)),
    ).rejects.toThrow("INVALID_INPUT");
    await expect(
      proof.execute(host, randomUUID(), randomUUID(), write(host)),
    ).rejects.toThrow("FORBIDDEN");
    await expect(proof.complete(session, outsider)).rejects.toThrow(
      "FORBIDDEN",
    );
    await expect(proof.complete(session, host)).rejects.toThrow(
      "INVALID_STATE",
    );
    await expect(proof.policy(randomUUID(), [])).rejects.toThrow("FORBIDDEN");
  });
});
