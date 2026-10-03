/** @jest-environment node */
import { randomBytes } from "node:crypto";
import {
  TogetherLobbyBrowser,
  readProbe,
  readSummary,
  signSummary,
} from "../lobbyDiscovery";
import { publicKeyPem, signPayload } from "../security/identity";
import { encode64 } from "../security/encoding";
import type {
  TogetherLanEvent,
  TogetherLanNative,
} from "../../../../modules/together-lan";
const now = 1700000000000;
const id = (n: number) =>
  `${n.toString().padStart(8, "0")}-1111-4111-8111-111111111111`;
const seed = new Uint8Array(32).fill(3),
  issuer = new Uint8Array(32).fill(7);
const trustedKeys = { issuer: publicKeyPem(issuer) };
const identity = {
  seed,
  trustedKeys,
  deviceId: id(2),
  credential: signPayload(
    {
      kind: "together-device-v1" as const,
      keyId: "issuer",
      userId: id(1),
      deviceId: id(2),
      publicKey: publicKeyPem(seed),
      issuedAt: now - 1000,
      expiresAt: now + 60000,
    },
    issuer,
  ),
};
const pin = { sessionId: id(3), hostUserId: id(1), hostDeviceId: id(2) };
const nonce = encode64(randomBytes(32), true);
const frame = () => signSummary(pin, identity, "Strength", 1, nonce, now);
const settle = async () => {
  for (let i = 0; i < 30; i++) await Promise.resolve();
};
describe("strict signed pre-admission summary protocol", () => {
  it("only recognizes exact nonce-only probes", () => {
    expect(
      readProbe(JSON.stringify({ kind: "together-probe-v1", nonce })),
    ).toBe(nonce);
    for (const invalid of [
      "x".repeat(257),
      "{",
      "null",
      JSON.stringify({
        kind: "together-probe-v1",
        nonce,
        credential: identity.credential,
      }),
      JSON.stringify({ kind: "together-probe-v1", nonce: "short" }),
      JSON.stringify({ kind: "other", nonce }),
    ])
      expect(readProbe(invalid)).toBeUndefined();
  });
  it("checks issuer, identity, nonce, signature, session, bounds and strict fields", () => {
    expect(
      readSummary(frame(), pin.sessionId, nonce, trustedKeys, now),
    ).toMatchObject({ memberCount: 1 });
    for (const bad of [
      "x".repeat(6001),
      "{}",
      "null",
      "{",
      JSON.stringify({ payload: {} }),
    ])
      expect(() =>
        readSummary(bad, pin.sessionId, nonce, trustedKeys, now),
      ).toThrow();
    const payload = JSON.parse(frame()).payload;
    for (const change of [
      { kind: "other" },
      { audience: "invite-only" },
      { sessionId: id(4) },
      { hostDeviceId: "invalid" },
      { hostUserId: id(6) },
      { hostDeviceId: id(6) },
      { nonce: "other" },
      { workoutName: "" },
      { workoutName: 3 },
      { workoutName: "x".repeat(101) },
      { memberCount: 0 },
      { memberCount: 5 },
      { memberCount: 1.5 },
      { expiresAt: now },
      { expiresAt: now + 15001 },
      { expiresAt: 1.5 },
      { extra: "no" },
    ])
      expect(() =>
        readSummary(
          JSON.stringify(signPayload({ ...payload, ...change }, seed)),
          pin.sessionId,
          nonce,
          trustedKeys,
          now,
        ),
      ).toThrow();
    expect(() => readSummary(frame(), pin.sessionId, nonce, {}, now)).toThrow();
    expect(() =>
      readSummary(
        JSON.stringify(signPayload(payload, issuer)),
        pin.sessionId,
        nonce,
        trustedKeys,
        now,
      ),
    ).toThrow();
    const expiresSoon = {
      ...identity,
      credential: signPayload(
        { ...identity.credential.payload, expiresAt: now + 100 },
        issuer,
      ),
    };
    const soon = JSON.parse(signSummary(pin, expiresSoon, "A", 1, nonce, now));
    expect(soon.payload.expiresAt).toBe(now + 100);
    soon.payload.expiresAt = now + 101;
    expect(() =>
      readSummary(
        JSON.stringify(signPayload(soon.payload, seed)),
        pin.sessionId,
        nonce,
        trustedKeys,
        now,
      ),
    ).toThrow();
  });
});
describe("bounded anonymous network browser lifecycle", () => {
  let emit: (e: TogetherLanEvent) => void,
    native: TogetherLanNative,
    browser: TogetherLobbyBrowser;
  let changes: jest.Mock, errors: jest.Mock;
  beforeEach(() => {
    jest.useFakeTimers();
    changes = jest.fn();
    errors = jest.fn();
    native = {
      startHost: jest.fn(async () => {}),
      startDiscovery: jest.fn(async () => {}),
      connect: jest.fn(async () => {}),
      send: jest.fn(async () => {}),
      disconnect: jest.fn(async () => {}),
      stop: jest.fn(async () => {}),
      addListener: jest.fn((_event, listener) => {
        emit = listener;
        return { remove: jest.fn() };
      }),
    };
    browser = new TogetherLobbyBrowser({
      native,
      trustedKeys,
      randomBytes,
      now: () => now,
      onChange: changes,
      onError: errors,
    });
  });
  afterEach(async () => {
    await browser.stop().catch(() => {});
    jest.useRealTimers();
  });
  const discover = (endpointId = "one") =>
    emit({ type: "discovered", endpointId, lobbyId: pin.sessionId });
  const connect = (peerId = "peer") =>
    emit({ type: "connected", peerId, incoming: false });
  it("bounds total observed endpoints and never retries duplicate/lost advertisements", async () => {
    await browser.start();
    emit({ type: "discovered", endpointId: "invalid", lobbyId: "invalid" });
    for (let i = 0; i < 65; i++) discover(String(i));
    discover("0");
    expect(native.connect).toHaveBeenCalledTimes(1);
    for (let i = 0; i < 64; i++) {
      connect(`p${i}`);
      emit({ type: "disconnected", peerId: `p${i}` });
      await settle();
    }
    expect(native.connect).toHaveBeenCalledTimes(64);
    discover("0");
    expect(native.connect).toHaveBeenCalledTimes(64);
  });
  it("does not advance until disconnect completes and rejects unrequested incoming sockets", async () => {
    await browser.start();
    discover();
    discover("two");
    connect();
    let done!: () => void;
    jest.mocked(native.disconnect).mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          done = resolve;
        }),
    );
    emit({ type: "frame", peerId: "peer", frame: "invalid" });
    discover("three");
    expect(native.connect).toHaveBeenCalledTimes(1);
    done();
    await settle();
    expect(native.connect).toHaveBeenCalledTimes(2);
    emit({ type: "connected", peerId: "incoming", incoming: true });
    await settle();
    expect(native.disconnect).toHaveBeenCalledWith("incoming");
    emit({ type: "frame", peerId: "unknown", frame: "bad" });
  });
  it.each(["start", "connect", "disconnect", "event", "lost"])(
    "reports %s failures and stops without leaking identity",
    async (kind) => {
      if (kind === "start") {
        jest
          .mocked(native.startDiscovery)
          .mockRejectedValueOnce(new Error("permission"));
        await expect(browser.start()).rejects.toThrow("permission");
        return;
      }
      await browser.start();
      if (kind === "connect")
        jest.mocked(native.connect).mockRejectedValueOnce(new Error("lost"));
      discover();
      if (kind !== "connect" && kind !== "lost") connect();
      if (kind === "disconnect") {
        jest.mocked(native.disconnect).mockRejectedValueOnce(new Error("lost"));
        emit({ type: "frame", peerId: "peer", frame: "{}" });
      }
      if (kind === "event") emit({ type: "error", code: "permission" });
      if (kind === "lost") emit({ type: "lost", endpointId: "one" });
      await settle();
      expect(native.stop).toHaveBeenCalled();
      expect(errors).toHaveBeenCalledTimes(1);
    },
  );
  it("losing a connected probe preserves verified hosts and safely advances after disconnect", async () => {
    await browser.start();
    discover("verified");
    discover("lost");
    discover("next");
    connect("verified-peer");
    const reply = (peerId: string, workoutName: string) => {
      const challenge = JSON.parse(
        jest.mocked(native.send).mock.calls.at(-1)![1],
      ).nonce;
      emit({
        type: "frame",
        peerId,
        frame: signSummary(pin, identity, workoutName, 1, challenge, now),
      });
    };
    reply("verified-peer", "Still here");
    await settle();
    connect("lost-peer");
    const lateChallenge = JSON.parse(
      jest.mocked(native.send).mock.calls.at(-1)![1],
    ).nonce;
    let disconnected!: () => void;
    jest.mocked(native.disconnect).mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          disconnected = resolve;
        }),
    );
    emit({ type: "lost", endpointId: "lost" });
    expect(native.disconnect).toHaveBeenCalledWith("lost-peer");
    expect(native.connect).toHaveBeenCalledTimes(2);
    expect(changes).toHaveBeenLastCalledWith([
      expect.objectContaining({ workoutName: "Still here" }),
    ]);
    emit({
      type: "frame",
      peerId: "lost-peer",
      frame: signSummary(pin, identity, "Lost", 1, lateChallenge, now),
    });
    emit({ type: "error", peerId: "lost-peer", code: "read_failed" });
    emit({ type: "disconnected", peerId: "lost-peer" });
    expect(native.connect).toHaveBeenCalledTimes(2);
    disconnected();
    await settle();
    expect(native.connect).toHaveBeenLastCalledWith("next");
    connect("next-peer");
    emit({ type: "lost", endpointId: "lost" });
    emit({ type: "error", peerId: "lost-peer", code: "read_failed" });
    reply("next-peer", "Next host");
    await settle();
    expect(changes).toHaveBeenLastCalledWith([
      expect.objectContaining({ workoutName: "Still here" }),
      expect.objectContaining({ workoutName: "Next host" }),
    ]);
    expect(errors).not.toHaveBeenCalled();
    expect(native.stop).not.toHaveBeenCalled();
  });
  it("losing an unbound probe stops the generation so a late connection cannot become the next host", async () => {
    await browser.start();
    discover("lost");
    discover("next");
    emit({ type: "lost", endpointId: "lost" });
    await settle();
    connect("late-peer");
    expect(errors).toHaveBeenCalledWith("unreachable-host");
    expect(native.stop).toHaveBeenCalledTimes(1);
    expect(native.connect).toHaveBeenCalledTimes(1);
    expect(native.send).not.toHaveBeenCalled();
  });
  it("serial stop is idempotent and late native events are inert", async () => {
    await browser.start();
    discover();
    connect();
    await Promise.all([browser.stop(), browser.stop()]);
    emit({ type: "discovered", endpointId: "late", lobbyId: pin.sessionId });
    expect(native.connect).toHaveBeenCalledTimes(1);
    expect(native.stop).toHaveBeenCalledTimes(1);
  });
  it("handles rejected unexpected-socket disconnect and native stop without unhandled work", async () => {
    await browser.start();
    jest
      .mocked(native.disconnect)
      .mockRejectedValueOnce(new Error("disconnect"));
    jest.mocked(native.stop).mockRejectedValueOnce(new Error("stop"));
    emit({ type: "connected", peerId: "unrequested", incoming: false });
    await settle();
    expect(errors).toHaveBeenCalledWith("disconnect-failed");
    expect(native.stop).toHaveBeenCalledTimes(1);
  });
  it("ignores a late connect rejection after cancellation", async () => {
    await browser.start();
    let reject!: (error: Error) => void;
    jest.mocked(native.connect).mockImplementationOnce(
      () =>
        new Promise<void>((_resolve, fail) => {
          reject = fail;
        }),
    );
    discover();
    await browser.stop();
    reject(new Error("late"));
    await settle();
    expect(errors).not.toHaveBeenCalled();
  });
  it("continues private-then-open discovery through Android EOF and ignores late old peer errors", async () => {
    await browser.start();
    discover("private");
    discover("open");
    connect("private-peer");
    emit({ type: "error", peerId: "private-peer", code: "read_failed" });
    emit({ type: "disconnected", peerId: "private-peer" });
    await settle();
    expect(native.connect).toHaveBeenCalledTimes(2);
    connect("open-peer");
    emit({ type: "error", peerId: "private-peer", code: "read_failed" });
    const challenge = JSON.parse(
      jest.mocked(native.send).mock.calls.at(-1)![1],
    ).nonce;
    emit({
      type: "frame",
      peerId: "open-peer",
      frame: signSummary(pin, identity, "Open", 1, challenge, now),
    });
    await settle();
    emit({ type: "error", peerId: "open-peer", code: "read_failed" });
    emit({ type: "disconnected", peerId: "open-peer" });
    expect(changes).toHaveBeenLastCalledWith([
      expect.objectContaining({ workoutName: "Open" }),
    ]);
    expect(errors).not.toHaveBeenCalled();
    expect(native.stop).not.toHaveBeenCalled();
  });
  it("late old send rejection cannot terminate the next probe; current send rejection closes only that socket", async () => {
    await browser.start();
    discover();
    discover("next");
    let reject!: (reason: Error) => void;
    jest.mocked(native.send).mockImplementationOnce(
      () =>
        new Promise<void>((_resolve, fail) => {
          reject = fail;
        }),
    );
    connect("first");
    emit({ type: "disconnected", peerId: "first" });
    await settle();
    connect("next");
    reject(new Error("late flush"));
    await settle();
    expect(errors).not.toHaveBeenCalled();
    expect(native.stop).not.toHaveBeenCalled();
    emit({ type: "disconnected", peerId: "next" });
    await settle();
    discover("third");
    jest.mocked(native.send).mockRejectedValueOnce(new Error("write failed"));
    connect("third");
    await settle();
    expect(native.disconnect).toHaveBeenCalledWith("third");
    expect(errors).not.toHaveBeenCalled();
  });
});
