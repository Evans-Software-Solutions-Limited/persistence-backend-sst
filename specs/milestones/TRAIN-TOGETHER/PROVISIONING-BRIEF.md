# PER-64 — prepare the phone for offline Together

Base: latest main `29b7d659`, merged PR #480. Pull main before branching and
check for incoming changes again before opening this slice's PR.

## Behaviour

- Obtain trust keys only through the authenticated first-party API. Register a
  stable account/environment/device signing identity with the existing signed
  registration endpoint. Private seeds stay in SecureStore; never cache them
  with public credentials or expose bearer tokens to a peer.
- Validate the returned signature, exact account/device/public key and bounded
  validity before atomically making offline credentials available. Cache trusted
  keys and signed public evidence durably for process restart without internet.
- Refresh before expiry online. Offline reads require valid cached evidence and
  the existing signing key; expiry or missing keys stops sharing, not personal
  logging/recovery. Never silently rotate a known lost/revoked key.
- Fetch friendship evidence on demand for a selected participant, verify the
  exact pair/signature/expiry, and cache it per account/environment. Explicit
  authorization refusal invalidates affected cached authorization; a network
  interruption may retain still-valid evidence. Never turn a 401/403 into offline
  permission. Offline revocation delay remains bounded by issued credential TTL.
- Concurrent preparation shares one in-flight request. Account switch/logout
  cancels delivery of old results and prevents stale writes/repopulation. Retain
  signing identity needed for owner recovery and preserve existing journals.
- Supply this capability through existing app adapters/account lifecycle while
  Together stays disabled. No background enrolment, native build or UI redesign.

## Evidence and boundaries

Tests use actual signature verification and real SQLite reopen/rollback; transport
tests exercise authenticated API routing, idempotency, error classification and
account-change races. Cover expired/wrong-identity/tampered credentials, authority
rotation, missing key, friendship invalidation, failed writes and offline restart.

This slice does not implement Nearby radio, discovery-to-verified-host UX, full
workout/consent/recovery UI or native device proof. Preserve the sole reviewed
Claude design in FRONTEND_BRIEF.md. Brad owns native builds; Together stays off.
