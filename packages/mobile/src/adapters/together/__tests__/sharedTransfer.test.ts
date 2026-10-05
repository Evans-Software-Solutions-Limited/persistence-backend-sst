/** @jest-environment node */
import {
  SharedAssembly,
  sharedChunks,
  sharedLimit,
  MAX_PREVIOUS_BYTES,
  MAX_SHARED_BYTES,
  SHARED_TRANSFER_TIMEOUT,
} from "../sharedTransfer";
import type { SharedEnvelope } from "../sharedSession";
import { requestHash } from "../security/identity";
const envelope = (): SharedEnvelope => ({
  payload: {
    kind: "together-shared-v1",
    sessionId: "s",
    authorId: "a",
    recipientId: "r",
    id: "i",
    revision: 1,
    type: "previous",
    body: { ciphertext: "a".repeat(50000) },
  },
  signature: "signature",
});
describe("bounded authenticated-channel PREV assembly", () => {
  let assembly: SharedAssembly;
  beforeEach(() => {
    jest.useFakeTimers();
    assembly = new SharedAssembly();
  });
  afterEach(() => {
    assembly.clear();
    jest.useRealTimers();
  });
  it("publishes only a complete hash-verified snapshot and supports a fresh retry", () => {
    const value = envelope(),
      chunks = sharedChunks(value);
    for (const c of chunks.slice(0, -1))
      expect(assembly.accept(c)).toBeUndefined();
    expect(assembly.accept(chunks.at(-1))).toEqual(value);
    for (const c of chunks.slice(0, -1))
      expect(assembly.accept(c)).toBeUndefined();
    expect(assembly.accept(chunks.at(-1))).toEqual(value);
    expect(sharedLimit(value)).toBe(MAX_PREVIOUS_BYTES);
    expect(
      sharedLimit({ ...value, payload: { ...value.payload, type: "plan" } }),
    ).toBe(MAX_SHARED_BYTES);
  });
  it.each([
    { length: MAX_PREVIOUS_BYTES + 1 },
    { length: 30000 },
    { index: -1 },
    { count: 0 },
    { count: 999 },
    { transfer: "bad" },
    { data: "" },
    { data: "é".repeat(12000) },
    { extra: 1 },
  ])(
    "rejects invalid chunk bounds/shape %j without keeping a partial buffer",
    (patch) => {
      const chunks = sharedChunks(envelope());
      assembly.accept(chunks[0]);
      expect(() => assembly.accept({ ...chunks[1], ...patch })).toThrow(
        "Invalid shared transfer",
      );
      expect(() => assembly.accept(chunks[1])).toThrow("Out-of-order");
    },
  );
  it("rejects gaps, duplicates and conflicting transfer metadata", () => {
    const chunks = sharedChunks(envelope());
    expect(() => assembly.accept(chunks[1])).toThrow("Out-of-order");
    assembly.accept(chunks[0]);
    expect(() => assembly.accept(chunks[0])).toThrow("Out-of-order");
    assembly.accept(chunks[0]);
    expect(() =>
      assembly.accept({ ...chunks[1], transfer: "f".repeat(64) }),
    ).toThrow("Out-of-order");
  });
  it("expires even when no further frames arrive and never extends deadline on progress", () => {
    const chunks = sharedChunks(envelope());
    assembly.accept(chunks[0]);
    jest.advanceTimersByTime(SHARED_TRANSFER_TIMEOUT - 1);
    assembly.accept(chunks[1]);
    jest.advanceTimersByTime(1);
    expect(() => assembly.accept(chunks[2])).toThrow("Out-of-order");
    expect(jest.getTimerCount()).toBe(0);
  });
  it("checks absolute time even before a delayed timer executes", () => {
    let now = 0;
    assembly = new SharedAssembly(() => now);
    const chunks = sharedChunks(envelope());
    assembly.accept(chunks[0]);
    now = SHARED_TRANSFER_TIMEOUT;
    expect(() => assembly.accept(chunks[1])).toThrow("Out-of-order");
  });
  it("discards a superseded partial snapshot and verifies whole-message integrity", () => {
    const chunks = sharedChunks(envelope());
    assembly.accept(chunks[0]);
    const next = envelope();
    next.payload.revision = 2;
    const replacement = sharedChunks(next);
    replacement.forEach((c, i) =>
      expect(assembly.accept(c)).toEqual(
        i === replacement.length - 1 ? next : undefined,
      ),
    );
    const changed = envelope();
    changed.signature = "different";
    const tampered = sharedChunks(changed).map((c) => ({
      ...c,
      transfer: chunks[0].transfer,
    }));
    for (const c of tampered.slice(0, -1)) assembly.accept(c);
    expect(() => assembly.accept(tampered.at(-1))).toThrow("hash");
  });
  it("does not allow the larger budget to transfer other message types", () => {
    const value = envelope();
    value.payload.type = "progress";
    expect(() => sharedChunks(value)).toThrow();
    const chunks = sharedChunks(envelope());
    const text = JSON.stringify(value),
      transfer = requestHash(value);
    const forged = chunks.map((c) => ({
      ...c,
      transfer,
      length: text.length,
      count: Math.ceil(text.length / 12000),
      data: text.slice(c.index * 12000, (c.index + 1) * 12000),
    }));
    for (const c of forged.slice(0, -1)) assembly.accept(c);
    expect(() => assembly.accept(forged.at(-1))).toThrow("hash");
    const huge = envelope();
    huge.payload.body = "a".repeat(MAX_PREVIOUS_BYTES);
    expect(() => sharedChunks(huge)).toThrow();
    const unicode = envelope();
    unicode.payload.body = "é";
    expect(() => sharedChunks(unicode)).toThrow();
  });
});
