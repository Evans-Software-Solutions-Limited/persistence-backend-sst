/** @jest-environment node */
import { randomBytes } from "node:crypto";
import {
  TogetherLobbyBrowser,
  acceptedFriendIds,
  friendsHint,
  friendsHintTag,
  readFriendsHint,
  readProbe,
  readSummary,
  signSummary,
  FRIENDS_STEP_DEADLINE,
  NATIVE_CONNECT_DEADLINE,
  REFRESH_MARGIN,
  SUMMARY_TTL,
} from "../lobbyDiscovery";
import {
  publicKeyPem,
  signPayload,
  type FriendshipEvidence,
  type Signed,
} from "../security/identity";
import { encode64 } from "../security/encoding";
import { FriendsHostExchange } from "../friendsDiscovery";
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
  it("carries the start, plan rows and session code when the host sends them, and rejects malformed ones (PER-60)", () => {
    const details = {
      startedAt: now - 5000,
      plan: [{ name: "Squat", sets: 3, reps: 5 }],
      code: "4KQ928",
    };
    expect(
      readSummary(
        signSummary(pin, identity, "Strength", 1, nonce, now, details),
        pin.sessionId,
        nonce,
        trustedKeys,
        now,
      ),
    ).toMatchObject(details);
    expect(() =>
      readSummary(
        signSummary(pin, identity, "Strength", 1, nonce, now, {
          ...details,
          plan: [{ name: "Squat", sets: 0, reps: 5 }],
        }),
        pin.sessionId,
        nonce,
        trustedKeys,
        now,
      ),
    ).toThrow("invalid-summary");
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
  it("probes a verified host again before its summary expires so it stays listed through a 30 s search (inspector lead)", async () => {
    let clock = now;
    await browser.stop();
    browser = new TogetherLobbyBrowser({
      native,
      trustedKeys,
      randomBytes,
      now: () => clock,
      onChange: changes,
      onError: errors,
    });
    await browser.start();
    discover("one");
    connect("p1");
    const reply = (peerId: string) =>
      emit({
        type: "frame",
        peerId,
        frame: signSummary(
          pin,
          identity,
          "Strength",
          1,
          JSON.parse(jest.mocked(native.send).mock.calls.at(-1)![1]).nonce,
          clock,
        ),
      });
    reply("p1");
    emit({ type: "disconnected", peerId: "p1" });
    await settle();
    expect(native.connect).toHaveBeenCalledTimes(1);
    // Under the refresh margin nothing happens; inside it the host is probed again, once.
    clock = now + SUMMARY_TTL - REFRESH_MARGIN - 1000;
    jest.advanceTimersByTime(1000);
    expect(native.connect).toHaveBeenCalledTimes(1);
    clock = now + SUMMARY_TTL - REFRESH_MARGIN;
    jest.advanceTimersByTime(1000);
    expect(native.connect).toHaveBeenCalledTimes(2);
    expect(native.connect).toHaveBeenLastCalledWith("one");
    jest.advanceTimersByTime(1000);
    expect(native.connect).toHaveBeenCalledTimes(2);
    connect("p2");
    reply("p2");
    emit({ type: "disconnected", peerId: "p2" });
    await settle();
    // The refreshed summary outlives the first one's expiry.
    clock = now + SUMMARY_TTL + 1000;
    jest.advanceTimersByTime(1000);
    expect(changes).toHaveBeenLastCalledWith([
      expect.objectContaining({ workoutName: "Strength" }),
    ]);
    // A lost host is not refreshed; an expired one is dropped.
    emit({ type: "lost", endpointId: "one" });
    expect(changes).toHaveBeenLastCalledWith([]);
    clock += 2 * SUMMARY_TTL;
    jest.advanceTimersByTime(1000);
    expect(native.connect).toHaveBeenCalledTimes(2);
    expect(errors).not.toHaveBeenCalled();
  });
  it("a refresh probe that fails drops only that host's row; the search carries on (inspector lead)", async () => {
    let clock = now;
    await browser.stop();
    browser = new TogetherLobbyBrowser({
      native,
      trustedKeys,
      randomBytes,
      now: () => clock,
      onChange: changes,
      onError: errors,
    });
    await browser.start();
    const other = { ...pin, sessionId: id(4) };
    const reply = (peerId: string, who: typeof pin, name: string) =>
      emit({
        type: "frame",
        peerId,
        frame: signSummary(
          who,
          identity,
          name,
          1,
          JSON.parse(jest.mocked(native.send).mock.calls.at(-1)![1]).nonce,
          clock,
        ),
      });
    discover("a");
    emit({ type: "discovered", endpointId: "b", lobbyId: other.sessionId });
    connect("pa");
    reply("pa", pin, "Host A");
    emit({ type: "disconnected", peerId: "pa" });
    await settle();
    connect("pb");
    reply("pb", other, "Host B");
    emit({ type: "disconnected", peerId: "pb" });
    await settle();
    expect(changes).toHaveBeenLastCalledWith([
      expect.objectContaining({ workoutName: "Host A" }),
      expect.objectContaining({ workoutName: "Host B" }),
    ]);
    // Both come up for refresh; A's connect is rejected, B's times out.
    clock = now + SUMMARY_TTL - REFRESH_MARGIN;
    jest.mocked(native.connect).mockRejectedValueOnce(new Error("gone"));
    jest.advanceTimersByTime(1000);
    await settle();
    // A's rejection left no socket behind: A is dropped and B probed at once.
    expect(native.connect).toHaveBeenCalledTimes(4);
    expect(
      jest
        .mocked(native.connect)
        .mock.calls.slice(2)
        .map((c) => c[0]),
    ).toEqual(["a", "b"]);
    expect(errors).not.toHaveBeenCalled();
    expect(changes).toHaveBeenLastCalledWith([
      expect.objectContaining({ workoutName: "Host B" }),
    ]);
    // B's refresh times out: B is dropped, but its socket may still connect,
    // so the slot stays reserved and a newly found host C waits.
    jest.advanceTimersByTime(5000);
    await settle();
    expect(errors).not.toHaveBeenCalled();
    expect(changes).toHaveBeenLastCalledWith([]);
    emit({ type: "discovered", endpointId: "c", lobbyId: pin.sessionId });
    await settle();
    expect(native.connect).toHaveBeenCalledTimes(4);
    // B's late connection is dropped, never bound to C's probe, and frees the slot.
    connect("late-b");
    await settle();
    expect(native.disconnect).toHaveBeenLastCalledWith("late-b");
    expect(native.send).not.toHaveBeenCalledWith("late-b", expect.anything());
    expect(native.connect).toHaveBeenCalledTimes(5);
    expect(native.connect).toHaveBeenLastCalledWith("c");
    connect("pc");
    reply("pc", pin, "Host C");
    emit({ type: "disconnected", peerId: "pc" });
    await settle();
    expect(changes).toHaveBeenLastCalledWith([
      expect.objectContaining({ workoutName: "Host C" }),
    ]);
    // The late socket's own closing event (we disconnected it) changes nothing.
    emit({ type: "disconnected", peerId: "late-b" });
    await settle();
    expect(native.connect).toHaveBeenCalledTimes(5);
    // C's refresh connect fails fast (a host that closed the app): its
    // stray closing event fails the probe at once, with no 5 s wait and no
    // reservation, so a newly found host D is probed straight away.
    clock += SUMMARY_TTL - REFRESH_MARGIN;
    jest.advanceTimersByTime(1000);
    await settle();
    expect(native.connect).toHaveBeenCalledTimes(6);
    expect(native.connect).toHaveBeenLastCalledWith("c");
    emit({ type: "discovered", endpointId: "d", lobbyId: pin.sessionId });
    emit({ type: "error", peerId: "c-sock", code: "connect_failed" });
    emit({ type: "disconnected", peerId: "c-sock" });
    await settle();
    expect(changes).toHaveBeenLastCalledWith([]);
    expect(native.connect).toHaveBeenCalledTimes(7);
    expect(native.connect).toHaveBeenLastCalledWith("d");
    expect(errors).not.toHaveBeenCalled();
    connect("pd");
    reply("pd", pin, "Host D");
    emit({ type: "disconnected", peerId: "pd" });
    await settle();
    // D's refresh times out and is reserved; the socket then fails late,
    // which frees the slot before the native deadline.
    clock += SUMMARY_TTL - REFRESH_MARGIN;
    jest.advanceTimersByTime(1000);
    await settle();
    expect(native.connect).toHaveBeenCalledTimes(8);
    jest.advanceTimersByTime(5000);
    emit({ type: "discovered", endpointId: "e", lobbyId: pin.sessionId });
    await settle();
    expect(native.connect).toHaveBeenCalledTimes(8);
    emit({ type: "disconnected", peerId: "d-sock" });
    await settle();
    expect(native.connect).toHaveBeenCalledTimes(9);
    expect(native.connect).toHaveBeenLastCalledWith("e");
    // Without any late event the slot frees itself at the native deadline.
    jest.advanceTimersByTime(5000);
    expect(errors).toHaveBeenCalledWith("unreachable-host");
  });
  it("a reserved slot frees itself at the native connect deadline when nothing is heard", async () => {
    let clock = now;
    await browser.stop();
    browser = new TogetherLobbyBrowser({
      native,
      trustedKeys,
      randomBytes,
      now: () => clock,
      onChange: changes,
      onError: errors,
    });
    await browser.start();
    discover("a");
    connect("pa");
    emit({
      type: "frame",
      peerId: "pa",
      frame: signSummary(
        pin,
        identity,
        "Host A",
        1,
        JSON.parse(jest.mocked(native.send).mock.calls.at(-1)![1]).nonce,
        clock,
      ),
    });
    emit({ type: "disconnected", peerId: "pa" });
    await settle();
    clock += SUMMARY_TTL - REFRESH_MARGIN;
    jest.advanceTimersByTime(1000);
    await settle();
    expect(native.connect).toHaveBeenCalledTimes(2);
    jest.advanceTimersByTime(5000);
    emit({ type: "discovered", endpointId: "b", lobbyId: pin.sessionId });
    await settle();
    expect(native.connect).toHaveBeenCalledTimes(2);
    jest.advanceTimersByTime(NATIVE_CONNECT_DEADLINE);
    await settle();
    expect(native.connect).toHaveBeenCalledTimes(3);
    expect(native.connect).toHaveBeenLastCalledWith("b");
    expect(errors).not.toHaveBeenCalled();
    expect(native.stop).toHaveBeenCalledTimes(1);
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
describe("Training partners search (Brad, 3 Nov; Inspector Brad, PR #527)", () => {
  const friendId = pin.hostUserId;
  const guestId = id(9);
  const proof = signPayload(
    {
      kind: "together-friendship-v1" as const,
      keyId: "issuer",
      users: [friendId, guestId] as [string, string],
      issuedAt: now - 100,
      expiresAt: now + 60000,
    },
    issuer,
  ) as Signed<FriendshipEvidence>;
  it("the hint names no session, host or plan, and its tag changes with every nonce", () => {
    const other = encode64(randomBytes(32), true);
    const hint = friendsHint(nonce, friendId);
    expect(hint.length).toBeLessThanOrEqual(256);
    expect(Object.keys(JSON.parse(hint)).sort()).toEqual([
      "kind",
      "nonce",
      "tag",
    ]);
    for (const secret of [friendId, pin.sessionId, pin.hostDeviceId])
      expect(hint).not.toContain(secret);
    expect(readFriendsHint(hint, nonce)).toBe(friendsHintTag(nonce, friendId));
    expect(friendsHintTag(other, friendId)).not.toBe(
      friendsHintTag(nonce, friendId),
    );
    expect(friendsHintTag(nonce, id(9))).not.toBe(
      friendsHintTag(nonce, friendId),
    );
    for (const bad of [
      friendsHint(other, friendId),
      "x".repeat(257),
      "{",
      JSON.stringify({ ...JSON.parse(hint), tag: "short" }),
      JSON.stringify({ ...JSON.parse(hint), extra: 1 }),
      JSON.stringify({ ...JSON.parse(hint), kind: "together-probe-v1" }),
    ])
      expect(readFriendsHint(bad, nonce)).toBeUndefined();
    // A hint is never mistaken for a probe.
    expect(readProbe(hint)).toBeUndefined();
  });
  it("accepts a partners summary only in the friends flow and only from the matched partner", () => {
    const partners = signSummary(
      pin,
      identity,
      "Partners",
      1,
      nonce,
      now,
      undefined,
      "friends",
    );
    expect(
      readSummary(partners, pin.sessionId, nonce, trustedKeys, now, friendId),
    ).toMatchObject({ audience: "friends", hostUserId: friendId });
    expect(() =>
      readSummary(partners, pin.sessionId, nonce, trustedKeys, now),
    ).toThrow("invalid-summary");
    expect(() =>
      readSummary(partners, pin.sessionId, nonce, trustedKeys, now, id(9)),
    ).toThrow("invalid-summary");
    expect(() =>
      readSummary(frame(), pin.sessionId, nonce, trustedKeys, now, friendId),
    ).toThrow("invalid-summary");
  });
  it("reads every page of partners, past 200, and stops on a repeated cursor", async () => {
    const partner = (n: number) =>
      `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
    const pages = 15;
    const friends = jest.fn(async (cursor?: string) => {
      const page = cursor ? Number(cursor) : 0;
      return {
        ok: true as const,
        value: {
          data: Array.from({ length: 20 }, (_, k) => ({
            userId: id(1),
            friendId: partner(page * 20 + k),
            status: "accepted",
          })),
          nextCursor: page + 1 < pages ? String(page + 1) : null,
        },
      };
    });
    const all = await acceptedFriendIds({ friends } as never, id(1));
    expect(all).toHaveLength(pages * 20);
    expect(all).toContain(partner(pages * 20 - 1));
    // A server that keeps handing back the same cursor can't loop the search.
    const stuck = jest.fn(async () => ({
      ok: true as const,
      value: {
        data: [{ userId: id(1), friendId: id(2), status: "accepted" }],
        nextCursor: "same",
      },
    }));
    await expect(
      acceptedFriendIds({ friends: stuck } as never, id(1)),
    ).resolves.toEqual([id(2)]);
    expect(stuck).toHaveBeenCalledTimes(2);
  });
  it("lists accepted partners from every page, in both directions", async () => {
    const page = (data: object[], nextCursor: string | null) =>
      ({ ok: true, value: { data, nextCursor } }) as never;
    const row = (userId: string, friendId: string, status = "accepted") => ({
      userId,
      friendId,
      status,
    });
    const friends = jest
      .fn()
      .mockResolvedValueOnce(
        page([row(id(1), id(2)), row(id(3), id(1), "pending")], "next"),
      )
      .mockResolvedValueOnce(
        page([row(id(4), id(1)), row(id(1), id(2))], null),
      );
    expect(await acceptedFriendIds({ friends }, id(1))).toEqual([id(2), id(4)]);
    expect(friends).toHaveBeenLastCalledWith("next");
    await expect(
      acceptedFriendIds(
        {
          friends: async () =>
            ({ ok: false, error: { code: "offline" } }) as never,
        },
        id(1),
      ),
    ).rejects.toThrow("friends-unavailable");
  });
  describe("browser", () => {
    let emit: (e: TogetherLanEvent) => void, native: TogetherLanNative;
    let browser: TogetherLobbyBrowser, clock: number;
    let changes: jest.Mock, errors: jest.Mock;
    let ids: jest.Mock, proofFor: jest.Mock, guests: string[];
    beforeEach(() => {
      jest.useFakeTimers();
      clock = now;
      guests = [];
      changes = jest.fn();
      errors = jest.fn();
      ids = jest.fn(async () => [id(8), friendId]);
      proofFor = jest.fn(async () => proof);
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
        now: () => clock,
        onChange: changes,
        onError: errors,
        friends: { ids, proof: proofFor },
      });
    });
    afterEach(async () => {
      await browser.stop().catch(() => {});
      jest.useRealTimers();
    });
    const wire = () => jest.mocked(native.send).mock.calls.map(([, f]) => f);
    const sent = () =>
      wire().map((f) => JSON.parse(f) as Record<string, unknown>);
    const challenge = () => sent().at(-1)!.nonce as string;
    const partnersSummary = (n: string) =>
      signSummary(pin, identity, "Partners", 1, n, clock, undefined, "friends");
    /** The real host side of the exchange, as P's phone runs it. */
    const exchange = (
      n: string,
      who: { hostUserId: string; credential: typeof identity.credential },
      deviceSeed = seed,
    ) =>
      new FriendsHostExchange({
        hint: friendsHint(n, who.hostUserId),
        nonce: n,
        sessionId: pin.sessionId,
        hostUserId: who.hostUserId,
        credential: who.credential,
        seed: deviceSeed,
        trustedKeys,
        randomBytes,
        now: () => clock,
        summary: (guest) => {
          guests.push(guest);
          return partnersSummary(n);
        },
      });
    /** Connect, answer the probe with a hint; returns the host side. */
    async function partnersHost(
      peerId: string,
      make = (n: string) =>
        exchange(n, { hostUserId: friendId, credential: identity.credential }),
    ) {
      emit({ type: "connected", peerId, incoming: false });
      const n = challenge();
      const side = make(n);
      emit({ type: "frame", peerId, frame: side.hint });
      await settle();
      return side;
    }
    /** Feed the guest's last frame to the host and its reply back. */
    async function pump(peerId: string, side: FriendsHostExchange) {
      const reply = side.receive(wire().at(-1)!);
      if (reply) emit({ type: "frame", peerId, frame: reply });
      await settle();
      return reply;
    }
    it("a partner's host proves itself before the guest sends anything identifying; the summary lists", async () => {
      await browser.start();
      emit({ type: "discovered", endpointId: "one", lobbyId: pin.sessionId });
      const host = await partnersHost("p1");
      // The challenge is a fresh ephemeral key and nothing else.
      expect(sent()[1]).toEqual({
        kind: "together-friends-challenge-v1",
        nonce: expect.any(String),
        eph: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
      });
      // Fetched from our own server meanwhile, but nothing more is sent yet.
      expect(proofFor).toHaveBeenCalledWith(friendId);
      expect(sent()).toHaveLength(2);
      await pump("p1", host);
      expect(sent()[2]).toEqual({
        kind: "together-friends-proof-v1",
        nonce: expect.any(String),
        sealed: expect.any(String),
      });
      const reply = await pump("p1", host);
      expect(guests).toEqual([guestId]);
      // Only ciphertext crosses the air after the hint.
      for (const f of [...wire().slice(1), reply!])
        for (const clear of [guestId, "together-friendship-v1", "Partners"])
          expect(f).not.toContain(clear);
      expect(changes).toHaveBeenLastCalledWith([
        expect.objectContaining({
          audience: "friends",
          workoutName: "Partners",
          friendship: proof,
        }),
      ]);
      expect(native.disconnect).toHaveBeenCalledWith("p1");
      expect(errors).not.toHaveBeenCalled();
    });
    it("a device that knows the partner's id but is not the partner learns no guest identity and no proof", async () => {
      const forger = new Uint8Array(32).fill(4);
      const forgerCredential = signPayload(
        {
          ...identity.credential.payload,
          userId: id(5),
          deviceId: id(6),
          publicKey: publicKeyPem(forger),
        },
        issuer,
      );
      await browser.start();
      for (const name of ["a", "b"])
        emit({ type: "discovered", endpointId: name, lobbyId: pin.sessionId });
      // Its own server credential, claiming the partner's id for the keys.
      let host = await partnersHost("pa", (n) =>
        exchange(
          n,
          { hostUserId: friendId, credential: forgerCredential },
          forger,
        ),
      );
      await pump("pa", host);
      expect(native.disconnect).toHaveBeenCalledWith("pa");
      // The partner's (public) credential, without the partner's device key.
      host = await partnersHost("pb", (n) =>
        exchange(
          n,
          { hostUserId: friendId, credential: identity.credential },
          forger,
        ),
      );
      await pump("pb", host);
      expect(native.disconnect).toHaveBeenCalledWith("pb");
      // The proof may come from our own server, but it never leaves the phone.
      expect(sent().map((f) => f.kind)).toEqual([
        "together-probe-v1",
        "together-friends-challenge-v1",
        "together-probe-v1",
        "together-friends-challenge-v1",
      ]);
      for (const f of wire()) expect(f).not.toContain(guestId);
      expect(changes).not.toHaveBeenCalledWith([expect.anything()]);
      expect(errors).not.toHaveBeenCalled();
    });
    it("a stranger's hint or a missing proof sends nothing more and lists nothing", async () => {
      await browser.start();
      for (const name of ["a", "b"])
        emit({ type: "discovered", endpointId: name, lobbyId: pin.sessionId });
      await partnersHost("pa", (n) =>
        exchange(n, { hostUserId: id(7), credential: identity.credential }),
      );
      expect(sent()).toHaveLength(1);
      expect(native.disconnect).toHaveBeenCalledWith("pa");
      proofFor.mockResolvedValueOnce(null);
      const host = await partnersHost("pb");
      await pump("pb", host);
      expect(sent().map((f) => f.kind)).toEqual([
        "together-probe-v1",
        "together-probe-v1",
        "together-friends-challenge-v1",
      ]);
      expect(native.disconnect).toHaveBeenCalledWith("pb");
      expect(changes).not.toHaveBeenCalledWith([expect.anything()]);
      expect(errors).not.toHaveBeenCalled();
    });
    it("offline (the partner list fails) ignores hints but still lists open hosts", async () => {
      ids.mockRejectedValue(new Error("offline"));
      await browser.start();
      emit({ type: "discovered", endpointId: "f", lobbyId: pin.sessionId });
      const other = { ...pin, sessionId: id(4) };
      emit({ type: "discovered", endpointId: "o", lobbyId: other.sessionId });
      await partnersHost("pf");
      expect(sent()).toHaveLength(1);
      emit({ type: "connected", peerId: "po", incoming: false });
      emit({
        type: "frame",
        peerId: "po",
        frame: signSummary(other, identity, "Open", 1, challenge(), clock),
      });
      await settle();
      expect(changes).toHaveBeenLastCalledWith([
        expect.objectContaining({ audience: "open", workoutName: "Open" }),
      ]);
      expect(errors).not.toHaveBeenCalled();
      expect(ids).toHaveBeenCalledTimes(1);
    });
    it("a partners host that never answers is closed without ending the search", async () => {
      await browser.start();
      emit({ type: "discovered", endpointId: "slow", lobbyId: pin.sessionId });
      emit({ type: "discovered", endpointId: "next", lobbyId: pin.sessionId });
      await partnersHost("ps");
      jest.advanceTimersByTime(FRIENDS_STEP_DEADLINE);
      await settle();
      expect(native.disconnect).toHaveBeenCalledWith("ps");
      expect(native.connect).toHaveBeenLastCalledWith("next");
      expect(errors).not.toHaveBeenCalled();
    });
    it("a hint that arrives late in the slot gets only what is left of the partners budget, not a fresh one", async () => {
      await browser.start();
      emit({ type: "discovered", endpointId: "late", lobbyId: pin.sessionId });
      emit({ type: "discovered", endpointId: "next", lobbyId: pin.sessionId });
      // The host takes 3.5 s to connect and hint: 0.5 s of the 4 s budget remains.
      clock += 3500;
      jest.advanceTimersByTime(3500);
      await partnersHost("pl");
      clock += 600;
      jest.advanceTimersByTime(600);
      await settle();
      expect(native.disconnect).toHaveBeenCalledWith("pl");
      expect(native.connect).toHaveBeenLastCalledWith("next");
      expect(errors).not.toHaveBeenCalled();
    });
    it("a partner host cut off late in its slot gets one fresh slot, and only one", async () => {
      await browser.start();
      emit({ type: "discovered", endpointId: "late", lobbyId: pin.sessionId });
      clock += 3500;
      jest.advanceTimersByTime(3500);
      await partnersHost("pl");
      // It hinted late and never got through the exchange in what was left.
      clock += 600;
      jest.advanceTimersByTime(600);
      await settle();
      expect(native.disconnect).toHaveBeenCalledWith("pl");
      expect(jest.mocked(native.connect).mock.calls.map(([e]) => e)).toEqual([
        "late",
        "late",
      ]);
      // The retry stalls too: no third slot.
      await partnersHost("pl2");
      clock += FRIENDS_STEP_DEADLINE;
      jest.advanceTimersByTime(FRIENDS_STEP_DEADLINE);
      await settle();
      expect(native.disconnect).toHaveBeenCalledWith("pl2");
      expect(native.connect).toHaveBeenCalledTimes(2);
      expect(errors).not.toHaveBeenCalled();
    });
    it("a challenge that cannot be written closes only that socket", async () => {
      await browser.start();
      emit({ type: "discovered", endpointId: "w", lobbyId: pin.sessionId });
      jest
        .mocked(native.send)
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error("write failed"));
      await partnersHost("pw");
      expect(native.disconnect).toHaveBeenCalledWith("pw");
      expect(errors).not.toHaveBeenCalled();
      expect(native.stop).not.toHaveBeenCalled();
    });
    it("a host that talks out of turn gets nothing", async () => {
      let release!: (ids: string[]) => void;
      ids.mockReturnValue(
        new Promise((resolve) => {
          release = resolve;
        }),
      );
      await browser.start();
      emit({ type: "discovered", endpointId: "x", lobbyId: pin.sessionId });
      emit({ type: "discovered", endpointId: "y", lobbyId: pin.sessionId });
      emit({ type: "connected", peerId: "px", incoming: false });
      const n = challenge();
      emit({ type: "frame", peerId: "px", frame: friendsHint(n, friendId) });
      emit({ type: "frame", peerId: "px", frame: partnersSummary(n) });
      await settle();
      expect(native.disconnect).toHaveBeenCalledWith("px");
      release([friendId]);
      await settle();
      expect(sent()).toHaveLength(1);
      // While the proof is being fetched, too.
      let fetched!: (p: typeof proof) => void;
      proofFor.mockReturnValueOnce(
        new Promise((resolve) => {
          fetched = resolve;
        }),
      );
      const host = await partnersHost("py");
      await pump("py", host);
      emit({ type: "frame", peerId: "py", frame: "{}" });
      fetched(proof);
      await settle();
      expect(native.disconnect).toHaveBeenCalledWith("py");
      expect(sent().at(-1)!.kind).toBe("together-friends-challenge-v1");
      expect(changes).not.toHaveBeenCalledWith([expect.anything()]);
      expect(errors).not.toHaveBeenCalled();
    });
    it("a refresh of a partners host re-runs the exchange and keeps it listed, reading partners and proof once", async () => {
      await browser.start();
      emit({ type: "discovered", endpointId: "one", lobbyId: pin.sessionId });
      const answer = async (peerId: string) => {
        const host = await partnersHost(peerId);
        await pump(peerId, host);
        await pump(peerId, host);
        emit({ type: "disconnected", peerId });
        await settle();
      };
      await answer("p1");
      clock = now + SUMMARY_TTL - REFRESH_MARGIN;
      jest.advanceTimersByTime(1000);
      expect(native.connect).toHaveBeenCalledTimes(2);
      await answer("p2");
      expect(
        sent().filter((f) => f.kind === "together-friends-proof-v1"),
      ).toHaveLength(2);
      clock = now + SUMMARY_TTL + 1000;
      jest.advanceTimersByTime(1000);
      expect(changes).toHaveBeenLastCalledWith([
        expect.objectContaining({ audience: "friends" }),
      ]);
      expect(ids).toHaveBeenCalledTimes(1);
      expect(proofFor).toHaveBeenCalledTimes(1);
    });
    const pending = <T>() => {
      let resolve!: (value: T) => void;
      const promise = new Promise<T>((r) => {
        resolve = r;
      });
      return { promise, resolve };
    };
    /** Advance fake time and the clock together, one publish tick at a time. */
    const tick = async (ms: number) => {
      for (let t = 0; t < ms; t += 500) {
        clock += 500;
        jest.advanceTimersByTime(500);
        await settle();
      }
    };
    it("asks for the partner list when the search starts, not on the probe socket (Inspector Brad, PR #527)", async () => {
      await browser.start();
      expect(ids).toHaveBeenCalledTimes(1);
      expect(native.connect).not.toHaveBeenCalled();
    });
    it.each(["partner list", "proof fetch", "host's answer"])(
      "a listed open host stays listed while a partner step is slow (%s)",
      async (slow) => {
        const never = new Promise<never>(() => {});
        if (slow === "partner list") ids.mockReturnValue(never);
        if (slow === "proof fetch") proofFor.mockReturnValue(never);
        await browser.start();
        await settle();
        const open = { ...pin, sessionId: id(4) };
        emit({
          type: "discovered",
          endpointId: "open",
          lobbyId: open.sessionId,
        });
        emit({ type: "connected", peerId: "o1", incoming: false });
        const openReply = (peerId: string) =>
          emit({
            type: "frame",
            peerId,
            frame: signSummary(open, identity, "Open", 1, challenge(), clock),
          });
        openReply("o1");
        await settle();
        // The partner host is found just before the open host's refresh is due.
        await tick(9500);
        emit({ type: "discovered", endpointId: "p", lobbyId: pin.sessionId });
        const host = await partnersHost("pp");
        if (slow === "proof fetch") await pump("pp", host);
        // The refresh goes out before the open summary lapses (15 s).
        await tick(4500);
        expect(native.connect).toHaveBeenLastCalledWith("open");
        emit({ type: "connected", peerId: "o2", incoming: false });
        openReply("o2");
        await settle();
        await tick(2000);
        expect(changes).toHaveBeenLastCalledWith([
          expect.objectContaining({ workoutName: "Open" }),
        ]);
        expect(errors).not.toHaveBeenCalled();
      },
    );
    it("a proof that misses the deadline is used on the next probe without a second fetch", async () => {
      const late = pending<typeof proof>();
      proofFor.mockReturnValue(late.promise);
      await browser.start();
      await settle();
      emit({ type: "discovered", endpointId: "p", lobbyId: pin.sessionId });
      let host = await partnersHost("p1");
      await pump("p1", host);
      await tick(FRIENDS_STEP_DEADLINE);
      expect(native.disconnect).toHaveBeenCalledWith("p1");
      expect(sent().some((f) => f.kind === "together-friends-proof-v1")).toBe(
        false,
      );
      late.resolve(proof);
      await settle();
      expect(native.connect).toHaveBeenCalledTimes(2);
      expect(native.connect).toHaveBeenLastCalledWith("p");
      host = await partnersHost("p2");
      await pump("p2", host);
      await pump("p2", host);
      expect(changes).toHaveBeenLastCalledWith([
        expect.objectContaining({ audience: "friends", friendship: proof }),
      ]);
      expect(proofFor).toHaveBeenCalledTimes(1);
    });
    it("a hint that arrives before the partner list is probed again once it loads", async () => {
      const list = pending<string[]>();
      ids.mockReturnValue(list.promise);
      await browser.start();
      emit({ type: "discovered", endpointId: "p", lobbyId: pin.sessionId });
      await partnersHost("p1");
      expect(sent()).toHaveLength(1);
      expect(native.disconnect).toHaveBeenCalledWith("p1");
      list.resolve([friendId]);
      await settle();
      expect(native.connect).toHaveBeenCalledTimes(2);
      const host = await partnersHost("p2");
      await pump("p2", host);
      await pump("p2", host);
      expect(changes).toHaveBeenLastCalledWith([
        expect.objectContaining({ audience: "friends" }),
      ]);
      expect(ids).toHaveBeenCalledTimes(1);
    });
    it("a guest without partner search ignores the hint, exactly as before", async () => {
      await browser.stop();
      browser = new TogetherLobbyBrowser({
        native,
        trustedKeys,
        randomBytes,
        now: () => clock,
        onChange: changes,
        onError: errors,
      });
      await browser.start();
      emit({ type: "discovered", endpointId: "one", lobbyId: pin.sessionId });
      await partnersHost("p1");
      expect(sent()).toHaveLength(1);
      expect(native.disconnect).toHaveBeenCalledWith("p1");
      expect(errors).not.toHaveBeenCalled();
    });
  });
});
