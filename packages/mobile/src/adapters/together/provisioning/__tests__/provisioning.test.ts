/** @jest-environment node */
import { DatabaseSync } from "node:sqlite";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { commandFromEnvelope, readOwnerCommand } from "../../localCommand";
import { TogetherProvisioning } from "../togetherProvisioning";
import { ProvisioningCache } from "../cache";
import { device, randomUuid } from "../device";
import { validateTrust, validateFriend } from "../validation";
import {
  publicKeyPem,
  signPayload,
  requestHash,
} from "../../security/identity";
import { ok, fail } from "../../../../shared/errors/result";
import type { TogetherJournalDatabase } from "../../../storage/togetherJournal";
import type {
  TogetherOfflineApi,
  TogetherRecoveryCommand,
} from "../../../../domain/ports/togetherOfflineApi.port";
import type {
  Registration,
  FriendshipEvidence,
  Signed,
} from "../../../../domain/models/togetherIdentity";
const A = "00000000-0000-4000-8000-000000000001",
  B = "00000000-0000-4000-8000-000000000002",
  C = "00000000-0000-4000-8000-000000000003";
const environment = "https://api.test/staging",
  server = new Uint8Array(32).fill(9),
  server2 = new Uint8Array(32).fill(8);
const scope = (account = A, env = environment) =>
  requestHash({ account, environment: env });
function adapter(db: DatabaseSync): TogetherJournalDatabase {
  return {
    execSync: (sql) => db.exec(sql),
    runSync: (sql, p) => db.prepare(sql).run(...p),
    getFirstSync: <T>(sql: string, p: (string | number | null)[]) =>
      (db.prepare(sql).get(...p) as T) ?? null,
    getAllSync: <T>(sql: string, p: (string | number | null)[]) =>
      db.prepare(sql).all(...p) as T[],
    withTransactionSync: (fn) => {
      db.exec("BEGIN IMMEDIATE");
      try {
        fn();
        db.exec("COMMIT");
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
    },
  };
}
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}
let directory: string,
  db: DatabaseSync,
  database: TogetherJournalDatabase,
  now: number,
  store: Map<string, string>,
  secrets: { getItemAsync: jest.Mock; setItemAsync: jest.Mock },
  api: jest.Mocked<TogetherOfflineApi>,
  service: TogetherProvisioning;
const friend = (
  who = B,
  seed = server,
  keyId = "v1",
  expiry = now + 600000,
): Signed<FriendshipEvidence> =>
  signPayload(
    {
      kind: "together-friendship-v1",
      keyId,
      users: [A, who],
      issuedAt: now,
      expiresAt: expiry,
    },
    seed,
  );
function make(account: string | null = A, env = environment, enabled = true) {
  const s = new TogetherProvisioning({
    api,
    db: database,
    secrets,
    environment: env,
    enabled,
    now: () => now,
    randomBytes: (n) => new Uint8Array(randomBytes(n)),
  });
  s.setAccount(account);
  return s;
}
async function prepared() {
  const result = await service.prepare({ online: true });
  expect(result.ok).toBe(true);
  if (!result.ok) throw Error("not prepared");
  return result.value;
}
function denial(status: number, togetherCode?: string) {
  return fail({
    kind: "api" as const,
    code: "unknown" as const,
    message: "refused",
    status,
    togetherCode,
  });
}
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "together-provision-"));
  db = new DatabaseSync(join(directory, "cache.db"));
  database = adapter(db);
  now = 1000000;
  store = new Map();
  secrets = {
    getItemAsync: jest.fn(async (key) => store.get(key) ?? null),
    setItemAsync: jest.fn(async (key, value) => {
      store.set(key, value);
    }),
  };
  api = {
    trust: jest.fn(async () =>
      ok({
        publicKeys: { v1: publicKeyPem(server) },
        maxCredentialAgeMs: 86400000,
      }),
    ),
    register: jest.fn(async (p: Signed<Registration>) =>
      ok(
        signPayload(
          {
            kind: "together-device-v1" as const,
            keyId: "v1",
            userId: p.payload.userId,
            deviceId: p.payload.deviceId,
            publicKey: p.payload.publicKey,
            issuedAt: now,
            expiresAt: now + 600000,
          },
          server,
        ),
      ),
    ),
    friendship: jest.fn(async (who: string, _requestId: string) =>
      ok(friend(who)),
    ),
  };
  service = make();
});
afterEach(() => {
  db.close();
  rmSync(directory, { recursive: true, force: true });
});
it("persists signed evidence across real SQLite reopen without storing secrets", async () => {
  const initial = await prepared();
  expect(initial.credential.payload.publicKey).toBe(publicKeyPem(initial.seed));
  expect(await service.friendship(B, { online: true })).toEqual(ok(friend()));
  const rows = db.prepare("SELECT snapshot FROM together_provisioning").all();
  expect(JSON.stringify(rows)).not.toContain(
    Buffer.from(initial.seed).toString("base64"),
  );
  db.close();
  db = new DatabaseSync(join(directory, "cache.db"));
  database = adapter(db);
  service = make();
  const recovered = await service.prepare({ online: false });
  expect(recovered).toEqual(ok(initial));
  expect(await service.friendship(B, { online: false })).toEqual(ok(friend()));
  expect(api.register).toHaveBeenCalledTimes(1);
});
it("isolates accounts and environments; switching back requires online reauthorization", async () => {
  const first = await prepared();
  service.setAccount(B);
  const second = await prepared();
  expect(second.deviceId).not.toBe(first.deviceId);
  service.setAccount(A);
  expect(await service.prepare({ online: false })).toMatchObject({
    error: { code: "unauthorized" },
  });
  expect((await prepared()).deviceId).toBe(first.deviceId);
  const other = make(A, "https://api.test/production");
  const result = await other.prepare({ online: true });
  expect(result.ok && result.value.deviceId).not.toBe(first.deviceId);
});
it("singleflights registration and returns independent seed copies", async () => {
  const [a, b] = await Promise.all([
    service.prepare({ online: true }),
    service.prepare({ online: true }),
  ]);
  expect(api.register).toHaveBeenCalledTimes(1);
  if (!a.ok || !b.ok) throw Error();
  a.value.seed.fill(0);
  a.value.trustedKeys.v1 = "tampered";
  expect(b.value.seed.some((v) => v !== 0)).toBe(true);
  expect((await prepared()).trustedKeys.v1).toBe(publicKeyPem(server));
});
it("remains disabled without calls or secret creation; signed-out and disposed guards", async () => {
  const disabled = make(A, environment, false);
  expect(await disabled.prepare({ online: true })).toMatchObject({
    error: { code: "disabled" },
  });
  expect(await disabled.friendship(B, { online: true })).toMatchObject({
    error: { code: "disabled" },
  });
  const absent = make(null);
  expect(await absent.prepare({ online: true })).toMatchObject({
    error: { code: "signed-out" },
  });
  expect(api.trust).not.toHaveBeenCalled();
  expect(store.size).toBe(0);
  service.dispose();
  expect(await service.prepare({ online: true })).toMatchObject({
    error: { code: "cancelled" },
  });
});
it("does not create keys offline and refuses missing or corrupted known secrets", async () => {
  expect(await service.prepare({ online: false })).toMatchObject({
    error: { code: "offline-unprepared" },
  });
  await prepared();
  store.clear();
  expect(await service.prepare({ online: true })).toMatchObject({
    error: { code: "key-unavailable" },
  });
  expect(api.register).toHaveBeenCalledTimes(1);
  store.set(`together.provisioning.v1.${scope()}`, "broken");
  expect(await service.prepare({ online: false })).toMatchObject({
    error: { code: "key-unavailable" },
  });
});
it("renewal is bounded; expired credentials and clock rollback stop sharing", async () => {
  await prepared();
  now += 400000;
  await prepared();
  expect(api.register).toHaveBeenCalledTimes(2);
  now += 600001;
  expect(await service.prepare({ online: false })).toMatchObject({
    error: { code: "expired" },
  });
  now = 999999;
  expect(await service.prepare({ online: true })).toMatchObject({
    error: { code: "expired" },
  });
});
it.each([401, 402, 403, 404, 409])(
  "persists authoritative denial %s and preserves recovery credential",
  async (status) => {
    const initial = await prepared();
    now += 400000;
    api.trust.mockResolvedValueOnce(denial(status));
    expect(await service.prepare({ online: true })).toMatchObject({
      error: {
        code:
          status === 401
            ? "authentication-required"
            : status === 404
              ? "service-unavailable"
              : "unauthorized",
      },
    });
    service = make();
    expect(await service.prepare({ online: false })).toMatchObject({
      error: { code: "unauthorized" },
    });
    expect(new ProvisioningCache(database).read(scope()).credential).toEqual(
      initial.credential,
    );
    expect(store.size).toBe(1);
  },
);
it.each(["network", "timeout", "server"] as const)(
  "falls back only to still valid evidence on %s",
  async (code) => {
    const initial = await prepared();
    now += 400000;
    api.trust.mockResolvedValue(
      fail({
        kind: "api",
        code,
        message: "offline",
        ...(code === "server" ? { status: 503 } : {}),
      }),
    );
    expect(await service.prepare({ online: true })).toEqual(ok(initial));
    now += 200001;
    expect(await service.prepare({ online: true })).toMatchObject({
      error: { code: "unavailable" },
    });
  },
);
it("rejects unknown failures and a credential which expires during failed refresh", async () => {
  await prepared();
  now += 400000;
  api.trust.mockResolvedValueOnce(
    fail({ kind: "api", code: "unknown", message: "bad" }),
  );
  expect(await service.prepare({ online: true })).toMatchObject({
    error: { code: "unavailable" },
  });
  api.trust.mockImplementationOnce(async () => {
    now += 300000;
    return fail({ kind: "api", code: "network", message: "offline" });
  });
  expect(await service.prepare({ online: true })).toMatchObject({
    error: { code: "expired" },
  });
});
it("rotates authority atomically and drops obsolete friendship proofs", async () => {
  await prepared();
  await service.friendship(B, { online: true });
  now += 400000;
  api.trust.mockResolvedValue(
    ok({
      publicKeys: { v2: publicKeyPem(server2) },
      maxCredentialAgeMs: 86400000,
    }),
  );
  // Build exact credential shape, with no registration fields.
  api.register.mockImplementation(async ({ payload: p }) =>
    ok(
      signPayload(
        {
          kind: "together-device-v1",
          keyId: "v2",
          userId: p.userId,
          deviceId: p.deviceId,
          publicKey: p.publicKey,
          issuedAt: now,
          expiresAt: now + 600000,
        },
        server2,
      ),
    ),
  );
  const result = await prepared();
  expect(Object.keys(result.trustedKeys)).toEqual(["v2"]);
  expect(await service.friendship(B, { online: false })).toEqual(ok(null));
});
it.each(["wrong-account", "wrong-device", "wrong-key", "tampered", "long-ttl"])(
  "rejects %s issuance",
  async (mode) => {
    api.register.mockImplementation(async ({ payload: p }) => {
      const value = signPayload(
        {
          kind: "together-device-v1" as const,
          keyId: "v1",
          userId: mode === "wrong-account" ? B : p.userId,
          deviceId: mode === "wrong-device" ? B : p.deviceId,
          publicKey: mode === "wrong-key" ? publicKeyPem(server) : p.publicKey,
          issuedAt: now,
          expiresAt: now + (mode === "long-ttl" ? 86400001 : 600000),
        },
        server,
      );
      if (mode === "tampered") value.payload.expiresAt++;
      return ok(value);
    });
    expect((await service.prepare({ online: true })).ok).toBe(false);
    expect(new ProvisioningCache(database).read(scope()).credential).toBeNull();
  },
);
it("keeps a failed SQLite write atomic", async () => {
  await prepared();
  const before = new ProvisioningCache(database).read(scope());
  now += 400000;
  db.exec(
    "CREATE TRIGGER fail_write BEFORE UPDATE ON together_provisioning BEGIN SELECT RAISE(ABORT, 'disk full'); END",
  );
  expect(await service.prepare({ online: true })).toMatchObject({
    error: { code: "storage" },
  });
  expect(new ProvisioningCache(database).read(scope())).toEqual(before);
});
it("cancels logout during trust and registration without repopulating cache", async () => {
  for (const phase of ["trust", "register"] as const) {
    const gate = deferred<any>();
    api[phase].mockImplementationOnce(() => gate.promise);
    const pending = service.prepare({ online: true });
    while (!api[phase].mock.calls.length)
      await new Promise((r) => setImmediate(r));
    service.setAccount(null);
    gate.resolve(
      phase === "trust"
        ? ok({
            publicKeys: { v1: publicKeyPem(server) },
            maxCredentialAgeMs: 86400000,
          })
        : ok(null),
    );
    expect(await pending).toMatchObject({ error: { code: "cancelled" } });
    expect(new ProvisioningCache(database).read(scope()).blocked).toBe(true);
    service = make();
    api.trust.mockClear();
    api.register.mockClear();
  }
});
it("friend refusal removes only known FORBIDDEN pair; paid or unknown denial blocks all sharing", async () => {
  await prepared();
  await service.friendship(B, { online: true });
  api.friendship.mockResolvedValueOnce(denial(403, "FORBIDDEN"));
  expect(await service.friendship(B, { online: true })).toMatchObject({
    error: { code: "unauthorized" },
  });
  expect(await service.friendship(B, { online: false })).toMatchObject({
    error: { code: "unauthorized" },
  });
  expect((await service.prepare({ online: false })).ok).toBe(true);
  api.friendship.mockResolvedValueOnce(denial(403, "PAID_REQUIRED"));
  expect(await service.friendship(C, { online: true })).toMatchObject({
    error: { code: "paid-required" },
  });
  expect(await service.prepare({ online: false })).toMatchObject({
    error: { code: "unauthorized" },
  });
});
it("friendship validates pair, signature, expiry and handles offline/network fallback", async () => {
  await prepared();
  expect(await service.friendship(A, { online: true })).toMatchObject({
    error: { code: "invalid-proof" },
  });
  expect(await service.friendship("invalid", { online: true })).toMatchObject({
    error: { code: "invalid-proof" },
  });
  await service.friendship(B, { online: true });
  api.friendship.mockResolvedValueOnce(
    fail({ kind: "api", code: "network", message: "offline" }),
  );
  expect(await service.friendship(B, { online: true })).toEqual(ok(friend()));
  api.friendship.mockResolvedValueOnce(ok(friend(C)));
  expect(await service.friendship(B, { online: true })).toMatchObject({
    error: { code: "invalid-proof" },
  });
  now += 600000;
  expect((await service.friendship(B, { online: false })).ok).toBe(false);
});
it("does not publish friend response after logout", async () => {
  await prepared();
  const gate = deferred<any>();
  api.friendship.mockImplementationOnce(() => gate.promise);
  const pending = service.friendship(B, { online: true });
  while (!api.friendship.mock.calls.length)
    await new Promise((r) => setImmediate(r));
  service.setAccount(null);
  gate.resolve(ok(friend()));
  expect(await pending).toMatchObject({ error: { code: "cancelled" } });
  expect(new ProvisioningCache(database).read(scope()).friends).toEqual({});
});
it("validates trust structure and canonical keys", () => {
  for (const keys of [
    null,
    [],
    {},
    Object.fromEntries(
      Array.from({ length: 33 }, (_, i) => [String(i), publicKeyPem(server)]),
    ),
    { "bad!": publicKeyPem(server) },
    { v1: "invalid" },
    { v1: publicKeyPem(server).replace("MCow", "AAAA") },
  ])
    expect(() => validateTrust(keys as any, 86400000)).toThrow();
  for (const ttl of [0, -1, 86400001, 1.5, NaN])
    expect(() => validateTrust({ v1: publicKeyPem(server) }, ttl)).toThrow();
  expect(() =>
    validateTrust({ v1: publicKeyPem(server) }, 86400000),
  ).not.toThrow();
  for (const proof of [
    friend(A),
    { ...friend(), signature: "x" },
    friend(B, server, "missing"),
    friend(B, server, "v1", now),
    signPayload({ ...friend().payload, issuedAt: now + 1 }, server),
    signPayload({ ...friend().payload, expiresAt: now + 86400001 }, server),
  ])
    expect(() =>
      validateFriend(proof, { v1: publicKeyPem(server) }, A, B, now),
    ).toThrow();
});
it("validates scoped secret records and shares concurrent creation", async () => {
  const random = (n: number) => new Uint8Array(randomBytes(n));
  const [a, b] = await Promise.all([
    device(secrets, "s", A, environment, null, true, random),
    device(secrets, "s", A, environment, null, true, random),
  ]);
  expect(a).toEqual(b);
  expect(a.seed).not.toBe(b.seed);
  expect(secrets.setItemAsync).toHaveBeenCalledTimes(1);
  for (const record of [
    "x".repeat(1025),
    "{}",
    JSON.stringify({
      account: B,
      environment,
      deviceId: a.deviceId,
      seed: "AAAA",
    }),
    JSON.stringify({
      account: A,
      environment,
      deviceId: a.deviceId,
      seed: "AAAA",
    }),
  ]) {
    store.set("together.provisioning.v1.s", record);
    await expect(
      device(secrets, "s", A, environment, a.deviceId, false, random),
    ).rejects.toThrow();
  }
  store.clear();
  await expect(
    device(secrets, "s", A, environment, null, false, random),
  ).rejects.toThrow();
  await expect(
    device(secrets, "s", A, environment, null, true, () => new Uint8Array(1)),
  ).rejects.toThrow();
  expect(() => randomUuid(() => new Uint8Array(1))).toThrow();
});
it("rejects malformed cache and environment; storage failure on logout fails closed", async () => {
  expect(() => make(A, "https://user:pass@api.test")).toThrow();
  expect(() => make(A, "https://api.test/?token=x")).toThrow();
  expect(() => make(A, "https://api.test/#x")).toThrow();
  expect(() => make(A, "ftp://api.test")).toThrow();
  expect(() => service.setAccount("invalid")).toThrow();
  await prepared();
  db.prepare("UPDATE together_provisioning SET snapshot = ?").run("{}");
  expect(await service.prepare({ online: false })).toMatchObject({
    error: { code: "storage" },
  });
  service.setAccount(null);
  service.setAccount(A);
  expect(await service.prepare({ online: true })).toMatchObject({
    error: { code: "storage" },
  });
});
it("keeps newest friendship evidence within the 100-pair bound", async () => {
  await prepared();
  const cache = new ProvisioningCache(database),
    snapshot = cache.read(scope());
  for (let i = 10; i < 110; i++) {
    const id = `00000000-0000-4000-8000-${i.toString().padStart(12, "0")}`;
    snapshot.friends[id] = friend(id);
  }
  cache.write(scope(), snapshot);
  now++;
  expect((await service.friendship(B, { online: true })).ok).toBe(true);
  const saved = cache.read(scope());
  expect(Object.keys(saved.friends)).toHaveLength(100);
  expect(saved.friends[B]).toBeDefined();
  expect(saved.friends["00000000-0000-4000-8000-000000000010"]).toBeUndefined();
});
it("does not resurrect a refused pair from an older in-flight response", async () => {
  await prepared();
  const gate = deferred<any>();
  api.friendship.mockImplementationOnce(() => gate.promise);
  const old = service.friendship(B, { online: true });
  while (!api.friendship.mock.calls.length)
    await new Promise((r) => setImmediate(r));
  api.friendship.mockResolvedValueOnce(denial(403, "FORBIDDEN"));
  expect(await service.friendship(B, { online: true })).toMatchObject({
    error: { code: "unauthorized" },
  });
  gate.resolve(ok(friend()));
  expect(await old).toMatchObject({ error: { code: "unauthorized" } });
  expect(await service.friendship(B, { online: false })).toMatchObject({
    error: { code: "unauthorized" },
  });
});
it("does not fall back to a revoked issuer after successful trust rotation", async () => {
  await prepared();
  now += 400000;
  api.trust.mockResolvedValue(
    ok({
      publicKeys: { v2: publicKeyPem(server2) },
      maxCredentialAgeMs: 86400000,
    }),
  );
  api.register.mockResolvedValueOnce(
    fail({ kind: "api", code: "network", message: "offline" }),
  );
  expect(await service.prepare({ online: true })).toMatchObject({
    error: { code: "unavailable" },
  });
  service = make();
  expect(await service.prepare({ online: false })).toMatchObject({
    error: { code: "unauthorized" },
  });
});
it("falls back on registration outage only while current issuer remains trusted", async () => {
  const first = await prepared();
  now += 400000;
  api.register.mockResolvedValueOnce(
    fail({ kind: "api", code: "timeout", message: "timeout" }),
  );
  expect(await service.prepare({ online: true })).toEqual(ok(first));
  api.register.mockResolvedValueOnce(denial(403));
  expect(await service.prepare({ online: true })).toMatchObject({
    error: { code: "unauthorized" },
  });
});
it("caps returned credential TTL to the authenticated trust policy", async () => {
  api.trust.mockResolvedValueOnce(
    ok({
      publicKeys: { v1: publicKeyPem(server) },
      maxCredentialAgeMs: 300000,
    }),
  );
  expect(await service.prepare({ online: true })).toMatchObject({
    error: { code: "invalid-proof" },
  });
});
it("rejects stale, invalid and unavailable friendship evidence without treating it as permission", async () => {
  await prepared();
  await service.friendship(B, { online: true });
  const cache = new ProvisioningCache(database);
  let snapshot = cache.read(scope());
  snapshot.friends[B].signature = "x";
  cache.write(scope(), snapshot);
  expect(await service.friendship(B, { online: false })).toEqual(ok(null));
  api.friendship.mockResolvedValueOnce(
    fail({ kind: "api", code: "unknown", message: "unknown" }),
  );
  expect(await service.friendship(B, { online: true })).toMatchObject({
    error: { code: "unavailable" },
  });
  api.friendship.mockImplementationOnce(async () => {
    now += 600001;
    return ok(friend());
  });
  expect(await service.friendship(B, { online: true })).toMatchObject({
    error: { code: "expired" },
  });
});
it("uses defaults and fails on unexpected crypto/storage errors", async () => {
  const defaults = new TogetherProvisioning({
    api,
    db: database,
    secrets,
    environment,
    randomBytes: (n) => new Uint8Array(n),
  });
  defaults.setAccount(A);
  expect(await defaults.prepare({ online: true })).toMatchObject({
    error: { code: "disabled" },
  });
  api.trust.mockRejectedValueOnce(null);
  expect(await service.prepare({ online: true })).toMatchObject({
    error: { code: "storage" },
  });
});
it.each(["secret", "trust"] as const)(
  "preserves a paid refusal during awaited %s preparation",
  async (phase) => {
    await prepared();
    const refusal = deferred<any>();
    api.friendship.mockImplementationOnce(() => refusal.promise);
    const friendRequest = service.friendship(B, { online: true });
    while (!api.friendship.mock.calls.length)
      await new Promise((r) => setImmediate(r));
    const gate = deferred<any>();
    if (phase === "secret")
      secrets.getItemAsync.mockImplementationOnce(() => gate.promise);
    else {
      now += 400000;
      api.trust.mockImplementationOnce(() => gate.promise);
    }
    const refresh = service.prepare({ online: true });
    if (phase === "trust")
      while (api.trust.mock.calls.length < 2)
        await new Promise((r) => setImmediate(r));
    refusal.resolve(denial(403, "PAID_REQUIRED"));
    await friendRequest;
    gate.resolve(
      phase === "secret"
        ? store.get(`together.provisioning.v1.${scope()}`)
        : fail({ kind: "api", code: "network", message: "offline" }),
    );
    expect(await refresh).toMatchObject({ error: { code: "unauthorized" } });
    expect(new ProvisioningCache(database).read(scope()).blocked).toBe(true);
    expect(await service.prepare({ online: false })).toMatchObject({
      error: { code: "unauthorized" },
    });
  },
);
it("preserves a pair refusal received during registration renewal", async () => {
  await prepared();
  await service.friendship(B, { online: true });
  const refusal = deferred<any>();
  api.friendship.mockImplementationOnce(() => refusal.promise);
  const friendRequest = service.friendship(B, { online: true });
  while (api.friendship.mock.calls.length < 2)
    await new Promise((r) => setImmediate(r));
  now += 400000;
  const gate = deferred<void>();
  const register = api.register.getMockImplementation()!;
  api.register.mockImplementationOnce(async (proof) => {
    await gate.promise;
    return register(proof);
  });
  const refresh = service.prepare({ online: true });
  while (api.register.mock.calls.length < 2)
    await new Promise((r) => setImmediate(r));
  refusal.resolve(denial(403, "FORBIDDEN"));
  await friendRequest;
  gate.resolve();
  expect((await refresh).ok).toBe(true);
  expect(await service.friendship(B, { online: false })).toMatchObject({
    error: { code: "unauthorized" },
  });
});
it.each([403, 401, 404])(
  "persists global refusal %s even after a newer pair refusal",
  async (status) => {
    await prepared();
    const first = deferred<any>(),
      second = deferred<any>();
    api.friendship
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);
    const requests = [
      service.friendship(B, { online: true }),
      service.friendship(B, { online: true }),
    ];
    while (api.friendship.mock.calls.length < 2)
      await new Promise((r) => setImmediate(r));
    first.resolve(denial(403, "FORBIDDEN"));
    await requests[0];
    second.resolve(denial(status, "PAID_REQUIRED"));
    await requests[1];
    expect(await service.prepare({ online: false })).toMatchObject({
      error: { code: "unauthorized" },
    });
  },
);
it("applies authenticated issuer removal to friend evidence during registration outage", async () => {
  api.trust.mockResolvedValueOnce(
    ok({
      publicKeys: { v1: publicKeyPem(server), v2: publicKeyPem(server2) },
      maxCredentialAgeMs: 86400000,
    }),
  );
  await prepared();
  api.friendship.mockResolvedValueOnce(ok(friend(B, server2, "v2")));
  await service.friendship(B, { online: true });
  now += 400000;
  api.register.mockResolvedValueOnce(
    fail({ kind: "api", code: "timeout", message: "offline" }),
  );
  const refresh = await service.prepare({ online: true });
  expect(refresh.ok).toBe(true);
  if (refresh.ok)
    expect(Object.keys(refresh.value.trustedKeys)).toEqual(["v1"]);
  expect(await service.friendship(B, { online: false })).toEqual(ok(null));
  service = make();
  expect(await service.friendship(B, { online: false })).toEqual(ok(null));
});
it("upgrades an offline preparation when connectivity returns during secure storage read", async () => {
  await prepared();
  now += 600001;
  const gate = deferred<string>();
  secrets.getItemAsync.mockImplementationOnce(() => gate.promise);
  const offline = service.prepare({ online: false }),
    online = service.prepare({ online: true });
  gate.resolve(store.get(`together.provisioning.v1.${scope()}`)!);
  expect(await offline).toMatchObject({ error: { code: "expired" } });
  expect((await online).ok).toBe(true);
  expect(api.register).toHaveBeenCalledTimes(2);
});
it("rechecks global authorization at the public prepare promise boundary", async () => {
  await prepared();
  const refusal = deferred<any>();
  api.friendship.mockImplementationOnce(() => refusal.promise);
  const deniedFriend = service.friendship(B, { online: true });
  while (!api.friendship.mock.calls.length)
    await new Promise((r) => setImmediate(r));
  const run = database.runSync;
  let triggered = false;
  database.runSync = (sql, params) => {
    const result = run(sql, params);
    if (!triggered && sql.startsWith("INSERT INTO together_provisioning")) {
      triggered = true;
      refusal.resolve(denial(403, "PAID_REQUIRED"));
    }
    return result;
  };
  expect(await service.prepare({ online: false })).toMatchObject({
    error: { code: "unauthorized" },
  });
  await deniedFriend;
});
it("rechecks global authorization after friendship awaits prepared capability", async () => {
  await prepared();
  await service.friendship(B, { online: true });
  const refusal = deferred<any>();
  api.friendship.mockImplementationOnce(() => refusal.promise);
  const deniedFriend = service.friendship(C, { online: true });
  while (api.friendship.mock.calls.length < 2)
    await new Promise((r) => setImmediate(r));
  const prepare = service.prepare.bind(service);
  service.prepare = async (options) => {
    const ready = await prepare(options);
    refusal.resolve(denial(401));
    await deniedFriend;
    return ready;
  };
  expect(await service.friendship(B, { online: false })).toMatchObject({
    error: { code: "unauthorized" },
  });
});

it.each(
  [408, 425, 429].flatMap((status) =>
    (["trust", "register", "friendship"] as const).map((endpoint) => ({
      status,
      endpoint,
    })),
  ),
)(
  "preserves valid offline evidence after $endpoint returns $status",
  async ({ status, endpoint }) => {
    const initial = await prepared();
    const proof = friend();
    expect(await service.friendship(B, { online: true })).toEqual(ok(proof));
    now += 400000;
    api[endpoint].mockResolvedValueOnce(denial(status, "RATE_LIMITED"));
    if (endpoint === "friendship") {
      expect(await service.friendship(B, { online: true })).toEqual(ok(proof));
    } else {
      expect(await service.prepare({ online: true })).toEqual(ok(initial));
    }
    db.close();
    db = new DatabaseSync(join(directory, "cache.db"));
    database = adapter(db);
    service = make();
    expect((await service.prepare({ online: false })).ok).toBe(true);
    expect(await service.friendship(B, { online: false })).toEqual(ok(proof));
    expect(new ProvisioningCache(database).read(scope()).blocked).toBe(false);
  },
);
it("rate limiting never grants absent or expired offline evidence", async () => {
  api.trust.mockResolvedValueOnce(denial(429, "RATE_LIMITED"));
  expect(await service.prepare({ online: true })).toMatchObject({
    error: { code: "unavailable" },
  });
  expect(await service.prepare({ online: false })).toMatchObject({
    error: { code: "offline-unprepared" },
  });
  await prepared();
  api.friendship.mockResolvedValueOnce(denial(429, "RATE_LIMITED"));
  // Valid identity can request host approval, but rate limiting never invents a friendship proof.
  expect(await service.friendship(B, { online: true })).toEqual(ok(null));
  expect(await service.friendship(B, { online: false })).toEqual(ok(null));
  now += 600001;
  api.trust.mockResolvedValueOnce(denial(429, "RATE_LIMITED"));
  expect(await service.prepare({ online: true })).toMatchObject({
    error: { code: "unavailable" },
  });
  expect(await service.prepare({ online: false })).toMatchObject({
    error: { code: "expired" },
  });
});
it.each([
  { callers: 2, status: 200 },
  { callers: 8, status: 200 },
  { callers: 2, status: 429 },
  { callers: 2, status: 401 },
])(
  "upgrades a shared offline flight once for $callers online callers (status $status)",
  async ({ callers, status }) => {
    await prepared();
    now += 600001;
    const gate = deferred<string>();
    secrets.getItemAsync.mockImplementationOnce(() => gate.promise);
    if (status !== 200) api.trust.mockResolvedValueOnce(denial(status));
    const offline = service.prepare({ online: false });
    const online = Array.from({ length: callers }, () =>
      service.prepare({ online: true }),
    );
    let completed = false;
    const results = Promise.all([offline, ...online]).then((value) => {
      completed = true;
      return value;
    });
    gate.resolve(store.get(`together.provisioning.v1.${scope()}`)!);
    // A timer cannot interrupt an infinite microtask chain. Bound the reproduction
    // with another microtask participant so the old implementation fails, not hangs.
    const watchdog = async () => {
      for (let turn = 0; turn < 200 && !completed; turn++)
        await Promise.resolve();
      if (!completed) {
        service.dispose();
        throw new Error(
          "Preparation did not settle within the bounded microtask budget",
        );
      }
    };
    const [settled] = await Promise.all([results, watchdog()]);
    expect(settled[0]).toMatchObject({ error: { code: "expired" } });
    expect(api.trust).toHaveBeenCalledTimes(2);
    expect(api.register).toHaveBeenCalledTimes(status === 200 ? 2 : 1);
    for (const result of settled.slice(1)) {
      if (status === 200) expect(result.ok).toBe(true);
      else
        expect(result).toMatchObject({
          error: {
            code: status === 401 ? "authentication-required" : "unavailable",
          },
        });
    }
    if (status === 200) {
      const first = settled[1],
        second = settled[2];
      if (!first.ok || !second.ok)
        throw new Error("Expected prepared identities");
      expect(first.value.seed).toEqual(second.value.seed);
      first.value.seed.fill(0);
      expect(second.value.seed.some((byte) => byte !== 0)).toBe(true);
    }
  },
);

it("ordinary nonfriends erase stale proof without revoking paid preparation; only authoritative unblock clears pair denial", async () => {
  await prepared();
  await service.friendship(B, { online: true });
  api.friendship.mockResolvedValueOnce(denial(403, "FRIENDSHIP_NOT_ACCEPTED"));
  expect(await service.friendship(B, { online: true })).toEqual(ok(null));
  expect(
    new ProvisioningCache(database).read(scope()).friends[B],
  ).toBeUndefined();
  expect(await service.friendship(B, { online: false })).toEqual(ok(null));
  api.friendship.mockResolvedValueOnce(denial(403, "FORBIDDEN"));
  await service.friendship(B, { online: true });
  service = make();
  expect(await service.friendship(B, { online: false })).toMatchObject({
    error: { code: "unauthorized" },
  });
  expect(await service.friendship(C, { online: false })).toEqual(ok(null));
  api.friendship.mockResolvedValueOnce(
    fail({ kind: "api", code: "network", message: "offline" }),
  );
  expect(await service.friendship(B, { online: true })).toMatchObject({
    error: { code: "unauthorized" },
  });
  api.friendship.mockResolvedValueOnce(denial(403, "FRIENDSHIP_NOT_ACCEPTED"));
  expect(await service.friendship(B, { online: true })).toEqual(ok(null));
  expect(await service.friendship(B, { online: false })).toEqual(ok(null));
  api.friendship.mockResolvedValueOnce(denial(403, "FORBIDDEN"));
  await service.friendship(B, { online: true });
  expect(await service.friendship(B, { online: true })).toEqual(ok(friend()));
  expect(await service.friendship(B, { online: false })).toEqual(ok(friend()));
});
it.each(["FRIENDSHIP_NOT_ACCEPTED", "FORBIDDEN"])(
  "older success never overrides newer %s",
  async (code) => {
    await prepared();
    const gate = deferred<any>();
    api.friendship.mockImplementationOnce(() => gate.promise);
    const old = service.friendship(B, { online: true });
    while (!api.friendship.mock.calls.length)
      await new Promise((r) => setImmediate(r));
    api.friendship.mockResolvedValueOnce(denial(403, code));
    await service.friendship(B, { online: true });
    gate.resolve(ok(friend()));
    expect(await old).toMatchObject({ error: { code: "unauthorized" } });
    expect(
      new ProvisioningCache(database).read(scope()).friends[B],
    ).toBeUndefined();
  },
);
it("a stale nonfriend response cannot clear a newer pair block or global revocation", async () => {
  await prepared();
  const gate = deferred<any>();
  api.friendship.mockImplementationOnce(() => gate.promise);
  const old = service.friendship(B, { online: true });
  while (!api.friendship.mock.calls.length)
    await new Promise((r) => setImmediate(r));
  api.friendship.mockResolvedValueOnce(denial(403, "FORBIDDEN"));
  await service.friendship(B, { online: true });
  gate.resolve(denial(403, "FRIENDSHIP_NOT_ACCEPTED"));
  expect(await old).toMatchObject({ error: { code: "unauthorized" } });
  expect(await service.friendship(B, { online: false })).toMatchObject({
    error: { code: "unauthorized" },
  });
});
it("bounds persisted pair decisions without evicting a denial into offline permission", async () => {
  await prepared();
  const cache = new ProvisioningCache(database),
    snapshot = cache.read(scope());
  for (let n = 10; n < 110; n++)
    snapshot.friendAccess[
      `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`
    ] = false;
  cache.write(scope(), snapshot);
  api.friendship.mockResolvedValueOnce(denial(403, "FORBIDDEN"));
  await service.friendship(B, { online: true });
  const saved = cache.read(scope());
  expect(Object.keys(saved.friendAccess)).toHaveLength(100);
  expect(saved.unknownFriendsDenied).toBe(true);
  expect(
    await service.friendship("00000000-0000-4000-8000-00000000000a", {
      online: false,
    }),
  ).toMatchObject({ error: { code: "unauthorized" } });
  api.friendship.mockResolvedValueOnce(denial(403, "FRIENDSHIP_NOT_ACCEPTED"));
  expect(await service.friendship(C, { online: true })).toEqual(ok(null));
  expect(await service.friendship(C, { online: false })).toEqual(ok(null));
  snapshot.friendAccess = Object.fromEntries(
    Object.keys(snapshot.friendAccess).map((key) => [key, true]),
  );
  snapshot.unknownFriendsDenied = false;
  cache.write(scope(), snapshot);
  await service.friendship(B, { online: true });
  expect(cache.read(scope()).unknownFriendsDenied).toBe(false);
});
it("migrates old snapshots and rejects malformed persisted pair decisions", async () => {
  await prepared();
  const cache = new ProvisioningCache(database),
    snapshot = cache.read(scope());
  const old = { ...snapshot } as Partial<typeof snapshot>;
  delete old.friendAccess;
  delete old.unknownFriendsDenied;
  db.prepare("UPDATE together_provisioning SET snapshot=? WHERE scope=?").run(
    JSON.stringify(old),
    scope(),
  );
  expect(cache.read(scope()).friendAccess).toEqual({});
  for (const patch of [
    { friendAccess: [] },
    { friendAccess: { bad: false } },
    { friendAccess: { [B]: "yes" } },
    { friendAccess: null },
    { unknownFriendsDenied: 1 },
    {
      friendAccess: Object.fromEntries(
        Array.from({ length: 101 }, (_, n) => [String(n), false]),
      ),
    },
  ]) {
    db.prepare("UPDATE together_provisioning SET snapshot=? WHERE scope=?").run(
      JSON.stringify({ ...snapshot, ...patch }),
      scope(),
    );
    expect(() => cache.read(scope())).toThrow("storage");
  }
});

it("exposes current account-scoped refusals for host and member validation", async () => {
  expect(() => make(null).deniedPairs()).toThrow("signed-out");
  await prepared();
  expect(service.deniedPairs()).toEqual([]);
  api.friendship.mockResolvedValueOnce(denial(403, "FORBIDDEN"));
  await service.friendship(B, { online: true });
  expect(service.deniedPairs([A, B, C])).toEqual([[A, B]]);
  const cache = new ProvisioningCache(database),
    snapshot = cache.read(scope());
  snapshot.unknownFriendsDenied = true;
  cache.write(scope(), snapshot);
  expect(service.deniedPairs([A, B, C])).toEqual([
    [A, B],
    [A, C],
  ]);
  snapshot.blocked = true;
  cache.write(scope(), snapshot);
  expect(() => service.deniedPairs([B])).toThrow("unauthorized");
});

describe("original device journal recovery signing", () => {
  const command = (): TogetherRecoveryCommand => ({
    kind: "together-recovery-v1",
    userId: A,
    sessionId: B,
    executionId: C,
    commandId: "00000000-0000-4000-8000-000000000004",
    planHash: "a".repeat(64),
    startedAt: 1,
    expectedVersion: 0,
    operation: { type: "rest", endsAt: null },
  });
  it("signs after expiry, logout/restart and sharing denial without trust/register/prepare", async () => {
    const original = await prepared();
    service.setAccount(null);
    now += 86400000;
    service = make(A, environment, false);
    api.trust.mockClear();
    api.register.mockClear();
    api.friendship.mockClear();
    const signed = await service.signRecovery(original.credential, [command()]);
    expect(signed.ok).toBe(true);
    if (!signed.ok) throw new Error("not signed");
    expect(
      readOwnerCommand(
        commandFromEnvelope(signed.value[0]),
        original.credential,
      ),
    ).toEqual(command());
    expect(api.trust).not.toHaveBeenCalled();
    expect(api.register).not.toHaveBeenCalled();
    expect(api.friendship).not.toHaveBeenCalled();
    expect(secrets.setItemAsync).toHaveBeenCalledTimes(1);
  });
  it("cannot recover another account or environment and never creates a replacement secret", async () => {
    const original = await prepared();
    service.setAccount(B);
    expect(
      await service.signRecovery(original.credential, [command()]),
    ).toMatchObject({ ok: false, error: { code: "invalid-proof" } });
    const other = make(A, "https://api.test/production");
    expect(
      await other.signRecovery(original.credential, [command()]),
    ).toMatchObject({ ok: false, error: { code: "key-unavailable" } });
    expect(secrets.setItemAsync).toHaveBeenCalledTimes(1);
    store.clear();
    service = make();
    expect(
      await service.signRecovery(original.credential, [command()]),
    ).toMatchObject({ ok: false, error: { code: "key-unavailable" } });
    expect(secrets.setItemAsync).toHaveBeenCalledTimes(1);
  });
  it("rejects signed-out, stopped, oversized, empty and mismatched original credentials", async () => {
    const original = await prepared();
    expect(await service.signRecovery(original.credential, [])).toMatchObject({
      ok: false,
    });
    expect(
      await service.signRecovery(
        original.credential,
        Array(101).fill(command()),
      ),
    ).toMatchObject({ ok: false });
    const wrong = {
      ...original.credential,
      payload: {
        ...original.credential.payload,
        publicKey: publicKeyPem(server),
      },
    };
    expect(await service.signRecovery(wrong, [command()])).toMatchObject({
      ok: false,
      error: { code: "invalid-proof" },
    });
    service.setAccount(null);
    expect(
      await service.signRecovery(original.credential, [command()]),
    ).toMatchObject({ ok: false, error: { code: "signed-out" } });
    service.dispose();
    expect(
      await service.signRecovery(original.credential, [command()]),
    ).toMatchObject({ ok: false, error: { code: "cancelled" } });
  });
  it("rejects non-owner operations and clears loaded key on account switch in flight", async () => {
    const original = await prepared();
    expect(
      (
        await service.signRecovery(original.credential, [
          { ...command(), userId: B },
        ])
      ).ok,
    ).toBe(false);
    const pending = deferred<string | null>();
    secrets.getItemAsync.mockReturnValueOnce(pending.promise);
    const signing = service.signRecovery(original.credential, [command()]);
    service.setAccount(B);
    pending.resolve(store.get(`together.provisioning.v1.${scope()}`)!);
    expect(await signing).toMatchObject({
      ok: false,
      error: { code: "cancelled" },
    });
  });
});

it.each([
  [401, "UNAUTHENTICATED", "authentication-required"],
  [403, "PAID_REQUIRED", "paid-required"],
  [404, "NOT_FOUND", "service-unavailable"],
  [403, "DEVICE_REVOKED", "device-revoked"],
  [409, "IDEMPOTENCY_MISMATCH", "registration-conflict"],
  [403, "INVALID_PROOF", "registration-invalid"],
  [400, "INVALID_SCHEMA", "unauthorized"],
  [403, "FORBIDDEN", "unauthorized"],
] as const)(
  "retains registration denial %s/%s as %s without allowing cached sharing",
  async (status, reason, code) => {
    const initial = await prepared();
    now += 400000;
    api.register.mockResolvedValueOnce(denial(status, reason));
    expect(await service.prepare({ online: true })).toMatchObject({
      error: { code },
    });
    expect(new ProvisioningCache(database).read(scope()).blocked).toBe(true);
    expect(new ProvisioningCache(database).read(scope()).credential).toEqual(
      initial.credential,
    );
    service = make();
    expect(await service.prepare({ online: false })).toMatchObject({
      error: { code: "unauthorized" },
    });
  },
);

describe("secret-free sharing access projection", () => {
  it("publishes verified cached offline access without credentials or seeds", async () => {
    const listener = jest.fn();
    const unsubscribe = service.subscribeAccess(listener);
    expect(service.getAccessSnapshot()).toMatchObject({
      accountId: A,
      state: "pending",
    });
    await service.refreshAccess({ online: true });
    expect(service.getAccessSnapshot()).toEqual({
      accountId: A,
      state: "allowed",
      expiresAt: now + 600000,
    });
    const reopened = make();
    api.trust.mockClear();
    api.register.mockClear();
    await reopened.refreshAccess({ online: false });
    expect(reopened.getAccessSnapshot()).toEqual(service.getAccessSnapshot());
    expect(api.trust).not.toHaveBeenCalled();
    expect(api.register).not.toHaveBeenCalled();
    expect(listener).toHaveBeenCalled();
    unsubscribe();
    reopened.dispose();
  });
  it("notifies at credential expiry and cancels the timer on account changes", async () => {
    jest.useFakeTimers();
    try {
      await service.refreshAccess({ online: true });
      const listener = jest.fn();
      service.subscribeAccess(listener);
      now += 600000;
      jest.advanceTimersByTime(600000);
      expect(service.getAccessSnapshot()).toMatchObject({
        state: "unavailable",
        error: "expired",
      });
      expect(listener).toHaveBeenCalledTimes(1);
      await service.refreshAccess({ online: true });
      service.setAccount(B);
      expect(jest.getTimerCount()).toBe(0);
      expect(service.getAccessSnapshot()).toEqual({
        accountId: B,
        state: "pending",
        expiresAt: null,
      });
      service.dispose();
      expect(jest.getTimerCount()).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });
  it.each([
    ["PAID_REQUIRED", "locked", "paid-required"],
    ["DEVICE_REVOKED", "unavailable", "device-revoked"],
  ])(
    "projects %s without turning nonpayment failures into an upsell",
    async (code, state, error) => {
      await service.refreshAccess({ online: true });
      api.friendship.mockResolvedValueOnce(denial(403, code));
      await service.friendship(B, { online: true });
      expect(service.getAccessSnapshot()).toMatchObject({ state, error });
      await service.refreshAccess({ online: false });
      expect(service.getAccessSnapshot().state).toBe(state);
    },
  );
  it("cannot restore the previous account from delayed preparation", async () => {
    const flight = deferred<Awaited<ReturnType<TogetherOfflineApi["trust"]>>>();
    api.trust.mockReturnValueOnce(flight.promise);
    const pending = service.refreshAccess({ online: true });
    // Yield until preparation has entered its trust request.
    while (api.trust.mock.calls.length === 0) await Promise.resolve();
    service.setAccount(B);
    flight.resolve(
      ok({
        publicKeys: { v1: publicKeyPem(server) },
        maxCredentialAgeMs: 86400000,
      }),
    );
    await pending;
    expect(service.getAccessSnapshot()).toEqual({
      accountId: B,
      state: "pending",
      expiresAt: null,
    });
    service.dispose();
  });
});

it("explicit retry detaches a hung prepare and ignores its later refusal", async () => {
  const flight = deferred<Awaited<ReturnType<TogetherOfflineApi["trust"]>>>();
  api.trust.mockReturnValueOnce(flight.promise);
  const old = service.prepare({ online: true });
  while (api.trust.mock.calls.length === 0) await Promise.resolve();
  await service.refreshAccess({ online: true });
  expect(api.trust).toHaveBeenCalledTimes(2);
  expect(service.getAccessSnapshot().state).toBe("allowed");
  flight.resolve(denial(403, "PAID_REQUIRED"));
  expect(await old).toMatchObject({ ok: false, error: { code: "cancelled" } });
  expect(service.getAccessSnapshot().state).toBe("allowed");
  expect(new ProvisioningCache(database).read(scope()).blocked).toBe(false);
  service.dispose();
});
