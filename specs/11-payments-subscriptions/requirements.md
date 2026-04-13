# 11 — Payments & Subscriptions: Requirements

## Overview

Subscription management with Stripe. Three tiers: Free, Premium, Trainer. Subscription state controls feature access (paywalled features). Subscription state is **server-authoritative** — never guessed offline.

---

## User Stories

### STORY-001: As a user, I want to see available subscription tiers

**Acceptance Criteria:**

- [ ] Subscription selection screen showing: Free, Premium, Trainer tiers
- [ ] Each tier: name, price, feature list, limitations
- [ ] Current tier highlighted
- [ ] Upgrade/downgrade CTAs

### STORY-002: As a user, I want to subscribe to a paid tier

**Acceptance Criteria:**

- [ ] Select tier → opens Stripe checkout (in-app payment sheet)
- [ ] Supports Apple Pay (iOS) and Google Pay (Android)
- [ ] Supports credit/debit card
- [ ] Success → subscription activated immediately
- [ ] Failure → error message, return to selection

### STORY-003: As a user, I want to manage my subscription

**Acceptance Criteria:**

- [ ] View current plan, next billing date, payment method
- [ ] Cancel subscription (with confirmation, takes effect at period end)
- [ ] Reactivate cancelled subscription before period end
- [ ] View billing history

### STORY-004: As a user, I want features gated by my subscription tier

**Acceptance Criteria:**

- [ ] Free tier: basic workout tracking, limited exercise library
- [ ] Premium tier: full exercise library, progress analytics, health integration
- [ ] Trainer tier: all Premium features + client management
- [ ] Paywalled features show upgrade prompt, not hidden
- [ ] Subscription state checked from server (not cached long-term)

### STORY-005: As a user, I want subscription state to be reliable

**Acceptance Criteria:**

- [ ] Subscription status fetched from server on app launch
- [ ] Cached for session duration (not across restarts)
- [ ] Offline: use last-known state with warning if stale (>24h)
- [ ] Never grant premium features based on stale offline cache indefinitely
- [ ] Trial eligibility checked server-side
