# Persistence Mobile V2, Offline-First Frontend Plan

## Decision Summary

The frontend should be treated as a rebuild, not an endless patch job.

We should use the existing `persistence-mobile` repo as the basis/reference for flows, business rules, and reusable ideas, but the new app should be structured as a cleaner V2 with these priorities:

1. offline-first behaviour
2. better performance
3. lower battery usage
4. clearer sync boundaries
5. smaller operational risk during future feature work

## Why This Changed

The previous frontend direction assumed we could incrementally replace Supabase calls with SST-backed calls while largely keeping the current frontend shape.

That is no longer enough.

The existing app has already shown signs of:

- poor local offline support
- sluggishness
- excessive battery use
- too much coupling between UI state, data fetching, and online assumptions

Those are architecture smells, not just polish issues.

## Goals

- open quickly
- remain usable with weak or intermittent connectivity
- avoid unnecessary background work
- minimise repeated network refetching
- make workout logging resilient offline
- support deterministic sync/replay
- reduce UI churn and unnecessary renders
- give the backend a clean SST API contract to serve

## Non-Goals

- a perfect greenfield rewrite that ignores what already exists
- preserving every old hook and state pattern
- background sync that behaves like a battery vampire
- building chat-style AI features into this app

## Product Shape

Persistence remains the app for clients and trainers.

AI should support the product where useful, like summaries or insights for PTs, but the companion/chat-based Gym Buddy concept should not drive the frontend architecture.

## Target Architecture

## 1. App Layers

### UI layer
- screens, components, navigation
- no direct persistence or sync logic in screen components

### Domain/application layer
- use cases for workouts, exercise browsing, progress, trainer actions, subscriptions
- transforms raw API/local records into app state

### Local data layer
- local database as the primary read source for most app views
- stores server snapshots, queued mutations, sync metadata, and lightweight derived state

### Sync layer
- manages pull, push, retry, conflict handling, reconciliation, and invalidation
- explicit policies per domain instead of one giant magical sync blob

### API layer
- talks only to SST endpoints
- no direct business-table querying from the mobile app for migrated domains

## 2. Offline-First Rules

### Read path
- screens should prefer local state first
- network refresh enhances local data, not replaces it
- cold boot should restore meaningful last-known state where safe

### Write path
- user actions create local optimistic updates when appropriate
- mutations are queued with retry metadata
- sync worker replays queued mutations when conditions allow
- server acknowledgements reconcile local state

### Conflict policy
Start simple and explicit:

- workout logging: client-generated events with server validation on replay
- profile/preferences: last-write-wins unless a field needs stronger semantics
- derived dashboard numbers: recomputed from authoritative synced data
- subscription/entitlement state: server authoritative, never guessed long-term offline

## 3. Performance and Battery Rules

### Hard rules

- no aggressive polling loops
- no broad refetch-on-focus for the whole app
- no redundant fetches caused by navigation churn
- no screens that depend on multiple serial network waterfalls before rendering useful UI
- no always-on background sync timers

### Preferred behaviour

- sync on app foreground with rate limiting
- sync after important writes
- sync on targeted manual refresh
- batch related writes where possible
- debounce expensive recomputations
- memoise selectors and keep component subscriptions narrow
- store denormalised local read models where they materially improve UX

## 4. Suggested Technical Shape

The exact package choices can be confirmed during implementation, but the architecture should support:

- React Native + Expo
- typed API client for SST endpoints
- local database for offline persistence
- mutation queue
- network state awareness
- explicit sync scheduler
- domain-level repositories or stores

A sensible default would be:

- local DB: SQLite-backed approach
- API state: thin network client, not a giant cache pretending to be offline storage
- background behaviour: event-driven and constrained

The important decision is architectural, not library-fashion.

## Domain Delivery Order

## Phase 0, Foundation

- app shell
- theme/design system baseline
- auth/session bootstrap
- local DB setup
- API client setup
- sync primitives
- logging/error boundary basics

## Phase 1, Core user flows

- dashboard
- workouts list
- active workout session
- set logging / rest timer / complete workout
- progress snapshots
- profile basics

Reason: these are the highest-value daily-use flows and the most sensitive to offline/perf issues.

## Phase 2, Exercise domain

- exercise browse
- exercise detail
- filters/search
- creator/editor if still needed in-app

Dependency: SST exercise endpoints and Algolia wrapper must be ready.

## Phase 3, Trainer and account flows

- clients screen
- invitations / relationship flows
- notification preferences
- subscriptions and entitlements

## Phase 4, Polish and resilience

- startup optimisation
- background sync tuning
- retry UX
- instrumentation
- crash/error cleanup
- accessibility and release QA

## Migration Strategy

## Option chosen
Build Mobile V2 deliberately while reusing the current mobile repo for reference, extracted logic, and selected UI patterns where they still earn their keep.

## Practical interpretation

- do not try to preserve every screen implementation
- do preserve good domain understanding and proven flows
- copy only what still fits the new architecture
- treat old query/mutation files as behaviour references, not as the target design

## Repo Strategy

Two reasonable implementation approaches:

### Approach A, V2 inside the existing mobile repo
Pros:
- easier comparison and incremental extraction
- keeps Git history close to the product
- simpler reuse of assets and existing flows

Cons:
- old and new architecture can get tangled if discipline slips

### Approach B, new app package/repo with selective imports from the old one
Pros:
- strongest separation
- forces cleaner architecture

Cons:
- more setup and more migration overhead

### Recommendation
Start with **Approach A only if the team is disciplined about isolation**.

That means a clear V2 app boundary, not half-rebuild / half-legacy spaghetti.
If that boundary cannot be maintained, switch to Approach B quickly.

## Backend Contract Implications

The mobile V2 plan assumes:

- SST is the canonical API boundary
- exercise search is served through an SST-owned wrapper
- auth/session checks are reliable and centralised
- endpoints support idempotent or safely replayable mutation behaviour where needed

## Release Criteria for Mobile V2

- app usable in poor connectivity for core flows
- workout logging survives temporary offline periods
- foreground sync is fast and bounded
- no obvious battery drain from background behaviour
- startup feels materially faster than the current app
- no core screen requires raw Supabase business-table access

## Implementation Principles

- local-first reads
- server-validated writes
- explicit sync semantics
- low-background-churn design
- measurable performance, not vibes

## Definition of Done

Mobile V2 is done when a core user can sign in, browse their essential data, run a workout flow, and recover cleanly from flaky connectivity without the app feeling slow, fragile, or battery-hungry.
