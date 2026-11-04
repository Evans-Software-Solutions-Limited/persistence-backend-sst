/** @jest-environment node */
import { DatabaseSync } from "node:sqlite";
import { randomBytes, randomUUID } from "node:crypto";
import { TogetherSharedSession, type SharedEnvelope } from "../sharedSession";
import type { TogetherJournalDatabase } from "../../storage/togetherJournal";
import { TogetherLocalStore } from "../localStore";
import { TogetherLocalLobby, type LocalJoinRequest } from "../localLobby";
import {
  signPayload,
  publicKeyPem,
  verifySignature,
  requestHash,
  type Credential,
  type JoinConsent,
} from "../security/identity";
import {
  buildExerciseShare,
  readExerciseShare,
  MAX_SHARED_EXERCISES,
  type ExerciseShareBody,
} from "../exerciseShare";
import { MAX_SHARED_BYTES } from "../sharedTransfer";
import { ownCustomExercises } from "../ownCustomExercises";
import type { ExerciseShareProof } from "@/domain/models/togetherIdentity";
import type { TogetherSharedExerciseDefinition } from "@/domain/ports/togetherShared.port";
import type { Exercise } from "@/domain/models/exercise";

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
const request = (n: number): LocalJoinRequest => {
  const { credential, consent } = person(n);
  return { credential, consent };
};
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
const system = id(51),
  hostLift = id(52);
const plan = {
  name: "Strength",
  exercises: [
    { planExerciseId: id(50), exerciseId: system, order: 0, targetSets: 3 },
    { planExerciseId: id(53), exerciseId: hostLift, order: 1, targetSets: 2 },
  ],
};
const lift: TogetherSharedExerciseDefinition = {
  name: "Host lift",
  category: "strength",
  primaryMuscles: [id(70)],
};
const expected = (userId: string) => ({
  ...pin,
  hostCredential: person(1).credential,
  userId,
});
const share = (
  changes: Partial<ExerciseShareProof> = {},
  definitions: Record<string, TogetherSharedExerciseDefinition> = {
    [hostLift]: lift,
  },
  seed = person(1).seed,
): ExerciseShareBody => {
  const body = buildExerciseShare({
    seed,
    credential: person(1).credential,
    ...pin,
    userId: id(2),
    exerciseIds: [system, hostLift],
    definitions,
    issuedAt: time,
  });
  if (!Object.keys(changes).length) return body;
  return {
    ...body,
    proof: signPayload({ ...body.proof.payload, ...changes }, seed),
  };
};
const frameBytes = (envelope: SharedEnvelope) =>
  new TextEncoder().encode(JSON.stringify(envelope)).length;

describe("a Nearby host shares its custom exercises with admitted guests (PER-60)", () => {
  let databases: DatabaseSync[],
    lobbies: TogetherLocalLobby[],
    engines: TogetherSharedSession[],
    sent: SharedEnvelope[],
    clock: number,
    custom: Record<string, TogetherSharedExerciseDefinition>;
  const make = (n: number) =>
    new TogetherSharedSession({
      lobby: lobbies[n - 1],
      seed: person(n).seed,
      randomBytes,
      randomUUID,
      now: () => clock,
      customExercises: (ids) =>
        Object.fromEntries(
          Object.entries(custom).filter(([key]) => ids.includes(key)),
        ),
      send: async (envelope) => {
        sent.push(envelope);
        const p = envelope.payload;
        for (let target = 2; target <= 3; target++)
          if (
            n === 1 &&
            lobbies[0].store
              .current(pin.sessionId)
              ?.payload.members.some(
                (m) => m.credential.payload.userId === id(target),
              ) &&
            (p.recipientId === "all" || p.recipientId === id(target))
          )
            engines[target - 1].accept(envelope, id(1));
      },
    });
  const admit = (n: number) => {
    lobbies[0].admit(request(n), person(n).credential, true);
    for (const lobby of lobbies.slice(1))
      for (const roster of lobbies[0].store.rosters(pin.sessionId))
        try {
          lobby.accept(roster);
        } catch {
          /* Already held. */
        }
  };
  beforeEach(() => {
    databases = [];
    lobbies = [];
    sent = [];
    clock = time;
    custom = { [hostLift]: lift };
    for (let n = 1; n <= 3; n++) {
      const db = new DatabaseSync(":memory:");
      databases.push(db);
      lobbies.push(
        new TogetherLocalLobby(new TogetherLocalStore(adapter(db), id(n)), {
          ...pin,
          ...person(n),
          trustedKeys: trusted,
          now: () => clock,
          deniedPairs: () => [],
          audience: "open",
          invitedUserIds: [],
        }),
      );
    }
    lobbies[0].start(person(1).consent);
    admit(2);
    engines = [make(1), make(2), make(3)];
  });
  afterEach(() => {
    engines.forEach((e) => e.dispose());
    databases.forEach((db) => db.close());
  });

  it("sends each admitted guest a proof for that guest, signed by the host, with the custom exercise's name", async () => {
    await engines[0].publishPlan(plan);
    const snapshot = engines[1].getSnapshot();
    expect(snapshot.exerciseDefinitions).toEqual({ [hostLift]: lift });
    const proof = snapshot.exerciseShare!.proof;
    expect(proof.payload).toEqual({
      kind: "together-exercise-share-v1",
      ...pin,
      userId: id(2),
      exerciseIds: [system, hostLift],
      issuedAt: time,
    });
    expect(snapshot.exerciseShare!.credential).toEqual(person(1).credential);
    expect(() =>
      verifySignature(proof, person(1).credential.payload.publicKey),
    ).not.toThrow();
    // Sealed to that guest: a third athlete never receives it.
    // Sent ahead of the plan, so a guest adopting the plan can name it.
    expect(sent.map((e) => e.payload.type)).toEqual(["exercises", "plan"]);
    const shares = sent.filter((e) => e.payload.type === "exercises");
    expect(shares.map((e) => e.payload.recipientId)).toEqual([id(2)]);
    expect(engines[2].getSnapshot().exerciseShare).toBeNull();
  });

  it("a guest admitted after the plan gets its own proof when the host replays to it", async () => {
    await engines[0].publishPlan(plan);
    admit(3);
    engines[2].dispose();
    engines[2] = make(3);
    engines[0].rosterChanged();
    const replay = engines[0].replay(id(3));
    const forThree = replay.filter((e) => e.payload.type === "exercises");
    expect(replay.map((e) => e.payload.type).slice(0, 2)).toEqual([
      "exercises",
      "plan",
    ]);
    expect(forThree.map((e) => e.payload.recipientId)).toEqual([id(3)]);
    for (const envelope of replay) engines[2].accept(envelope, id(1));
    expect(engines[2].getSnapshot().exerciseShare!.proof.payload.userId).toBe(
      id(3),
    );
    expect(engines[2].getSnapshot().exerciseDefinitions).toEqual({
      [hostLift]: lift,
    });
    // A second replay reuses that proof rather than signing another.
    expect(
      engines[0]
        .replay(id(3))
        .filter((e) => e.payload.type === "exercises")
        .map((e) => e.payload.id),
    ).toEqual(forThree.map((e) => e.payload.id));
  });

  it("a re-sent plan carries a fresh proof", async () => {
    await engines[0].publishPlan(plan);
    const first = engines[1].getSnapshot().exerciseShare!;
    clock += 5;
    await engines[0].publishPlan(plan);
    const second = engines[1].getSnapshot().exerciseShare!;
    expect(second.proof.payload.issuedAt).toBe(time + 5);
    expect(second.proof.signature).not.toBe(first.proof.signature);
  });

  it("sends nothing extra for a plan without the host's custom exercises", async () => {
    custom = {};
    await engines[0].publishPlan(plan);
    expect(sent.map((e) => e.payload.type)).toEqual(["plan"]);
    expect(
      engines[0].replay(id(2)).some((e) => e.payload.type === "exercises"),
    ).toBe(false);
    expect(engines[1].getSnapshot().exerciseShare).toBeNull();
  });

  it("restores the guest's share after a restart", async () => {
    await engines[0].publishPlan(plan);
    const before = engines[1].getSnapshot().exerciseShare;
    engines[1].dispose();
    engines[1] = make(2);
    expect(engines[1].getSnapshot().exerciseShare).toEqual(before);
  });

  it("refuses a share sent by anyone but the host or addressed to another guest", async () => {
    admit(3);
    engines.forEach((e) => e.dispose());
    engines = [make(1), make(2), make(3)];
    await engines[0].publishPlan(plan);
    const original = sent.find(
      (e) => e.payload.type === "exercises" && e.payload.recipientId === id(2),
    )!;
    const own = () =>
      engines[2].getSnapshot().exerciseShare?.proof.payload.userId;
    // The envelope for guest 2, offered to guest 3, isn't for it to read.
    expect(own()).toBe(id(3));
    engines[2].accept(original, id(1));
    expect(own()).toBe(id(3));
    // A guest can't author one.
    const forged = signPayload(
      { ...original.payload, authorId: id(2), id: randomUUID() },
      person(2).seed,
    );
    expect(() => engines[2].accept(forged, id(2))).toThrow();
  });

  it("fits the frame at the worst case: 100 custom exercises with the longest names and most muscles", async () => {
    const exercises = Array.from({ length: MAX_SHARED_EXERCISES }, (_, i) => ({
      planExerciseId: id(1000 + i),
      exerciseId: id(2000 + i),
      order: i,
      targetSets: 100,
    }));
    const widest = "\u{1F3CB}".repeat(60); // 120 UTF-16 units, 240 bytes
    custom = Object.fromEntries(
      exercises.map((e) => [
        e.exerciseId,
        {
          name: widest,
          category: "plyometric",
          primaryMuscles: Array.from({ length: 8 }, () => "m".repeat(64)),
        },
      ]),
    );
    const big = { name: "x".repeat(120), exercises };
    await engines[0].publishPlan(big);
    const envelope = sent.find((e) => e.payload.type === "exercises")!;
    expect(frameBytes(envelope)).toBeLessThanOrEqual(MAX_SHARED_BYTES);
    const received = engines[1].getSnapshot();
    // The proof always covers the whole plan; names fill the room left.
    expect(received.exerciseShare!.proof.payload.exerciseIds).toHaveLength(100);
    const named = Object.keys(received.exerciseDefinitions!);
    expect(named.length).toBeGreaterThan(30);
    expect(named.length).toBeLessThan(100);
  });

  it("names every exercise of a long plan of ordinary custom exercises", async () => {
    const exercises = Array.from({ length: MAX_SHARED_EXERCISES }, (_, i) => ({
      planExerciseId: id(1000 + i),
      exerciseId: id(2000 + i),
      order: i,
      targetSets: 3,
    }));
    custom = Object.fromEntries(
      exercises.map((e, i) => [
        e.exerciseId,
        {
          name: `Bulgarian split squat variation ${i}`,
          category: "strength",
          primaryMuscles: [id(3000 + i), id(4000 + i)],
        },
      ]),
    );
    await engines[0].publishPlan({ name: "Long", exercises });
    const envelope = sent.find((e) => e.payload.type === "exercises")!;
    expect(frameBytes(envelope)).toBeLessThanOrEqual(MAX_SHARED_BYTES);
    expect(
      Object.keys(engines[1].getSnapshot().exerciseDefinitions!),
    ).toHaveLength(100);
  });
});

describe("guest validation of a host's exercise share", () => {
  it("accepts the host's share for this guest", () => {
    const body = share();
    expect(readExerciseShare(body, expected(id(2)))).toEqual(body);
    expect(requestHash(body.credential)).toBe(
      requestHash(person(1).credential),
    );
  });
  it.each<[string, () => unknown]>([
    ["another guest's share", () => share({ userId: id(3) })],
    ["another session's share", () => share({ sessionId: id(101) })],
    ["another host device", () => share({ hostDeviceId: id(12) })],
    [
      "a share not signed by the host",
      () => share({}, undefined, person(2).seed),
    ],
    [
      "a credential other than the host's",
      () => ({ ...share(), credential: person(2).credential }),
    ],
    ["an unknown field", () => ({ ...share(), extra: true })],
    ["a missing field", () => ({ credential: share().credential })],
    [
      "a proof with an unknown field",
      () => {
        const body = share();
        return {
          ...body,
          proof: signPayload(
            { ...body.proof.payload, extra: 1 },
            person(1).seed,
          ),
        };
      },
    ],
    [
      "more than 100 exercises",
      () =>
        share({
          exerciseIds: Array.from({ length: 101 }, (_, i) => id(5000 + i)),
        }),
    ],
    ["repeated exercises", () => share({ exerciseIds: [system, system] })],
    ["no exercises", () => share({ exerciseIds: [] })],
    [
      "a definition for an exercise the proof doesn't name",
      () => ({ ...share(), definitions: { [id(99)]: lift } }),
    ],
    [
      "a name over 120 characters",
      () => ({
        ...share(),
        definitions: { [hostLift]: { ...lift, name: "x".repeat(121) } },
      }),
    ],
    [
      "a blank name",
      () => ({
        ...share(),
        definitions: { [hostLift]: { ...lift, name: "  " } },
      }),
    ],
    [
      "an unknown category",
      () => ({
        ...share(),
        definitions: { [hostLift]: { ...lift, category: "yoga" } },
      }),
    ],
    [
      "more than 8 muscles",
      () => ({
        ...share(),
        definitions: {
          [hostLift]: { ...lift, primaryMuscles: Array(9).fill("m") },
        },
      }),
    ],
    [
      "an oversized muscle",
      () => ({
        ...share(),
        definitions: {
          [hostLift]: { ...lift, primaryMuscles: ["m".repeat(65)] },
        },
      }),
    ],
    [
      "a definition with an extra field",
      () => ({
        ...share(),
        definitions: { [hostLift]: { ...lift, videoUrl: "x" } },
      }),
    ],
    ["definitions as an array", () => ({ ...share(), definitions: [] })],
  ])("refuses %s", (_, body) => {
    expect(() => readExerciseShare(body(), expected(id(2)))).toThrow();
  });
  it("trims what the host sends to what the wire allows", () => {
    const body = share(
      {},
      {
        [hostLift]: {
          name: `  ${"a".repeat(119)}\u{1F3CB}  `,
          category: "unknown" as never,
          primaryMuscles: [
            ...Array(9).fill("m"),
            "",
            "x".repeat(65),
          ] as string[],
        },
        [id(99)]: lift,
      },
    );
    expect(body.definitions).toEqual({
      [hostLift]: {
        name: "a".repeat(119),
        category: null,
        primaryMuscles: Array(8).fill("m"),
      },
    });
    expect(readExerciseShare(body, expected(id(2)))).toEqual(body);
  });
});

describe("a host's own custom exercises from its library", () => {
  const exercise = (id: string, createdBy: string | null): Exercise =>
    ({
      id,
      name: `Lift ${id}`,
      category: "strength",
      primaryMuscleGroups: ["m1"],
      createdBy,
    }) as unknown as Exercise;
  it("includes only exercises the host created among the plan's", () => {
    expect(
      ownCustomExercises(
        [
          exercise("a", "host"),
          exercise("b", null),
          exercise("c", "00000000-0000-0000-0000-000000000000"),
          exercise("d", "someone"),
          exercise("e", "host"),
        ],
        "host",
        ["a", "b", "c", "d"],
      ),
    ).toEqual({
      a: { name: "Lift a", category: "strength", primaryMuscles: ["m1"] },
    });
  });
});
