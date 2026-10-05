/** @jest-environment node */
import { TogetherSharedSession, type SharedEnvelope } from "../sharedSession";
import { DatabaseSync } from "node:sqlite";
import { randomBytes, randomUUID } from "node:crypto";
import {
  TogetherJournal,
  TogetherJournalDatabase,
} from "../../storage/togetherJournal";
import { TogetherLocalStore } from "../localStore";
import { TogetherLocalLobby, LocalJoinRequest } from "../localLobby";
import { TogetherLocalLink } from "../localLink";
import {
  readOwnerCommand,
  commandFromEnvelope,
  OwnerCommand,
} from "../localCommand";
import { LocalSecureChannel } from "../security/channel";
import {
  signPayload,
  publicKeyPem,
  Credential,
  JoinConsent,
  requestHash,
} from "../security/identity";
const id = (n: number) =>
  `${n.toString(16).padStart(8, "0")}-1111-4111-8111-111111111111`;
const time = 1700000000000;
const authority = new Uint8Array(32).fill(77);
const trusted = { v1: publicKeyPem(authority) };
const pin = { sessionId: id(100), hostUserId: id(1), hostDeviceId: id(11) };
function person(n: number) {
  const seed = new Uint8Array(32).fill(n);
  const credential = signPayload<Credential>(
    {
      kind: "together-device-v1",
      keyId: "v1",
      userId: id(n),
      deviceId: id(n + 10),
      publicKey: publicKeyPem(seed),
      issuedAt: time - 10,
      expiresAt: time + 1000,
    },
    authority,
  );
  const consent = signPayload<JoinConsent>(
    {
      kind: "together-consent-v1",
      ...pin,
      userId: id(n),
      deviceId: id(n + 10),
      executionId: id(n + 20),
      nonce: id(n + 30),
      consentVersion: "together-v1",
      consentAccepted: true,
    },
    seed,
  );
  return { seed, credential, consent };
}
function request(n = 2, friends = false): LocalJoinRequest {
  const { credential, consent } = person(n);
  return {
    credential,
    consent,
    ...(friends
      ? {
          friendship: signPayload(
            {
              kind: "together-friendship-v1" as const,
              keyId: "v1",
              users: [id(1), id(n)] as [string, string],
              issuedAt: time - 10,
              expiresAt: time + 1000,
            },
            authority,
          ),
        }
      : {}),
  };
}
function adapter(db: DatabaseSync): TogetherJournalDatabase {
  return {
    execSync: (sql) => db.exec(sql),
    runSync: (sql, p) => db.prepare(sql).run(...p),
    getFirstSync: <T>(sql: string, p: (string | number | null)[]) =>
      (db.prepare(sql).get(...p) as T | undefined) ?? null,
    getAllSync: <T>(sql: string, p: (string | number | null)[]) =>
      db.prepare(sql).all(...p) as T[],
    withTransactionSync(action) {
      db.exec("BEGIN IMMEDIATE");
      try {
        action();
        db.exec("COMMIT");
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
    },
  };
}

const plan = {
  name: "Strength",
  exercises: [
    { planExerciseId: id(50), exerciseId: id(51), order: 0, targetSets: 3 },
  ],
};
const none = { numbers: false, prev: false, logging: false };
function command(
  n: number,
  version = 0,
  operation: Record<string, unknown> = {
    type: "upsertSet",
    planExerciseId: id(50),
    set: { setId: id(60), reps: 8, weightKg: 72.5, completed: true },
  },
) {
  return commandFromEnvelope(
    signPayload<OwnerCommand>(
      {
        kind: "together-recovery-v1",
        userId: id(n),
        sessionId: pin.sessionId,
        executionId: id(n + 20),
        commandId: randomUUID(),
        planHash: requestHash(plan),
        startedAt: time,
        expectedVersion: version,
        operation,
      },
      person(n).seed,
    ),
  );
}
describe("shared plans, sealed consent and independent projections", () => {
  let paused = false;
  let block: ((envelope: SharedEnvelope) => Promise<void>) | undefined;
  let databases: DatabaseSync[],
    lobbies: TogetherLocalLobby[],
    engines: TogetherSharedSession[],
    sent: SharedEnvelope[],
    clock: number,
    blocked: [string, string][];
  const make = (n: number) =>
    new TogetherSharedSession({
      lobby: lobbies[n - 1],
      seed: person(n).seed,
      randomBytes,
      randomUUID,
      now: () => clock,
      send: async (envelope) => {
        sent.push(envelope);
        await block?.(envelope);
        if (paused) return;
        const p = envelope.payload;
        if (n !== 1) engines[0].accept(envelope, id(n));
        for (let target = 1; target <= 3; target++) {
          if (
            !lobbies[n - 1].store
              .current(pin.sessionId)
              ?.payload.members.some(
                (m) => m.credential.payload.userId === id(target),
              )
          )
            continue;
          if (target === n || (target === 1 && n !== 1)) continue;
          if (p.recipientId === "all" || p.recipientId === id(target))
            engines[target - 1].accept(envelope, id(1));
        }
      },
    });
  beforeEach(() => {
    paused = false;
    block = undefined;
    databases = [];
    lobbies = [];
    engines = [];
    sent = [];
    clock = time;
    blocked = [];
    for (let n = 1; n <= 3; n++) {
      const db = new DatabaseSync(":memory:");
      databases.push(db);
      lobbies.push(
        new TogetherLocalLobby(new TogetherLocalStore(adapter(db), id(n)), {
          ...pin,
          ...person(n),
          trustedKeys: trusted,
          now: () => clock,
          deniedPairs: () => blocked,
          audience: "open",
          invitedUserIds: [],
        }),
      );
    }
    lobbies[0].start(person(1).consent);
    lobbies[0].admit(request(2), person(2).credential, true);
    lobbies[0].admit(request(3), person(3).credential, true);
    for (const lobby of lobbies.slice(1))
      for (const roster of lobbies[0].store.rosters(pin.sessionId))
        lobby.accept(roster);
    engines = [make(1), make(2), make(3)];
    engines.forEach((e) => e.setOwnPlan(plan));
  });
  afterEach(() => {
    engines.forEach((e) => e.dispose());
    databases.forEach((db) => db.close());
  });
  it("distributes a host-only immutable plan with independent logs, selected numbers and blind host relay", async () => {
    await engines[0].publishPlan(plan);
    expect(engines[1].getSnapshot().plan).toEqual(plan);
    await expect(engines[1].publishPlan(plan)).rejects.toThrow();
    await expect(
      engines[0].publishPlan({ ...plan, name: "changed" }),
    ).rejects.toThrow();
    await engines[1].publishProgress(command(2));
    expect(engines[0].getSnapshot().athletes).toEqual([]);
    expect(engines[2].getSnapshot().athletes).toEqual([]);
    await engines[1].setConsent(id(3), { ...none, numbers: true });
    expect(
      engines[2].getSnapshot().athletes[0].exercises[id(50)].sets[0].weightKg,
    ).toBe(72.5);
    expect(engines[0].getSnapshot().athletes).toEqual([]);
    expect(JSON.stringify(sent)).not.toContain("72.5");
    await engines[2].publishProgress(command(3));
    expect(engines[2].getSnapshot().athletes).toHaveLength(2);
    expect(engines[1].getSnapshot().athletes).toHaveLength(1);
  });
  it("revocation purges caches, rejects in-flight old data, survives restart and grants never imply PREV or logging", async () => {
    await engines[0].publishPlan(plan);
    await engines[1].setConsent(id(3), { ...none, numbers: true });
    await engines[1].publishProgress(command(2));
    const old = sent.find(
      (e) =>
        e.payload.type === "progress" &&
        e.payload.authorId === id(2) &&
        e.payload.recipientId === id(3),
    )!;
    await engines[1].setConsent(id(3), none);
    expect(engines[2].getSnapshot().athletes).toEqual([]);
    engines[2].accept(old, id(1));
    expect(engines[2].getSnapshot().athletes).toEqual([]);
    engines[2].dispose();
    engines[2] = make(3);
    expect(engines[2].getSnapshot().athletes).toEqual([]);
    await expect(engines[1].publishPrevious(id(3), [], time)).rejects.toThrow();
    await expect(
      engines[2].requestDelegatedSet(id(2), {}, 0),
    ).rejects.toThrow();
    expect(
      engines[0].replay(id(3)).filter((e) => e.payload.type === "progress"),
    ).toEqual([]);
  });
  it("shares only bounded selected PREV and invalidates it on progress", async () => {
    await engines[0].publishPlan(plan);
    await engines[1].setConsent(id(3), { ...none, prev: true, numbers: true });
    const rows = [
      {
        exerciseId: id(51),
        setNumber: 1,
        reps: 5,
        weightKg: 60,
        recordedAt: time - 100,
      },
    ];
    await engines[1].publishPrevious(id(3), rows, time);
    expect(engines[2].getSnapshot().previous[id(2)]).toEqual(rows);
    expect(engines[0].getSnapshot().previous).toEqual({});
    await expect(
      engines[1].publishPrevious(
        id(3),
        [{ ...rows[0], exerciseId: id(99) }],
        time,
      ),
    ).rejects.toThrow();
    await expect(
      engines[1].publishPrevious(
        id(3),
        [{ ...rows[0], recordedAt: time }],
        time,
      ),
    ).rejects.toThrow();
    await engines[1].publishProgress(command(2));
    expect(engines[2].getSnapshot().previous[id(2)]).toEqual([]);
  });
  it("rejects a 50-exercise PREV snapshot atomically without truncating or blocking later sharing", async () => {
    const largePlan = {
      ...plan,
      exercises: Array.from({ length: 50 }, (_, i) => ({
        planExerciseId: id(200 + i),
        exerciseId: id(300 + i),
        order: i,
        targetSets: 5,
      })),
    };
    engines.forEach((e) => e.dispose());
    engines = [make(1), make(2), make(3)];
    engines.forEach((e) => e.setOwnPlan(largePlan));
    await engines[0].publishPlan(largePlan);
    await engines[1].setConsent(id(3), { ...none, prev: true });
    const rows = largePlan.exercises.flatMap((e) =>
      Array.from({ length: 5 }, (_, i) => ({
        exerciseId: e.exerciseId,
        setNumber: i + 1,
        reps: 8,
        weightKg: 62.5,
        recordedAt: time - 100,
      })),
    );
    const before = sent.length;
    await expect(engines[1].publishPrevious(id(3), rows, time)).rejects.toThrow(
      "Invalid shared session message",
    );
    expect(sent).toHaveLength(before);
    expect(engines[2].getSnapshot().previous).toEqual({});
    expect(
      engines[1].replay(id(3)).filter((e) => e.payload.type === "previous"),
    ).toEqual([]);
    // Rejecting an oversized snapshot must not poison the channel or grant.
    await engines[1].publishPrevious(id(3), [rows.at(-1)!], time);
    expect(engines[2].getSnapshot().previous[id(2)]).toEqual([rows.at(-1)!]);
    expect(engines[0].getSnapshot().previous).toEqual({});
  });
  it("shares all 105 PREV rows in one bounded encrypted snapshot and retains replay/revocation semantics", async () => {
    const largePlan = {
      ...plan,
      exercises: Array.from({ length: 15 }, (_, i) => ({
        planExerciseId: id(200 + i),
        exerciseId: id(300 + i),
        order: i,
        targetSets: 7,
      })),
    };
    engines.forEach((e) => e.dispose());
    engines = [make(1), make(2), make(3)];
    engines.forEach((e) => e.setOwnPlan(largePlan));
    await engines[0].publishPlan(largePlan);
    await engines[1].setConsent(id(3), { ...none, prev: true });
    const rows = largePlan.exercises.flatMap((e) =>
      Array.from({ length: 7 }, (_, i) => ({
        exerciseId: e.exerciseId,
        setNumber: i + 1,
        reps: 8,
        weightKg: 62.5,
        recordedAt: time - 100,
      })),
    );
    await engines[1].publishPrevious(id(3), rows, time);
    expect(engines[2].getSnapshot().previous[id(2)]).toEqual(rows);
    expect(engines[2].getSnapshot().previous[id(2)].at(-1)).toEqual(rows[104]);
    const envelope = sent.filter((e) => e.payload.type === "previous").at(-1)!;
    expect(
      new TextEncoder().encode(JSON.stringify(envelope)).length,
    ).toBeLessThanOrEqual(30000);
    expect(engines[0].getSnapshot().previous).toEqual({});
    engines[2].dispose();
    engines[2] = make(3);
    expect(engines[2].getSnapshot().previous[id(2)]).toEqual(rows);
    const before = sent.length;
    await expect(
      engines[1].publishPrevious(id(3), [rows[0], rows[0]], time),
    ).rejects.toThrow();
    const oversized = largePlan.exercises.flatMap((e) =>
      Array.from({ length: 100 }, (_, i) => ({
        ...rows[0],
        exerciseId: e.exerciseId,
        setNumber: i + 1,
      })),
    );
    await expect(
      engines[1].publishPrevious(id(3), oversized, time),
    ).rejects.toThrow();
    expect(sent).toHaveLength(before);
    expect(engines[2].getSnapshot().previous[id(2)]).toEqual(rows);
    expect(
      engines[1].replay(id(3)).filter((e) => e.payload.type === "previous"),
    ).toEqual([envelope]);
    await engines[1].setConsent(id(3), none);
    engines[2].accept(envelope, id(1));
    expect(engines[2].getSnapshot().previous).toEqual({});
    engines[2].dispose();
    engines[2] = make(3);
    expect(engines[2].getSnapshot().previous).toEqual({});
  });
  it("delegation is a separately versioned owner-consumed request and stale authorization cannot apply", async () => {
    await engines[0].publishPlan(plan);
    await engines[1].setConsent(id(3), { ...none, logging: true });
    const operation = readOwnerCommand(
      command(2),
      person(2).credential,
    ).operation;
    await engines[2].requestDelegatedSet(id(2), operation, 0);
    const pending = engines[1].getSnapshot().delegated[0];
    expect(pending.actorId).toBe(id(3));
    expect(engines[1].consumeDelegated(pending.id)).toEqual({
      operation,
      expectedVersion: 0,
    });
    expect(() => engines[1].consumeDelegated(pending.id)).toThrow();
    await engines[2].requestDelegatedSet(id(2), operation, 0);
    const stale = engines[1].getSnapshot().delegated[0];
    await engines[1].setConsent(id(3), none);
    expect(() => engines[1].consumeDelegated(stale.id)).toThrow();
    expect(engines[1].getSnapshot().athletes).toEqual([]);
  });
  it.each(["finish_all", "save_own"] as const)(
    "signed host %s freezes sharing, clears peer caches and preserves local owner journals",
    async (mode) => {
      await engines[0].publishPlan(plan);
      await engines[1].setConsent(id(3), { ...none, numbers: true });
      await engines[1].publishProgress(command(2));
      await engines[0].close(mode);
      expect(engines[2].getSnapshot().closures).toEqual([
        { userId: id(1), mode },
      ]);
      expect(engines[2].getSnapshot().athletes).toEqual([]);
      await expect(engines[1].publishProgress(command(2, 1))).rejects.toThrow();
      await engines[1].setConsent(id(3), none);
    },
  );
  it("guest leave cannot close other athletes or forge host authority", async () => {
    await engines[0].publishPlan(plan);
    await expect(engines[1].close("finish_all")).rejects.toThrow();
    await engines[1].close("leave");
    expect(engines[2].getSnapshot().closures).toEqual([
      { userId: id(2), mode: "leave" },
    ]);
    await engines[2].publishProgress(command(3));
  });
  it("rejects spoofing, wrong transport, altered signatures, unknown participants and conflicting revisions", async () => {
    await engines[0].publishPlan(plan);
    const valid = sent[0];
    expect(engines[1].accept(valid, id(1))).toBe(false);
    for (const change of [
      { sessionId: id(99) },
      { authorId: id(99) },
      { id: "bad" },
      { recipientId: id(99) },
      { revision: 0 },
      { kind: "bad" },
      { body: { ...plan, name: "forged" } },
    ])
      expect(() =>
        engines[1].accept(
          {
            ...valid,
            payload: { ...valid.payload, ...change },
          } as SharedEnvelope,
          id(1),
        ),
      ).toThrow();
    expect(() => engines[1].accept(valid, id(3))).toThrow();
    expect(() =>
      engines[1].accept(
        signPayload(
          { ...valid.payload, body: { ...plan, name: "conflict" } },
          person(1).seed,
        ),
        id(1),
      ),
    ).toThrow();
  });
  it("restores own projection versions and applies own substitution, skip, rest and removal independently", async () => {
    await engines[0].publishPlan(plan);
    await engines[1].publishProgress(command(2));
    engines[1].dispose();
    engines[1] = make(2);
    await engines[1].publishProgress(
      command(2, 1, {
        type: "substitute",
        planExerciseId: id(50),
        exerciseId: id(52),
      }),
    );
    await engines[1].publishProgress(
      command(2, 2, { type: "skip", planExerciseId: id(50), skipped: true }),
    );
    await engines[1].publishProgress(
      command(2, 3, { type: "rest", endsAt: "2023-11-14T22:15:00Z" }),
    );
    await engines[1].publishProgress(
      command(2, 4, {
        type: "removeSet",
        planExerciseId: id(50),
        setId: id(60),
      }),
    );
    const own = engines[1].getSnapshot().athletes[0];
    expect(own.revision).toBe(5);
    expect(own.exercises[id(50)]).toEqual({
      exerciseId: id(52),
      skipped: true,
      sets: [],
    });
    expect(own.restEndsAt).not.toBeNull();
    await expect(engines[1].publishProgress(command(2, 7))).rejects.toThrow();
  });
  it("expiry and newly known blocks purge partner data without invalidating personal recovery", async () => {
    await engines[0].publishPlan(plan);
    await engines[1].setConsent(id(3), { ...none, numbers: true });
    await engines[1].publishProgress(command(2));
    blocked = [[id(2), id(3)]];
    expect(engines[2].getSnapshot().athletes).toEqual([]);
    blocked = [];
    clock += 2000;
    expect(engines[1].getSnapshot().athletes.map((a) => a.userId)).toEqual([
      id(2),
    ]);
    await expect(engines[1].setConsent(id(3), none)).rejects.toThrow();
  });
  it("binds guest canonical IDs to their own plan rather than the host draft", async () => {
    engines[1].dispose();
    engines[1] = make(2);
    const guestPlan = {
      name: "Guest original",
      exercises: [
        { ...plan.exercises[0], planExerciseId: id(70), exerciseId: id(71) },
      ],
    };
    engines[1].setOwnPlan(guestPlan);
    await engines[0].publishPlan(plan);
    await engines[1].setConsent(id(3), {
      ...none,
      numbers: true,
      logging: true,
    });
    const c = command(2);
    const p = readOwnerCommand(c, person(2).credential);
    const own = commandFromEnvelope(
      signPayload(
        {
          ...p,
          planHash: requestHash(guestPlan),
          operation: { ...p.operation, planExerciseId: id(70) },
        },
        person(2).seed,
      ),
    );
    await engines[1].publishProgress(own);
    const view = engines[2].getSnapshot();
    expect(view.plan).toEqual(plan);
    expect(view.athletePlans[id(2)]).toEqual(guestPlan);
    expect(view.athletes[0].exercises[id(70)].sets).toHaveLength(1);
    await engines[2].requestDelegatedSet(
      id(2),
      {
        ...p.operation,
        planExerciseId: id(70),
      },
      1,
    );
    expect(engines[1].getSnapshot().delegated).toHaveLength(1);
    expect(() => engines[1].setOwnPlan(plan)).toThrow();
  });
  it.each([
    null,
    {},
    { name: "", exercises: plan.exercises },
    { name: "x".repeat(121), exercises: plan.exercises },
    { name: "A", exercises: [] },
    { ...plan, exercises: Array(101).fill(plan.exercises[0]) },
    { ...plan, exercises: [plan.exercises[0], plan.exercises[0]] },
    { ...plan, exercises: [{ ...plan.exercises[0], exerciseId: "bad" }] },
    { ...plan, exercises: [{ ...plan.exercises[0], order: 100 }] },
    { ...plan, exercises: [{ ...plan.exercises[0], targetSets: 0 }] },
  ])("rejects malformed or unbounded host plan %p", async (value) => {
    await expect(
      engines[0].publishPlan(value as typeof plan),
    ).rejects.toThrow();
    expect(engines[0].getSnapshot().plan).toBeNull();
  });
  it("replays only scoped latest consent before data and exact closure retry remains immutable", async () => {
    await engines[0].publishPlan(plan);
    await engines[1].setConsent(id(3), { ...none, numbers: true });
    await engines[1].publishProgress(command(2));
    await engines[1].publishProgress(command(2, 1));
    expect(engines[1].replay(id(1)).map((e) => e.payload.type)).toEqual([
      "activity",
      "consent",
      "progress",
    ]);
    const replay = engines[0].replay(id(3));
    expect(replay.map((e) => e.payload.type)).toEqual(["plan", "activity"]);
    await engines[1].setConsent(id(3), none);
    expect(engines[0].replay(id(3)).map((e) => e.payload.type)).toEqual([
      "plan",
      "activity",
    ]);
    for (const engine of engines) {
      const stored = lobbies[engines.indexOf(engine)].store
        .sharedEvents(pin.sessionId)
        .map((text) => JSON.parse(text).payload);
      expect(
        stored.filter(
          (p) =>
            p.type === "progress" &&
            p.authorId === id(2) &&
            p.recipientId === id(3),
        ),
      ).toEqual([]);
    }
    await engines[0].close("save_own");
    const first = sent.at(-1);
    await engines[0].close("save_own");
    expect(sent.at(-1)).toEqual(first);
    await expect(engines[0].close("finish_all")).rejects.toThrow();
  });
  it("uses the real authenticated link for plan/consent and rejects legacy numeric leakage", async () => {
    paused = true;
    const hframes: string[] = [],
      gframes: string[] = [];
    const hchannel = new LocalSecureChannel({
      role: "host",
      ...pin,
      ...person(1),
      trustedKeys: trusted,
      randomBytes,
      now: () => clock,
    });
    const gchannel = new LocalSecureChannel({
      role: "guest",
      ...pin,
      ...person(2),
      trustedKeys: trusted,
      randomBytes,
      now: () => clock,
    });
    const host = new TogetherLocalLink(
      hchannel,
      lobbies[0],
      new TogetherJournal(adapter(databases[0]), id(1)),
      async (frame) => {
        hframes.push(frame);
      },
      engines[0],
    );
    const guest = new TogetherLocalLink(
      gchannel,
      lobbies[1],
      new TogetherJournal(adapter(databases[1]), id(2)),
      async (frame) => {
        gframes.push(frame);
      },
      engines[1],
    );
    const pump = async () => {
      while (hframes.length || gframes.length) {
        if (gframes.length) await host.receive(gframes.shift()!);
        if (hframes.length) await guest.receive(hframes.shift()!);
      }
    };
    await guest.start();
    await pump();
    await engines[0].publishPlan(plan);
    await host.sendShared(sent.at(-1)!);
    await pump();
    expect(engines[1].getSnapshot().plan).toEqual(plan);
    await engines[1].setConsent(id(1), { ...none, numbers: true });
    await guest.sendShared(sent.at(-1)!);
    await pump();
    await guest.sendOwn(command(2));
    await guest.sendShared(sent.at(-1)!);
    await pump();
    expect(engines[0].getSnapshot().athletes[0].userId).toBe(id(2));
    await guest.resendOwn();
    await pump();
    await expect(
      host.receive(
        gchannel.encrypt(
          JSON.stringify({ kind: "command", command: command(2, 1) }),
        ),
      ),
    ).rejects.toThrow("Unconsented legacy numeric command");
    host.close();
    guest.close();
  });
  it("bounds total visible sets and rejects unknown exercises, oversized PREV, stale and future own revisions", async () => {
    await engines[0].publishPlan(plan);
    await engines[1].setConsent(id(3), { ...none, prev: true });
    await expect(
      engines[1].publishPrevious(
        id(3),
        Array(101).fill({
          exerciseId: id(51),
          setNumber: 1,
          reps: 1,
          weightKg: 1,
          recordedAt: time - 1,
        }),
        time,
      ),
    ).rejects.toThrow();
    await expect(
      engines[1].publishProgress(
        command(2, 0, { type: "skip", planExerciseId: id(99), skipped: true }),
      ),
    ).rejects.toThrow();
    await engines[1].publishProgress(command(2));
    await engines[1].publishProgress(command(2));
    expect(engines[1].getSnapshot().athletes[0].revision).toBe(1);
    await engines[1].publishProgress(
      command(2, 1, {
        type: "substitute",
        planExerciseId: id(50),
        exerciseId: null,
      }),
    );
    await engines[1].publishProgress(
      command(2, 2, { type: "rest", endsAt: null }),
    );
  });
  it("ignores observer failures and removes subscriptions", async () => {
    const callback = jest.fn(() => {
      throw new Error("UI");
    });
    const unsubscribe = engines[0].subscribe(callback);
    await engines[0].publishPlan(plan);
    expect(callback).toHaveBeenCalled();
    unsubscribe();
    callback.mockClear();
    await engines[0].publishPlan(plan);
    expect(callback).not.toHaveBeenCalled();
  });
  it("owner edits between delegated request and consumption conflict without applying the stale set", async () => {
    await engines[0].publishPlan(plan);
    await engines[1].setConsent(id(3), { ...none, logging: true });
    const operation = readOwnerCommand(
      command(2),
      person(2).credential,
    ).operation;
    await engines[2].requestDelegatedSet(id(2), operation, 0);
    const intent = engines[1].getSnapshot().delegated[0];
    await engines[1].publishProgress(command(2));
    expect(() => engines[1].consumeDelegated(intent.id)).toThrow();
    expect(engines[1].getSnapshot().athletes[0].revision).toBe(1);
  });
  it("storage failure rolls back public plan and private projection before retry", async () => {
    const persist = jest
      .spyOn(lobbies[0].store, "saveShared")
      .mockImplementationOnce(() => {
        throw new Error("disk full");
      });
    await expect(engines[0].publishPlan(plan)).rejects.toThrow("disk full");
    expect(engines[0].getSnapshot().plan).toBeNull();
    persist.mockRestore();
    await engines[0].publishPlan(plan);
    const own = jest
      .spyOn(lobbies[1].store, "saveShared")
      .mockImplementationOnce(() => {
        throw new Error("disk full");
      });
    const op = command(2);
    await expect(engines[1].publishProgress(op)).rejects.toThrow("disk full");
    expect(engines[1].getSnapshot().athletes).toEqual([]);
    own.mockRestore();
    await engines[1].publishProgress(op);
    expect(engines[1].getSnapshot().athletes[0].revision).toBe(1);
  });
  it("publishes bounded signed display names without establishing authority", async () => {
    await engines[1].publishProfile("  Alex  ");
    expect(engines[0].getSnapshot().profiles[id(2)]).toBe("Alex");
    expect(engines[2].getSnapshot().profiles[id(2)]).toBe("Alex");
    await expect(engines[1].publishProfile(" ")).rejects.toThrow();
    await expect(engines[1].publishProfile("x".repeat(81))).rejects.toThrow();
    await expect(engines[1].publishPlan(plan)).rejects.toThrow();
    engines[2].dispose();
    engines[2] = make(3);
    expect(engines[2].getSnapshot().profiles[id(2)]).toBe("Alex");
  });
  it("shares substituted PREV without granting numeric workout access", async () => {
    await engines[0].publishPlan(plan);
    await engines[1].publishProgress(
      command(2, 0, {
        type: "substitute",
        planExerciseId: id(50),
        exerciseId: id(52),
      }),
    );
    await engines[1].setConsent(id(3), { ...none, prev: true });
    const rows = [
      {
        exerciseId: id(52),
        setNumber: 1,
        reps: 2,
        weightKg: 40,
        recordedAt: time - 100,
      },
    ];
    await engines[1].publishPrevious(id(3), rows, time);
    expect(engines[2].getSnapshot().previous[id(2)]).toEqual(rows);
    expect(engines[2].getSnapshot().athletes).toEqual([]);
    await engines[1].publishProgress(
      command(2, 1, { type: "skip", planExerciseId: id(50), skipped: true }),
    );
    expect(engines[2].getSnapshot().previous[id(2)]).toEqual([]);
    await expect(
      engines[1].publishPrevious(id(3), rows, time),
    ).rejects.toThrow();
  });
  it("persists exact shared retries and rejects conflicting IDs or a full bounded journal", () => {
    const store = lobbies[0].store;
    store.saveShared(pin.sessionId, id(900), "one");
    store.saveShared(pin.sessionId, id(900), "one");
    expect(() => store.saveShared(pin.sessionId, id(900), "two")).toThrow(
      "Conflicting shared event",
    );
    databases[0].exec(
      `WITH RECURSIVE entries(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM entries WHERE n<4095) INSERT INTO together_shared_events(account_id,session_id,event_id,envelope) SELECT '${id(1)}','${pin.sessionId}',CAST(n AS TEXT),'bounded' FROM entries`,
    );
    expect(() => store.saveShared(pin.sessionId, id(901), "new")).toThrow(
      "Shared event journal full",
    );
  });
  it("records separate signed projection delivery without pretending the journal was acknowledged", async () => {
    await engines[0].publishPlan(plan);
    await engines[1].setConsent(id(3), { ...none, numbers: true });
    await engines[1].publishProgress(command(2));
    expect(engines[1].getSnapshot().deliveries).toEqual([
      { recipientId: id(3), revision: 1, state: "received" },
    ]);
    paused = true;
    await engines[1].publishProgress(command(2, 1));
    expect(engines[1].getSnapshot().deliveries[0].state).toBe("pending");
    const staleReceipt = sent.find((e) => e.payload.type === "receipt")!;
    engines[1].accept(staleReceipt, id(1));
    expect(engines[1].getSnapshot().deliveries[0].state).toBe("pending");
  });
  it("link loss purges private caches and requires a fresh owner grant even across restart", async () => {
    await engines[0].publishPlan(plan);
    await engines[1].setConsent(id(3), { ...none, numbers: true, prev: true });
    await engines[1].publishProgress(command(2));
    const stale = sent.filter((e) => e.payload.authorId === id(2));
    engines[2].suspendPeer(id(1));
    expect(engines[2].getSnapshot().athletes).toEqual([]);
    expect(engines[2].getSnapshot().previous).toEqual({});
    expect(engines[2].getSnapshot().grants).toEqual([]);
    for (const event of stale) engines[2].accept(event, id(1));
    expect(engines[2].getSnapshot().athletes).toEqual([]);
    engines[2].dispose();
    engines[2] = make(3);
    expect(engines[2].getSnapshot().athletes).toEqual([]);
    expect(engines[2].getSnapshot().grants).toEqual([]);
    await engines[1].setConsent(id(3), { ...none, numbers: true });
    expect(engines[2].getSnapshot().athletes).toHaveLength(1);
    engines[1].suspendPeer(id(3));
    expect(engines[1].getSnapshot().grants).toEqual([]);
    expect(engines[1].getSnapshot().deliveries).toEqual([]);
  });
  it("link loss keeps the owner's own projection for independent continuation and renewed sharing", async () => {
    await engines[0].publishPlan(plan);
    await engines[1].publishProgress(command(2));
    engines[1].suspendPeer(id(1));
    await engines[1].publishProgress(
      command(2, 1, {
        type: "upsertSet",
        planExerciseId: id(50),
        set: { setId: id(61), reps: 10, weightKg: 50, completed: true },
      }),
    );
    expect(
      engines[1].getSnapshot().athletes[0].exercises[id(50)].sets,
    ).toHaveLength(2);
    await engines[1].setConsent(id(3), { ...none, numbers: true });
    expect(
      engines[2].getSnapshot().athletes[0].exercises[id(50)].sets,
    ).toHaveLength(2);
  });
  it("a delayed grant completion cannot transmit new numeric data after a newer revoke", async () => {
    await engines[0].publishPlan(plan);
    await engines[1].publishProgress(command(2));
    let release!: () => void;
    const waiting = new Promise<void>((resolve) => {
      release = resolve;
    });
    block = async (envelope) => {
      if (
        envelope.payload.type === "consent" &&
        envelope.payload.revision === 1
      )
        await waiting;
    };
    const granting = engines[1].setConsent(id(3), { ...none, numbers: true });
    await engines[1].setConsent(id(3), none);
    release();
    await granting;
    expect(sent.filter((event) => event.payload.type === "progress")).toEqual(
      [],
    );
    expect(engines[2].getSnapshot().athletes).toEqual([]);
  });
  it("rejects delegated edits when the rendered owner revision is stale", async () => {
    await engines[0].publishPlan(plan);
    await engines[1].setConsent(id(3), {
      ...none,
      numbers: true,
      logging: true,
    });
    await engines[1].publishProgress(command(2));
    const operation = readOwnerCommand(
      command(2),
      person(2).credential,
    ).operation;
    await expect(
      engines[2].requestDelegatedSet(id(2), operation, 0),
    ).rejects.toThrow();
    expect(engines[1].getSnapshot().delegated).toEqual([]);
    await engines[2].requestDelegatedSet(id(2), operation, 1);
    expect(engines[1].getSnapshot().delegated[0].expectedVersion).toBe(1);
  });
  it("signed removal purges private caches while remaining athletes continue and own results survive", async () => {
    await engines[0].publishPlan(plan);
    await engines[1].publishProgress(command(2));
    await engines[1].setConsent(id(3), {
      ...none,
      numbers: true,
      prev: true,
      logging: true,
    });
    await engines[0].setConsent(id(3), { ...none, numbers: true });
    const old = sent.find(
      (e) =>
        e.payload.type === "progress" &&
        e.payload.authorId === id(2) &&
        e.payload.recipientId === id(3),
    )!;
    const removal = lobbies[0].removeParticipant(id(2));
    for (const lobby of lobbies.slice(1)) lobby.accept(removal);
    engines.forEach((engine) => engine.rosterChanged());
    expect(
      engines[2].getSnapshot().athletes.some((a) => a.userId === id(2)),
    ).toBe(false);
    expect(
      engines[2].getSnapshot().grants.some((g) => g.ownerId === id(2)),
    ).toBe(false);
    expect(
      engines[1].getSnapshot().athletes[0].exercises[id(50)].sets,
    ).toHaveLength(1);
    expect(() => engines[2].accept(old, id(1))).toThrow();
    await expect(engines[1].publishProgress(command(2, 1))).rejects.toThrow();
    await engines[0].publishProgress(command(1));
    expect(
      engines[2].getSnapshot().athletes.some((a) => a.userId === id(1)),
    ).toBe(true);
    expect(() => make(1)).not.toThrow();
    expect(() => make(2)).not.toThrow();
    expect(
      lobbies[0].admit(request(2, true), person(2).credential).status,
    ).toBe("approval-required");
  });
  it("shares only authenticated plan completion when numbers are private and purges on disconnect", async () => {
    await engines[0].publishPlan(plan);
    await engines[1].publishProgress(command(2));
    expect(engines[2].getSnapshot().athletes).toEqual([]);
    expect(engines[2].getSnapshot().progress).toEqual([
      {
        userId: id(2),
        revision: 1,
        exercises: [
          { planExerciseId: id(50), completedSets: 1, skipped: false },
        ],
      },
    ]);
    const activity = sent.find((e) => e.payload.type === "activity")!;
    const text = JSON.stringify(activity.payload.body);
    expect(text).not.toContain("weightKg");
    expect(text).not.toContain("reps");
    expect(text).not.toContain("previous");
    await engines[1].publishProgress(
      command(2, 1, { type: "skip", planExerciseId: id(50), skipped: true }),
    );
    expect(engines[2].getSnapshot().progress[0].exercises[0].skipped).toBe(
      true,
    );
    const restart = make(3);
    expect(restart.getSnapshot().progress[0].revision).toBe(2);
    restart.dispose();
    engines[2].suspendPeer(id(2));
    expect(engines[2].getSnapshot().progress).toEqual([]);
    const afterLoss = make(3);
    expect(afterLoss.getSnapshot().progress).toEqual([]);
    afterLoss.dispose();
  });
  it("rejects forged, private-field, oversized and alien-plan progress summaries", async () => {
    await engines[1].publishProgress(command(2));
    const activity = sent.find((e) => e.payload.type === "activity")!;
    const body = activity.payload.body as {
      plan: typeof plan;
      planHash: string;
      value: { userId: string; revision: number; exercises: unknown[] };
    };
    for (const exercises of [
      [{ planExerciseId: id(50), completedSets: 101, skipped: false }],
      [{ planExerciseId: id(99), completedSets: 1, skipped: false }],
      [
        {
          planExerciseId: id(50),
          completedSets: 1,
          skipped: false,
          weightKg: 5,
        },
      ],
    ]) {
      const changed = {
        ...activity.payload,
        id: randomUUID(),
        revision: 2,
        body: { ...body, value: { ...body.value, exercises } },
      };
      expect(() =>
        engines[2].accept(signPayload(changed, person(2).seed), id(1)),
      ).toThrow();
    }
    expect(() =>
      engines[2].accept(
        signPayload(
          { ...activity.payload, id: randomUUID(), revision: 2 },
          person(3).seed,
        ),
        id(1),
      ),
    ).toThrow();
    clock += 2000;
    expect(engines[2].getSnapshot().progress).toEqual([]);
  });
});
