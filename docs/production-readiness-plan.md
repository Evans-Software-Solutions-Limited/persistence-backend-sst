# Persistence Production Readiness Plan

## Purpose

This document defines what must be completed to make the Persistence app stack production-ready on the SST backend path.

It reflects two linked truths:

1. The backend migration from direct mobile → Supabase queries to mobile → SST API is still the right security and architecture move.
2. The mobile frontend should no longer be treated as a purely incremental migration project. A cleaner offline-first V2 frontend should be built in parallel against the SST API boundary.

## Current Known State

- The live product exists today on the Supabase-backed implementation.
- SST backend Phases 1 and 2 were previously completed and merged.
- A later hotfix resolved the route param conflict that caused staging 500s.
- Exercise / Algolia work was the next major backend step.
- The mobile migration branch covered the first batch of domains, but the longer-term frontend direction has since changed toward a cleaner rebuild.

## Production Outcome

Persistence is production-ready when:

- all user-critical mobile flows run against the SST API boundary
- the SST backend is secure, observable, and testable
- the mobile app is stable under real-world network conditions
- offline behaviour is intentional rather than accidental
- release, rollback, and support procedures exist

## Workstreams

## 1. Backend API Completion

### Goal

Complete the SST API surface needed by the rebuilt mobile app.

### Required domains

- auth/session validation layer
- profiles
- dashboard
- workouts
- workout sessions / sets / logging
- progress / measurements / records
- exercises search and detail
- trainer/client features
- notifications
- subscriptions / entitlements

### Immediate priority order

1. Exercise endpoints
2. Algolia-backed exercise search wrapper
3. Remaining core trainer/client endpoints
4. Notifications and subscriptions
5. Lower-priority admin or operational endpoints

### Rules

- Supabase remains the database
- Supabase Auth remains the auth provider for now
- SST is the API and policy boundary
- no direct mobile reads/writes against business tables once a domain is migrated

## 2. Security Hardening

### Goal

Make the SST layer the safe production boundary.

### Required items

- JWT validation for all protected routes
- role/ownership checks at handler/service level
- request validation on every endpoint
- rate limiting for sensitive endpoints
- audit logging for critical mutations
- secret management for all provider credentials
- removal of any remaining mobile dependency on privileged DB query logic

### Definition

Security is not done when endpoints merely work. It is done when the app no longer depends on exposed client-side query logic for protected business operations.

## 3. Data and Sync Integrity

### Goal

Ensure correctness under retries, reconnections, duplicate submissions, and partial failure.

### Required items

- idempotency strategy for mutation-heavy endpoints
- server-side validation for workout/session state transitions
- conflict-handling rules for offline mutation replay
- safe pagination and cursor patterns
- deterministic timestamp/update semantics

## 4. Observability and Operations

### Goal

Make production diagnosable.

### Required items

- structured logging
- request tracing / correlation ids
- error monitoring
- metrics for latency, error rate, and core route usage
- alerting for elevated 4xx/5xx on critical flows
- documented env/secrets checklist
- documented deploy and rollback procedure

## 5. Test and Quality Gates

### Goal

Replace hope with proof.

### Required items

- unit tests for service/repository logic
- integration tests for critical routes
- parity coverage for migrated Supabase behaviour
- contract tests for auth and permissions edge cases
- CI gates for lint, typecheck, tests, and formatting

### Critical user journeys to test end-to-end

- sign in / restore session
- fetch dashboard
- start workout
- log set / rest / complete workout
- update profile / goals / measurements
- browse and search exercises
- trainer/client interaction flows
- subscription state reads that affect paywalled UI

## 6. Mobile Release Readiness

### Goal

Ensure the frontend consuming the SST API is actually releasable.

### Required items

- stable API environment configuration
- crash-free startup / session restore
- sane loading/error states on poor network
- offline queue and reconciliation rules tested
- notification permissions and delivery verified
- analytics / support hooks in place
- release checklist for TestFlight / Play internal testing

## Recommended Delivery Sequence

### Phase A, Finish the backend boundary

- complete exercise endpoints
- complete Algolia wrapper
- close remaining high-value endpoints needed by the new frontend shell

### Phase B, Build the mobile V2 foundation

- app shell
- local persistence layer
- sync engine
- auth/session management
- shared API client

### Phase C, Move critical user flows first

- dashboard
- workouts
- active workout logging
- progress
- profile

### Phase D, Move secondary flows

- exercises browser and detail
- trainer features
- notifications
- subscriptions

### Phase E, Production hardening

- telemetry
- soak testing
- release candidate pass
- rollback rehearsal

## Production Checklist

- [ ] all critical mobile flows use SST APIs
- [ ] no critical path depends on direct client business-table querying
- [ ] auth and permissions tested for all protected routes
- [ ] exercise search works via SST wrapper
- [ ] offline mutation replay behaves predictably
- [ ] logs and error monitoring are live
- [ ] release checklist exists and has been executed
- [ ] staging sign-off completed
- [ ] production rollout plan and rollback plan documented

## Non-Goals

- rewriting the database layer away from Supabase right now
- introducing a second backend stack before SST is finished
- preserving old frontend structure just because it already exists

## Definition of Done

Persistence is ready for production on the new architecture when the rebuilt mobile app can serve core users through the SST boundary with strong security, predictable offline behaviour, observability, and release confidence.
