import { promises as dnsPromises } from "node:dns";
import type { LookupFunction } from "node:net";
import { Agent } from "undici";

/**
 * SSRF-hardened fetch for the user-supplied recipe-import URL. Implements every
 * guard in specs/13-nutrition-tracking/design.md § Recipe-import SSRF guards:
 * scheme allowlist, DNS + private-CIDR rejection (re-checked on every redirect
 * hop), a single wall-clock timeout across all hops, a 2 MiB streamed body cap,
 * and a Content-Type allowlist. Trust-boundary parity with the iOS receipt
 * handler — the URL is user-controlled input driving a network hop, so nothing
 * is assumed.
 *
 * DNS-rebinding (TOCTOU): the validate-then-fetch pattern alone lets a
 * malicious resolver return a public IP to the check and a private IP to the
 * connect. On the real network path we close that gap by PINNING the socket to
 * the already-validated address — an undici `Agent` whose `connect.lookup`
 * returns only that IP, so `fetch` can't re-resolve. Re-pinned on every hop.
 * (PR #124 review.)
 */

const ALLOWED_SCHEMES = new Set(["http:", "https:"]);
const ALLOWED_CONTENT_TYPES = ["text/html", "application/ld+json"];
const MAX_REDIRECTS = 3;
const MAX_BODY_BYTES = 2 * 1024 * 1024;
const TIMEOUT_MS = 10_000;

export class RecipeFetchError extends Error {
  public readonly reason: string;
  constructor(reason: string) {
    super(reason);
    this.reason = reason;
    this.name = "RecipeFetchError";
    Object.setPrototypeOf(this, RecipeFetchError.prototype);
  }
}

type LookupResult = { address: string; family: number };
type LookupFn = (hostname: string) => Promise<LookupResult[]>;

export type SafeFetchDeps = {
  fetcher?: typeof fetch;
  lookup?: LookupFn;
};

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const v = Number(p);
    if (v > 255) return null;
    n = n * 256 + v;
  }
  return n >>> 0;
}

function inCidr(ipInt: number, baseIp: string, bits: number): boolean {
  const base = ipv4ToInt(baseIp);
  if (base === null) return false;
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (ipInt & mask) === (base & mask);
}

// RFC1918 + loopback + link-local + reserved/special ranges (design § guard #2).
const PRIVATE_V4: Array<[string, number]> = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
];

export function isPrivateIpv4(ip: string): boolean {
  const n = ipv4ToInt(ip);
  if (n === null) return true; // unparseable → fail closed
  return PRIVATE_V4.some(([base, bits]) => inCidr(n, base, bits));
}

export function isPrivateIpv6(ip: string): boolean {
  const addr = ip.toLowerCase().trim();
  if (addr === "::1" || addr === "::") return true; // loopback / unspecified
  // IPv4-mapped (::ffff:a.b.c.d) — re-evaluate the embedded IPv4.
  const mapped = addr.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (mapped) return isPrivateIpv4(mapped[1]);
  const firstHextet = addr.split(":")[0];
  if (firstHextet === "") return true; // leading "::" form → treat as private
  const h = parseInt(firstHextet, 16);
  if (Number.isNaN(h)) return true; // unparseable → fail closed
  if (h >= 0xfe80 && h <= 0xfebf) return true; // fe80::/10 link-local
  if (h >= 0xfc00 && h <= 0xfdff) return true; // fc00::/7 ULA
  return false;
}

export function isPrivateIp(address: string, family: number): boolean {
  return family === 4 ? isPrivateIpv4(address) : isPrivateIpv6(address);
}

const defaultLookup: LookupFn = async (hostname) => {
  const res = await dnsPromises.lookup(hostname, { all: true });
  return res.map((r) => ({ address: r.address, family: r.family }));
};

async function assertHostnameIsPublic(
  hostname: string,
  lookup: LookupFn,
): Promise<LookupResult[]> {
  let addrs: LookupResult[];
  try {
    addrs = await lookup(hostname);
  } catch {
    throw new RecipeFetchError("dns_resolution_failed");
  }
  if (addrs.length === 0) throw new RecipeFetchError("dns_no_records");
  for (const { address, family } of addrs) {
    if (isPrivateIp(address, family)) {
      throw new RecipeFetchError("hostname_resolves_to_private_address");
    }
  }
  return addrs;
}

/**
 * A connector `lookup` that resolves EVERY hostname to the one validated IP —
 * so the socket connects to exactly the address the CIDR check approved,
 * defeating a rebind between the lookup and the connect. Exported for testing
 * the rebind-defeat invariant directly.
 */
export function makePinnedLookup(addr: LookupResult): LookupFunction {
  return (_hostname, options, callback) => {
    if (options && options.all) {
      callback(null, [{ address: addr.address, family: addr.family }]);
    } else {
      callback(null, addr.address, addr.family);
    }
  };
}

/** An undici Agent pinned to a single validated IP for the whole connection. */
function pinnedDispatcher(addr: LookupResult): Agent {
  return new Agent({ connect: { lookup: makePinnedLookup(addr) } });
}

async function readCapped(
  body: ReadableStream<Uint8Array> | null,
  max: number,
): Promise<string> {
  if (!body) return "";
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      total += value.byteLength;
      if (total > max) {
        await reader.cancel();
        throw new RecipeFetchError("body_too_large");
      }
      chunks.push(value);
    }
  }
  return Buffer.concat(chunks.map((c) => Buffer.from(c))).toString("utf8");
}

export async function safeRecipeFetch(
  rawUrl: string,
  deps: SafeFetchDeps = {},
): Promise<{ html: string; finalUrl: string }> {
  const fetcher = deps.fetcher ?? fetch;
  const lookup = deps.lookup ?? defaultLookup;
  // Pin the socket to the validated IP only on the real fetch path. An injected
  // fetcher (tests) drives resolution itself, so no dispatcher is built there.
  const pinSocket = !deps.fetcher;

  let currentUrl: URL;
  try {
    currentUrl = new URL(rawUrl);
  } catch {
    throw new RecipeFetchError("invalid_url");
  }
  if (!ALLOWED_SCHEMES.has(currentUrl.protocol)) {
    throw new RecipeFetchError("scheme_not_allowed");
  }

  // ONE budget for the whole path (fetch + all redirect hops + body read),
  // created OUTSIDE the loop — a per-hop timeout would let a slow-loris chain
  // hold the Lambda well past the 29s API Gateway ceiling.
  const deadline = AbortSignal.timeout(TIMEOUT_MS);

  let dispatcher: Agent | undefined;
  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const addrs = await assertHostnameIsPublic(currentUrl.hostname, lookup);

      // Re-pin to THIS hop's validated address so a redirect can't smuggle in a
      // host that re-resolves private (the per-hop check + the per-hop pin move
      // together).
      if (pinSocket) {
        await dispatcher?.close().catch(() => {});
        dispatcher = pinnedDispatcher(addrs[0]);
      }

      const init: RequestInit & { dispatcher?: Agent } = {
        redirect: "manual",
        signal: deadline,
        headers: { Accept: ALLOWED_CONTENT_TYPES.join(", ") },
      };
      if (dispatcher) init.dispatcher = dispatcher;

      let res: Response;
      try {
        res = await fetcher(currentUrl, init);
      } catch {
        throw new RecipeFetchError("fetch_failed");
      }

      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get("location");
        if (!loc) throw new RecipeFetchError("redirect_without_location");
        try {
          currentUrl = new URL(loc, currentUrl);
        } catch {
          throw new RecipeFetchError("invalid_redirect_url");
        }
        if (!ALLOWED_SCHEMES.has(currentUrl.protocol)) {
          throw new RecipeFetchError("scheme_not_allowed_after_redirect");
        }
        continue; // re-validate the new host on the next iteration
      }

      if (!res.ok) throw new RecipeFetchError(`upstream_status_${res.status}`);

      const ct = res.headers.get("content-type")?.split(";")[0].trim();
      if (!ct || !ALLOWED_CONTENT_TYPES.includes(ct)) {
        throw new RecipeFetchError("content_type_not_allowed");
      }

      const html = await readCapped(res.body, MAX_BODY_BYTES);
      return { html, finalUrl: currentUrl.toString() };
    }
    throw new RecipeFetchError("too_many_redirects");
  } finally {
    // Body is fully read into a string before we return, so closing here is safe.
    await dispatcher?.close().catch(() => {});
  }
}
