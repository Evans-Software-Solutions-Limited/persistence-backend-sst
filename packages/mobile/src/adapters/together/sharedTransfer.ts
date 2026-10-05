import { object, hash, integer } from "./security/schema";
import { requestHash } from "./security/identity";
import type { SharedEnvelope } from "./sharedSession";

export const MAX_SHARED_BYTES = 30000;
export const MAX_PREVIOUS_BYTES = 2 * 1024 * 1024;
export const SHARED_CHUNK_SIZE = 12000;
export const SHARED_TRANSFER_TIMEOUT = 60000;
const MAX_CHUNKS = Math.ceil(MAX_PREVIOUS_BYTES / SHARED_CHUNK_SIZE);
export interface SharedChunk {
  kind: "shared-chunk";
  transfer: string;
  length: number;
  count: number;
  index: number;
  data: string;
}
export function sharedLimit(envelope: SharedEnvelope): number {
  return envelope?.payload?.type === "previous"
    ? MAX_PREVIOUS_BYTES
    : MAX_SHARED_BYTES;
}
export function sharedChunks(envelope: SharedEnvelope): SharedChunk[] {
  const text = JSON.stringify(envelope);
  if (
    envelope.payload.type !== "previous" ||
    text.length > MAX_PREVIOUS_BYTES ||
    !/^[\x20-\x7e]+$/.test(text)
  )
    throw new Error("Invalid shared transfer");
  const count = Math.ceil(text.length / SHARED_CHUNK_SIZE);
  const transfer = requestHash(envelope);
  return Array.from({ length: count }, (_, index) => ({
    kind: "shared-chunk",
    transfer,
    length: text.length,
    count,
    index,
    data: text.slice(
      index * SHARED_CHUNK_SIZE,
      (index + 1) * SHARED_CHUNK_SIZE,
    ),
  }));
}

/** Only called after channel authentication and roster admission. Never persists partial data. */
export class SharedAssembly {
  private pending?: {
    transfer: string;
    length: number;
    count: number;
    parts: string[];
    deadline: number;
  };
  private timer?: ReturnType<typeof setTimeout>;
  constructor(private readonly now: () => number = Date.now) {}
  clear() {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
    this.pending = undefined;
  }
  accept(value: unknown): SharedEnvelope | undefined {
    if (
      !object(value, [
        "kind",
        "transfer",
        "length",
        "count",
        "index",
        "data",
      ]) ||
      value.kind !== "shared-chunk" ||
      !hash(value.transfer) ||
      !integer(value.length) ||
      value.length <= MAX_SHARED_BYTES ||
      value.length > MAX_PREVIOUS_BYTES ||
      !integer(value.count) ||
      value.count !== Math.ceil(value.length / SHARED_CHUNK_SIZE) ||
      value.count > MAX_CHUNKS ||
      !integer(value.index) ||
      value.index >= value.count ||
      typeof value.data !== "string" ||
      !/^[\x20-\x7e]+$/.test(value.data) ||
      value.data.length !==
        Math.min(
          SHARED_CHUNK_SIZE,
          value.length - value.index * SHARED_CHUNK_SIZE,
        )
    ) {
      this.clear();
      throw new Error("Invalid shared transfer");
    }
    if (this.pending && this.now() >= this.pending.deadline) this.clear();
    if (value.index === 0 && value.transfer !== this.pending?.transfer) {
      this.clear();
      this.pending = {
        transfer: value.transfer,
        length: value.length,
        count: value.count,
        parts: [],
        deadline: this.now() + SHARED_TRANSFER_TIMEOUT,
      };
      this.timer = setTimeout(() => this.clear(), SHARED_TRANSFER_TIMEOUT);
    }
    const p = this.pending;
    if (
      !p ||
      p.transfer !== value.transfer ||
      p.length !== value.length ||
      p.count !== value.count ||
      p.parts.length !== value.index
    ) {
      this.clear();
      throw new Error("Out-of-order shared transfer");
    }
    p.parts.push(value.data);
    if (p.parts.length < p.count) return undefined;
    this.clear();
    const envelope = JSON.parse(p.parts.join("")) as SharedEnvelope;
    if (
      envelope?.payload?.type !== "previous" ||
      requestHash(envelope) !== p.transfer
    )
      throw new Error("Invalid shared transfer hash");
    return envelope;
  }
}
