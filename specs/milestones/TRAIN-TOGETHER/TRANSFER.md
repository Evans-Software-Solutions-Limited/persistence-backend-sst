# Bounded PREV transfer — approved 5 October 2026

PER-64 / PER-22, PR #486. Retain explicit cloud/local authority and recipient
consent. Cloud sessions use existing authenticated snapshot/PREV APIs. Local
sessions use cached owner history and authenticated direct transport; Internet
reachability never gates an authorized offline session.

PREV references the immutable plan already supplied by consent using its hash,
without duplicating that plan in each snapshot. Legacy plan-bearing snapshots
remain readable. The complete PREV envelope retains its author signature and
recipient-specific authenticated encryption, including grant and execution
versions. Maximum logical envelope: 2 MiB, covering the existing 100 exercises ×
100 sets contract. Other shared envelopes retain their 30,000-byte limit.

LocalLink carries larger PREV envelopes in ordered 12,000-character chunks inside
its existing authenticated encrypted connection, after admission. Each transfer
has an envelope hash, total length, index and count. One partial transfer per link,
a fixed 60-second deadline and strict shape/count/size bounds limit resource use.
No partial data reaches the application or durable journal. Reassembly verifies
the complete hash, original signature, session/identity, current grant and own
execution version before application. Relay hosts never decrypt recipient values.

Sends are serialized and paced, checking that the envelope is still current
before each chunk. Revocation, newer snapshots, roster removal or disconnect
prevent continuation; disconnect discards partial buffers. Reconnect replays the
current durable envelope from the beginning with fresh channel authentication;
transport completion never claims server save or completed workout history.

No new native permission or build is required by the JS transfer format itself.
Mixed older protocol peers fail closed; ship this slice in the same compatible
native release, before broad rollout. Tests must cover >30 KB real encrypted
round trips, reconnect/retry, incomplete/expired/reordered/tampered input,
revocation/supersession during transfer and maximum supported logical payload.

Peer departure invalidates only that peer's delivery receipts; host/own closure
clears all delivery state. Still-active peers retain acknowledged delivery status.
