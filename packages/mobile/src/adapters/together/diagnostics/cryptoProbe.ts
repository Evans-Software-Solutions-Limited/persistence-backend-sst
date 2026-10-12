/**
 * Together crypto probe (PER-20 F9 calibration).
 *
 * A pure benchmark runner that times the exact `@noble/*` primitives and the
 * `identity.ts` roster chain the live-update path uses, so the Hermes
 * multiplier against the 11 October desktop audit can be measured on a real
 * build. Diagnostic only: it touches no Together runtime code, adds no
 * dependency, and the fixtures are constant-seed test identities (never real
 * credentials). The screen at `app/(app)/together-probe.tsx` drives it.
 *
 * Audit: https://linear.app/evans-software-solutions/document/together-performance-audit-implementation-and-performance-pass-11-0742b327c246
 */
import { ed25519 } from "@noble/curves/ed25519.js";
import { chacha20poly1305 } from "@noble/ciphers/chacha.js";
import {
  getCryptoBackend,
  type CryptoBackendName,
} from "../security/cryptoBackend";
import {
  publicKeyPem,
  requestHash,
  signPayload,
  verifyRoster,
  verifySignature,
  type Credential,
  type JoinConsent,
  type OfflineRoster,
  type RosterMember,
  type Signed,
  type TrustedKeys,
} from "../security/identity";
import { decode64 } from "../security/encoding";
import type { TogetherJournalDatabase } from "../../storage/togetherJournal";

export const CRYPTO_PROBE_VERSION = "together-crypto-probe-v1";

/** Fixed clock and seeds mirror `lobbyController.test.ts` so the roster is reproducible. */
export const PROBE_NOW = 1700000000000;
const AUTHORITY_SEED = new Uint8Array(32).fill(77);

export type ProbeBenchmarkName =
  | "ed25519.sign"
  | "ed25519.verify"
  | "x25519+sha256 key derivation"
  | "chacha20poly1305 encrypt 2KB"
  | "requestHash(4-member roster)"
  | "verifyRoster(4 members)"
  | "verifyRoster(2 members)"
  | "JSON clone 20KB"
  | "SQLite read-all + JSON.parse 4 roster rows";

export interface ProbeBenchmark {
  name: ProbeBenchmarkName;
  iterations: number;
  totalMs: number;
  msPerOp: number;
  /** Present when the benchmark could not run (for example, no database). */
  skipped?: string;
}

export interface ProbeIterations {
  sign: number;
  verify: number;
  keyDerivation: number;
  aead: number;
  requestHash: number;
  verifyRoster: number;
  verifyRoster2: number;
  jsonClone: number;
  sqliteRead: number;
}

/** Iteration counts from the PER-20 brief. */
export const DEFAULT_PROBE_ITERATIONS: ProbeIterations = {
  sign: 100,
  verify: 100,
  keyDerivation: 100,
  aead: 200,
  requestHash: 100,
  verifyRoster: 20,
  verifyRoster2: 20,
  jsonClone: 100,
  sqliteRead: 100,
};

export interface ProbeEnvironment {
  platform: string;
  osVersion: string | null;
  deviceModel: string | null;
  /** `__DEV__` on the device; a Debug build gives misleading Hermes numbers. */
  devBuild: boolean | null;
}

export interface ProbeEngine {
  hermes: boolean;
  runtimeProperties: Record<string, string> | null;
  /** Active Together crypto backend (D16): "native" or the pure-JS "noble" fallback. */
  cryptoBackend: CryptoBackendName;
}

export interface ProbeOperationCounts {
  verifyRoster: number;
  sign: number;
  verify: number;
  keyDerivation: number;
  aead: number;
}

export interface ProbeRoleEstimate {
  counts: ProbeOperationCounts;
  /** Which verifyRoster benchmark the estimate used. */
  rosterBenchmark: ProbeBenchmarkName;
  totalMs: number;
}

export interface ProbeEstimate {
  participants: 2 | 4;
  sender: ProbeRoleEstimate;
  receiver: ProbeRoleEstimate;
}

export interface CryptoProbeReport {
  version: typeof CRYPTO_PROBE_VERSION;
  generatedAt: string;
  engine: ProbeEngine;
  environment: ProbeEnvironment;
  fixture: {
    members: number;
    rosterBytes: number;
    roster2Bytes: number;
    clonePayloadBytes: number;
    signPayloadBytes: number;
    aeadPlaintextBytes: number;
    sqliteRowBytes: number[];
  };
  benchmarks: ProbeBenchmark[];
  estimates: ProbeEstimate[];
}

export interface CryptoProbeOptions {
  /** Database for the SQLite benchmark; `openDatabaseSync(...)` satisfies it. */
  database?: TogetherJournalDatabase;
  iterations?: Partial<ProbeIterations>;
  environment?: Partial<ProbeEnvironment>;
  onProgress?: (step: ProbeBenchmarkName, index: number, total: number) => void;
  /** High-resolution clock in ms; defaults to `performance.now()`. */
  now?: () => number;
  /** Cooperative yield between benchmarks; defaults to `setTimeout(0)`. */
  yieldToUi?: () => Promise<void>;
}

/**
 * Per-set operation counts from the audit (section 3, 4 participants, numbers
 * grants): host 56 `verifyRoster`, 12 signs, 9 key derivations, 9 AEAD seals;
 * each receiver 19 `verifyRoster`, 1 verify, 1 key derivation, 1 AEAD open.
 * At 2 participants the audit measured 28 sender / 19 receiver roster
 * verifications; the sign/key/AEAD counts are scaled by recipient count
 * (3 recipients → 1), which is this module's assumption, not an audit figure.
 */
export const AUDIT_OPERATION_COUNTS: Record<
  2 | 4,
  { sender: ProbeOperationCounts; receiver: ProbeOperationCounts }
> = {
  4: {
    sender: {
      verifyRoster: 56,
      sign: 12,
      verify: 0,
      keyDerivation: 9,
      aead: 9,
    },
    receiver: {
      verifyRoster: 19,
      sign: 0,
      verify: 1,
      keyDerivation: 1,
      aead: 1,
    },
  },
  2: {
    sender: { verifyRoster: 28, sign: 6, verify: 0, keyDerivation: 3, aead: 3 },
    receiver: {
      verifyRoster: 19,
      sign: 0,
      verify: 1,
      keyDerivation: 1,
      aead: 1,
    },
  },
};

const id = (n: number) =>
  `${n.toString(16).padStart(8, "0")}-1111-4111-8111-111111111111`;

export interface ProbePerson {
  seed: Uint8Array;
  userId: string;
  deviceId: string;
  credential: Signed<Credential>;
}

export interface ProbeFixture {
  trusted: TrustedKeys;
  host: ProbePerson;
  guest: ProbePerson;
  /** Host plus three approved members with signed consents. */
  roster: Signed<OfflineRoster>;
  /** Host plus one approved member, for the 2-participant projection. */
  roster2: Signed<OfflineRoster>;
  signPayload: Uint8Array;
  aeadPlaintext: Uint8Array;
  clonePayload: unknown;
}

function person(n: number, trusted: TrustedKeys): ProbePerson {
  const seed = new Uint8Array(32).fill(n);
  return {
    seed,
    userId: id(n),
    deviceId: id(n + 10),
    credential: signPayload<Credential>(
      {
        kind: "together-device-v1",
        keyId: "v1",
        userId: id(n),
        deviceId: id(n + 10),
        publicKey: publicKeyPem(seed),
        issuedAt: PROBE_NOW - 100,
        expiresAt: PROBE_NOW + 60000,
      },
      AUTHORITY_SEED,
    ),
  };
}

function member(
  p: ProbePerson,
  n: number,
  admission: RosterMember["admission"],
): RosterMember {
  return {
    credential: p.credential,
    admission,
    consent: signPayload<JoinConsent>(
      {
        kind: "together-consent-v1",
        sessionId: id(100),
        hostUserId: id(1),
        hostDeviceId: id(11),
        userId: p.userId,
        deviceId: p.deviceId,
        executionId: id(n + 20),
        nonce: id(n + 30),
        consentVersion: "together-v1",
        consentAccepted: true,
      },
      p.seed,
    ),
  };
}

function roster(
  members: RosterMember[],
  hostSeed: Uint8Array,
): Signed<OfflineRoster> {
  return signPayload<OfflineRoster>(
    {
      kind: "together-roster-v1",
      sessionId: id(100),
      hostUserId: id(1),
      hostDeviceId: id(11),
      revision: 1,
      previousHash: null,
      members,
    },
    hostSeed,
  );
}

function bytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).length;
}

/** Deterministic padding so sizes are stable across runs and engines. */
function filler(length: number): string {
  let out = "";
  while (out.length < length)
    out += `set:${out.length.toString(36)};reps:10;weightKg:60;`;
  return out.slice(0, length);
}

/** Roughly 20 KB JSON object shaped like a shared snapshot (plan + projections). */
function clonePayloadFixture(targetBytes: number): unknown {
  const exercises = Array.from({ length: 6 }, (_, e) => ({
    exerciseId: id(500 + e),
    name: `Exercise ${e + 1}`,
    sets: Array.from({ length: 4 }, (_, s) => ({
      setNumber: s + 1,
      reps: 10,
      weightKg: 60 + s * 2.5,
      completed: s < 2,
    })),
  }));
  const base = {
    kind: "snapshot",
    sessionId: id(100),
    revision: 12,
    members: [1, 2, 3, 4].map((n) => ({
      userId: id(n),
      plan: { exercises },
      projection: { exercises },
    })),
    padding: "",
  };
  const remaining = Math.max(0, targetBytes - bytes(base));
  return { ...base, padding: filler(remaining) };
}

export function buildProbeFixture(): ProbeFixture {
  const trusted: TrustedKeys = { v1: publicKeyPem(AUTHORITY_SEED) };
  const people = [1, 2, 3, 4].map((n) => person(n, trusted));
  const members = people.map((p, i) =>
    member(p, i + 1, i === 0 ? "host" : "approved"),
  );
  const host = people[0];
  return {
    trusted,
    host,
    guest: people[1],
    roster: roster(members, host.seed),
    roster2: roster(members.slice(0, 2), host.seed),
    signPayload: new TextEncoder().encode(filler(500)),
    aeadPlaintext: new TextEncoder().encode(filler(2048)),
    clonePayload: clonePayloadFixture(20 * 1024),
  };
}

function rawPublicKey(pem: string): Uint8Array {
  return decode64(pem.split("\n")[1]).slice(12);
}

/** Exactly what `sharedSession.ts` `key()` computes per seal/unseal. */
export function deriveSharedKey(
  seed: Uint8Array,
  peerPublicKeyPem: string,
): Uint8Array {
  const secret = ed25519.utils.toMontgomerySecret(seed);
  try {
    const crypto = getCryptoBackend();
    return crypto.sha256(
      crypto.x25519SharedSecret(
        secret,
        ed25519.utils.toMontgomery(rawPublicKey(peerPublicKeyPem)),
      ),
    );
  } finally {
    secret.fill(0);
  }
}

export function detectEngine(): ProbeEngine {
  const internal = (
    globalThis as {
      HermesInternal?: {
        getRuntimeProperties?: () => Record<string, string>;
      };
    }
  ).HermesInternal;
  const cryptoBackend = getCryptoBackend().name;
  if (!internal)
    return { hermes: false, runtimeProperties: null, cryptoBackend };
  let runtimeProperties: Record<string, string> | null = null;
  try {
    runtimeProperties = internal.getRuntimeProperties?.() ?? null;
  } catch {
    runtimeProperties = null;
  }
  return { hermes: true, runtimeProperties, cryptoBackend };
}

const defaultNow = (): number =>
  typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();

const defaultYield = () =>
  new Promise<void>((resolve) => setTimeout(resolve, 0));

const PROBE_TABLE = "together_crypto_probe_rows";

export async function runCryptoProbe(
  options: CryptoProbeOptions = {},
): Promise<CryptoProbeReport> {
  const iterations = { ...DEFAULT_PROBE_ITERATIONS, ...options.iterations };
  const now = options.now ?? defaultNow;
  const yieldToUi = options.yieldToUi ?? defaultYield;
  const fixture = buildProbeFixture();
  const { host, guest, roster: roster4, roster2, trusted } = fixture;

  // Precompute inputs so each timed loop measures one primitive only.
  const signature = getCryptoBackend().ed25519Sign(
    fixture.signPayload,
    host.seed,
  );
  const hostPublicKey = rawPublicKey(host.credential.payload.publicKey);
  const aeadKey = deriveSharedKey(
    host.seed,
    guest.credential.payload.publicKey,
  );
  const nonce = new Uint8Array(12).fill(7);
  const aad = new TextEncoder().encode(
    JSON.stringify({ type: "progress", authorId: host.userId }),
  );
  const rosterJson = JSON.stringify(roster4);
  const sqliteRowBytes: number[] = [];

  type Step = {
    name: ProbeBenchmarkName;
    iterations: number;
    op: () => unknown;
    prepare?: () => void;
    cleanup?: () => void;
    skipped?: string;
  };

  let sink: unknown;
  const steps: Step[] = [
    {
      name: "ed25519.sign",
      iterations: iterations.sign,
      op: () =>
        (sink = getCryptoBackend().ed25519Sign(fixture.signPayload, host.seed)),
    },
    {
      name: "ed25519.verify",
      iterations: iterations.verify,
      op: () => {
        const ok = getCryptoBackend().ed25519Verify(
          signature,
          fixture.signPayload,
          hostPublicKey,
        );
        if (!ok) throw new Error("probe: ed25519.verify returned false");
        sink = ok;
      },
    },
    {
      name: "x25519+sha256 key derivation",
      iterations: iterations.keyDerivation,
      op: () =>
        (sink = deriveSharedKey(host.seed, guest.credential.payload.publicKey)),
    },
    {
      name: "chacha20poly1305 encrypt 2KB",
      iterations: iterations.aead,
      op: () =>
        (sink = chacha20poly1305(aeadKey, nonce, aad).encrypt(
          fixture.aeadPlaintext,
        )),
    },
    {
      name: "requestHash(4-member roster)",
      iterations: iterations.requestHash,
      op: () => (sink = requestHash(roster4.payload)),
    },
    {
      name: "verifyRoster(4 members)",
      iterations: iterations.verifyRoster,
      op: () => (sink = verifyRoster(roster4, trusted, null, [], PROBE_NOW)),
    },
    {
      name: "verifyRoster(2 members)",
      iterations: iterations.verifyRoster2,
      op: () => (sink = verifyRoster(roster2, trusted, null, [], PROBE_NOW)),
    },
    {
      name: "JSON clone 20KB",
      iterations: iterations.jsonClone,
      op: () => (sink = JSON.parse(JSON.stringify(fixture.clonePayload))),
    },
    {
      name: "SQLite read-all + JSON.parse 4 roster rows",
      iterations: iterations.sqliteRead,
      skipped: options.database ? undefined : "no database supplied",
      prepare: () => {
        const db = options.database!;
        db.execSync(`DROP TABLE IF EXISTS ${PROBE_TABLE}`);
        db.execSync(
          `CREATE TABLE ${PROBE_TABLE} (sequence INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL, revision INTEGER NOT NULL, payload TEXT NOT NULL)`,
        );
        db.withTransactionSync(() => {
          for (let revision = 1; revision <= 4; revision++) {
            db.runSync(
              `INSERT INTO ${PROBE_TABLE} (session_id, revision, payload) VALUES (?, ?, ?)`,
              [id(100), revision, rosterJson],
            );
            sqliteRowBytes.push(new TextEncoder().encode(rosterJson).length);
          }
        });
      },
      op: () => {
        const rows = options.database!.getAllSync<{ payload: string }>(
          `SELECT payload FROM ${PROBE_TABLE} WHERE session_id = ? ORDER BY revision`,
          [id(100)],
        );
        if (rows.length !== 4)
          throw new Error(`probe: expected 4 rows, read ${rows.length}`);
        sink = rows.map((row) => JSON.parse(row.payload) as unknown);
      },
      cleanup: () => {
        options.database!.execSync(`DROP TABLE IF EXISTS ${PROBE_TABLE}`);
      },
    },
  ];

  const benchmarks: ProbeBenchmark[] = [];
  for (let index = 0; index < steps.length; index++) {
    const step = steps[index];
    options.onProgress?.(step.name, index, steps.length);
    await yieldToUi();
    if (step.skipped) {
      benchmarks.push({
        name: step.name,
        iterations: 0,
        totalMs: 0,
        msPerOp: 0,
        skipped: step.skipped,
      });
      continue;
    }
    step.prepare?.();
    try {
      // One untimed warm-up so lazily initialised tables don't land in run 1.
      step.op();
      const start = now();
      for (let i = 0; i < step.iterations; i++) step.op();
      const totalMs = now() - start;
      benchmarks.push({
        name: step.name,
        iterations: step.iterations,
        totalMs,
        msPerOp: totalMs / step.iterations,
      });
    } finally {
      step.cleanup?.();
    }
  }
  void sink;
  options.onProgress?.(
    steps[steps.length - 1].name,
    steps.length,
    steps.length,
  );

  return {
    version: CRYPTO_PROBE_VERSION,
    generatedAt: new Date().toISOString(),
    engine: detectEngine(),
    environment: {
      platform: options.environment?.platform ?? "unknown",
      osVersion: options.environment?.osVersion ?? null,
      deviceModel: options.environment?.deviceModel ?? null,
      devBuild: options.environment?.devBuild ?? null,
    },
    fixture: {
      members: roster4.payload.members.length,
      rosterBytes: bytes(roster4),
      roster2Bytes: bytes(roster2),
      clonePayloadBytes: bytes(fixture.clonePayload),
      signPayloadBytes: fixture.signPayload.length,
      aeadPlaintextBytes: fixture.aeadPlaintext.length,
      sqliteRowBytes,
    },
    benchmarks,
    estimates: deriveEstimates(benchmarks),
  };
}

function msPerOp(benchmarks: ProbeBenchmark[], name: ProbeBenchmarkName) {
  const found = benchmarks.find((b) => b.name === name && !b.skipped);
  return found ? found.msPerOp : Number.NaN;
}

export function estimateRole(
  counts: ProbeOperationCounts,
  unit: {
    verifyRoster: number;
    sign: number;
    verify: number;
    keyDerivation: number;
    aead: number;
  },
): number {
  return (
    counts.verifyRoster * unit.verifyRoster +
    counts.sign * unit.sign +
    counts.verify * unit.verify +
    counts.keyDerivation * unit.keyDerivation +
    counts.aead * unit.aead
  );
}

/** Per-set crypto time for sender and receiver at 2 and 4 participants. */
export function deriveEstimates(benchmarks: ProbeBenchmark[]): ProbeEstimate[] {
  const shared = {
    sign: msPerOp(benchmarks, "ed25519.sign"),
    verify: msPerOp(benchmarks, "ed25519.verify"),
    keyDerivation: msPerOp(benchmarks, "x25519+sha256 key derivation"),
    aead: msPerOp(benchmarks, "chacha20poly1305 encrypt 2KB"),
  };
  return ([4, 2] as const).map((participants) => {
    const rosterBenchmark: ProbeBenchmarkName =
      participants === 4
        ? "verifyRoster(4 members)"
        : "verifyRoster(2 members)";
    const unit = {
      ...shared,
      verifyRoster: msPerOp(benchmarks, rosterBenchmark),
    };
    const counts = AUDIT_OPERATION_COUNTS[participants];
    return {
      participants,
      sender: {
        counts: counts.sender,
        rosterBenchmark,
        totalMs: estimateRole(counts.sender, unit),
      },
      receiver: {
        counts: counts.receiver,
        rosterBenchmark,
        totalMs: estimateRole(counts.receiver, unit),
      },
    };
  });
}

/** Sanity hook for the screen: the fixture must verify before timing means anything. */
export function assertFixtureVerifies(fixture = buildProbeFixture()): void {
  const result = verifyRoster(
    fixture.roster,
    fixture.trusted,
    null,
    [],
    PROBE_NOW,
  );
  if (result.userIds.length !== 4)
    throw new Error("probe fixture: expected four verified members");
  verifySignature(fixture.host.credential, fixture.trusted.v1);
}
