/** @jest-environment node */
import { DatabaseSync } from "node:sqlite";
import {
  AUDIT_OPERATION_COUNTS,
  PROBE_NOW,
  assertFixtureVerifies,
  buildProbeFixture,
  deriveEstimates,
  detectEngine,
  runCryptoProbe,
  type ProbeBenchmark,
  type ProbeBenchmarkName,
} from "../diagnostics/cryptoProbe";
import {
  signPayload,
  verifyRoster,
  type OfflineRoster,
  type Signed,
} from "../security/identity";
import type { TogetherJournalDatabase } from "../../storage/togetherJournal";
import { redirectSystemPathForDeepLink } from "@/application/notifications/deep-link";

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

// Jest-expo installs a millisecond-resolution `performance.now` polyfill, so the
// tests inject a high-resolution clock; on Hermes the default clock is high-res.
const hrNow = () => Number(process.hrtime.bigint()) / 1e6;

const small = {
  sign: 3,
  verify: 3,
  keyDerivation: 3,
  aead: 3,
  requestHash: 3,
  verifyRoster: 2,
  verifyRoster2: 2,
  jsonClone: 3,
  sqliteRead: 3,
};

const ORDER: ProbeBenchmarkName[] = [
  "ed25519.sign",
  "ed25519.verify",
  "x25519+sha256 key derivation",
  "chacha20poly1305 encrypt 2KB",
  "requestHash(4-member roster)",
  "verifyRoster(4 members)",
  "verifyRoster(2 members)",
  "JSON clone 20KB",
  "SQLite read-all + JSON.parse 4 roster rows",
];

describe("Together crypto probe (PER-20 Hermes calibration)", () => {
  it("runs every benchmark against real crypto and real SQLite and reports finite positive timings", async () => {
    const db = new DatabaseSync(":memory:");
    const progress: [ProbeBenchmarkName, number, number][] = [];
    let yields = 0;
    const report = await runCryptoProbe({
      database: adapter(db),
      iterations: small,
      now: hrNow,
      environment: {
        platform: "test",
        osVersion: "node",
        deviceModel: null,
        devBuild: false,
      },
      onProgress: (step, index, total) => progress.push([step, index, total]),
      yieldToUi: async () => {
        yields++;
      },
    });

    expect(report.version).toBe("together-crypto-probe-v1");
    expect(Number.isNaN(Date.parse(report.generatedAt))).toBe(false);
    expect(report.engine).toEqual({ hermes: false, runtimeProperties: null });
    expect(report.environment).toEqual({
      platform: "test",
      osVersion: "node",
      deviceModel: null,
      devBuild: false,
    });

    expect(report.benchmarks.map((b) => b.name)).toEqual(ORDER);
    for (const benchmark of report.benchmarks) {
      expect(benchmark.skipped).toBeUndefined();
      expect(benchmark.iterations).toBeGreaterThan(0);
      expect(Number.isFinite(benchmark.totalMs)).toBe(true);
      expect(Number.isFinite(benchmark.msPerOp)).toBe(true);
      expect(benchmark.msPerOp).toBeGreaterThan(0);
      expect(benchmark.msPerOp).toBeCloseTo(
        benchmark.totalMs / benchmark.iterations,
        10,
      );
    }
    const byName = Object.fromEntries(
      report.benchmarks.map((b) => [b.name, b]),
    ) as Record<ProbeBenchmarkName, ProbeBenchmark>;
    expect(byName["ed25519.sign"].iterations).toBe(3);
    expect(byName["chacha20poly1305 encrypt 2KB"].iterations).toBe(3);
    expect(byName["verifyRoster(4 members)"].iterations).toBe(2);

    // Fixture sizes match the brief: 500 B sign payload, 2 KB AEAD plaintext,
    // ~20 KB clone object, four ~4.5 KB roster rows.
    expect(report.fixture.members).toBe(4);
    expect(report.fixture.signPayloadBytes).toBe(500);
    expect(report.fixture.aeadPlaintextBytes).toBe(2048);
    expect(report.fixture.clonePayloadBytes).toBeGreaterThanOrEqual(20 * 1024);
    expect(report.fixture.clonePayloadBytes).toBeLessThan(21 * 1024);
    expect(report.fixture.sqliteRowBytes).toHaveLength(4);
    for (const size of report.fixture.sqliteRowBytes) {
      expect(size).toBe(report.fixture.rosterBytes);
      expect(size).toBeGreaterThan(4000);
      expect(size).toBeLessThan(5500);
    }
    expect(report.fixture.roster2Bytes).toBeLessThan(
      report.fixture.rosterBytes,
    );

    // Progress is reported once per benchmark plus a final completion tick,
    // and the runner yields once per benchmark so a screen can repaint.
    expect(progress.map(([name]) => name)).toEqual([...ORDER, ORDER[8]]);
    expect(progress.map(([, index]) => index)).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7, 8, 9,
    ]);
    expect(progress.every(([, , total]) => total === 9)).toBe(true);
    expect(yields).toBe(9);

    // The probe table is cleaned up after the SQLite benchmark.
    expect(
      db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'together_crypto_probe_rows'",
        )
        .all(),
    ).toEqual([]);

    // Estimates use the audit counts and the measured unit costs.
    expect(report.estimates.map((e) => e.participants)).toEqual([4, 2]);
    const four = report.estimates[0];
    const unit = (name: ProbeBenchmarkName) => byName[name].msPerOp;
    expect(four.sender.counts).toEqual(AUDIT_OPERATION_COUNTS[4].sender);
    expect(four.sender.rosterBenchmark).toBe("verifyRoster(4 members)");
    expect(four.sender.totalMs).toBeCloseTo(
      56 * unit("verifyRoster(4 members)") +
        12 * unit("ed25519.sign") +
        9 * unit("x25519+sha256 key derivation") +
        9 * unit("chacha20poly1305 encrypt 2KB"),
      8,
    );
    expect(four.receiver.totalMs).toBeCloseTo(
      19 * unit("verifyRoster(4 members)") +
        1 * unit("ed25519.verify") +
        1 * unit("x25519+sha256 key derivation") +
        1 * unit("chacha20poly1305 encrypt 2KB"),
      8,
    );
    const two = report.estimates[1];
    expect(two.sender.rosterBenchmark).toBe("verifyRoster(2 members)");
    expect(two.sender.totalMs).toBeCloseTo(
      28 * unit("verifyRoster(2 members)") +
        6 * unit("ed25519.sign") +
        3 * unit("x25519+sha256 key derivation") +
        3 * unit("chacha20poly1305 encrypt 2KB"),
      8,
    );
    expect(two.receiver.totalMs).toBeCloseTo(
      19 * unit("verifyRoster(2 members)") +
        unit("ed25519.verify") +
        unit("x25519+sha256 key derivation") +
        unit("chacha20poly1305 encrypt 2KB"),
      8,
    );
    expect(four.sender.totalMs).toBeGreaterThan(four.receiver.totalMs);
    expect(four.sender.totalMs).toBeGreaterThan(two.sender.totalMs);
    db.close();
  });

  it("marks the SQLite benchmark skipped when no database is supplied and excludes it from estimates", async () => {
    const report = await runCryptoProbe({
      iterations: small,
      yieldToUi: async () => {},
      now: hrNow,
    });
    const sqlite = report.benchmarks.find((b) => b.name.startsWith("SQLite"))!;
    expect(sqlite).toEqual({
      name: "SQLite read-all + JSON.parse 4 roster rows",
      iterations: 0,
      totalMs: 0,
      msPerOp: 0,
      skipped: "no database supplied",
    });
    expect(report.fixture.sqliteRowBytes).toEqual([]);
    expect(report.environment).toEqual({
      platform: "unknown",
      osVersion: null,
      deviceModel: null,
      devBuild: null,
    });
    for (const estimate of report.estimates) {
      expect(Number.isFinite(estimate.sender.totalMs)).toBe(true);
      expect(Number.isFinite(estimate.receiver.totalMs)).toBe(true);
    }
  });

  it("uses the injected clock and yields with setTimeout(0) by default", async () => {
    let tick = 0;
    const report = await runCryptoProbe({
      iterations: small,
      now: () => (tick += 10),
    });
    // Each benchmark reads the clock twice: 10 ms per benchmark in total.
    for (const benchmark of report.benchmarks.filter((b) => !b.skipped)) {
      expect(benchmark.totalMs).toBe(10);
      expect(benchmark.msPerOp).toBe(10 / benchmark.iterations);
    }
  });

  it("builds a roster that genuinely verifies and rejects tampering with a member's consent", () => {
    const fixture = buildProbeFixture();
    expect(() => assertFixtureVerifies(fixture)).not.toThrow();
    const verified = verifyRoster(
      fixture.roster,
      fixture.trusted,
      null,
      [],
      PROBE_NOW,
    );
    expect(verified.revision).toBe(1);
    expect(verified.userIds).toHaveLength(4);
    expect(fixture.roster.payload.members.map((m) => m.admission)).toEqual([
      "host",
      "approved",
      "approved",
      "approved",
    ]);

    // Tampered consent inside the signed roster: the roster signature fails.
    const tampered: Signed<OfflineRoster> = JSON.parse(
      JSON.stringify(fixture.roster),
    );
    tampered.payload.members[2].consent.payload.executionId =
      "ffffffff-1111-4111-8111-111111111111";
    expect(() =>
      verifyRoster(tampered, fixture.trusted, null, [], PROBE_NOW),
    ).toThrow("INVALID_PROOF");

    // Re-signed by the host over the tampered consent: the consent's own
    // signature no longer matches, so the chain still rejects it.
    const resigned = signPayload(tampered.payload, fixture.host.seed);
    expect(() =>
      verifyRoster(resigned, fixture.trusted, null, [], PROBE_NOW),
    ).toThrow("INVALID_PROOF");

    // A valid consent moved onto another member binds the wrong identity.
    const swapped: Signed<OfflineRoster> = JSON.parse(
      JSON.stringify(fixture.roster),
    );
    swapped.payload.members[3].consent = swapped.payload.members[2].consent;
    expect(() =>
      verifyRoster(
        signPayload(swapped.payload, fixture.host.seed),
        fixture.trusted,
        null,
        [],
        PROBE_NOW,
      ),
    ).toThrow("INVALID_PROOF");

    // Wrong authority: credentials are not trusted.
    expect(() =>
      verifyRoster(
        fixture.roster,
        { v1: fixture.host.credential.payload.publicKey },
        null,
        [],
        PROBE_NOW,
      ),
    ).toThrow("INVALID_PROOF");

    // Fixture is deterministic across builds (constant seeds, fixed clock).
    expect(buildProbeFixture().roster).toEqual(fixture.roster);
  });

  it("detects Hermes through HermesInternal when present", () => {
    const g = globalThis as { HermesInternal?: unknown };
    expect(detectEngine()).toEqual({ hermes: false, runtimeProperties: null });
    g.HermesInternal = {
      getRuntimeProperties: () => ({ "OSS Release Version": "0.13.0" }),
    };
    try {
      expect(detectEngine()).toEqual({
        hermes: true,
        runtimeProperties: { "OSS Release Version": "0.13.0" },
      });
      g.HermesInternal = {
        getRuntimeProperties: () => {
          throw new Error("unavailable");
        },
      };
      expect(detectEngine()).toEqual({ hermes: true, runtimeProperties: null });
      g.HermesInternal = {};
      expect(detectEngine()).toEqual({ hermes: true, runtimeProperties: null });
    } finally {
      delete g.HermesInternal;
    }
  });

  it("derives NaN totals when a benchmark is missing rather than inventing a number", () => {
    const estimates = deriveEstimates([
      {
        name: "verifyRoster(4 members)",
        iterations: 1,
        totalMs: 50,
        msPerOp: 50,
      },
    ]);
    expect(Number.isNaN(estimates[0].sender.totalMs)).toBe(true);
    expect(Number.isNaN(estimates[1].sender.totalMs)).toBe(true);
  });

  it("is reachable by deep link: the OS-intent redirect leaves /together-probe untouched", () => {
    for (const path of [
      "persistencemobile://together-probe",
      "persistencemobile-staging://together-probe",
      "/together-probe",
      "together-probe",
    ]) {
      expect(redirectSystemPathForDeepLink(path)).toBe(path);
    }
  });
});
