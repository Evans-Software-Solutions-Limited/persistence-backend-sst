# Creative brief — founders' offer, Meta/Instagram test (Sep 2026)

For Brad to make the ads himself. This brief gives structure, constraints and the checks; it deliberately contains no ad copy, hooks or scripts. Format follows SoT § 14.2.

## Buyer and awareness

UK, 18–40, trains 2–4× a week, already tracks workouts somewhere they don't love. Problem-aware/solution-aware: they know logging matters, they've never heard of Persistence. Cold traffic — the ad has to earn the first two seconds, then explain why the offer exists.

## Trigger / problem

New programme, new gym, or the moment they can't remember what they lifted last week. The status-quo cost is friction (tracking is a chore) or price (a monthly app they don't get value from).

## Single claim (the only promise every asset makes)

Founders' rate: six months of Premium for £30 (the year for £60; Premium+ £50 / £100 — nearest Apple tiers, read the exact figure back from ASC). Renews at the standard price unless cancelled. Limited to the max redemptions you set in ASC — quote that number, never the founding pool cap. Lead with one price in an ad (six months of Premium); the others live on the landing page. These ads are Lane B only; they must not mention founding places, grants or contributions.

## Mechanism (why it exists — this is the interesting part for cold traffic)

One founder who lifts, launching with founders instead of investors. You turn 30 this month — use as the hook and the deadline, not the body (funding review § 3). Do not say the price "funds" anything specific: Apple takes the payment and the founding contributions are a separate, voluntary thing on `/founding`.

## Proof available (use only these)

- Screen recording of the real app: logging a session, the You/progress screens, streak and PRs deriving themselves
- You, on camera, as the maker

Not available, do not fabricate: testimonials, user counts, download figures, "trusted by", results or health outcomes.

## Three concepts to produce (one asset each for week 1)

| #   | Concept       | Angle                | What the viewer sees                                                        | Format                                   |
| --- | ------------- | -------------------- | --------------------------------------------------------------------------- | ---------------------------------------- |
| C1  | Founder story | Why the offer exists | You, talking to camera, then the app                                        | 20–30 s talking head, burned-in captions |
| C2  | Demonstration | Effort removed       | Hands + phone: a full session logged, timer visible, no cuts that hide time | 15 s screen recording + voiceover        |
| C3  | Situation     | Problem recognised   | A recognisable "bad tracking" moment, then the app                          | 3-frame static or carousel               |

Week 2: three opening variants of the winner (change the first 2 seconds only; body and CTA unchanged).

## Body structure (all concepts)

Callout (who this is for) → problem recognition → mechanism / demonstration → offer, stated exactly as the claim → one CTA.

## Format and placement specs

- Deliver every asset in 9:16 (Stories/Reels, full bleed, keep text out of the top ~14% and bottom ~20%) and 4:5 (Feed). Cut both from the same shoot.
- Sound-off legible: captions on all video. First frame must work as a still.
- ≤ 30 s. Text on image ≤ 20% of the frame.
- Filename convention: `founders_C1_founder-story_v1_9x16.mp4` etc., so the concept and version are readable in Ads Manager (SoT § 9.11).

## CTA and destination

- Button: "Learn more" (Meta's own label). On-asset CTA in your words, one only.
- Destination: `https://persistence.evans-software-solutions.com/meta?ref=<CODE>` — the landing page carries the store-offer CTA, the pixel and the channel tag. Never send an ad straight to apps.apple.com (no pixel, no `store_click`).
- The landing page and the ad must say the same offer in the same words (SoT § 8.5).

## Copy constraints

- Sentence case. No emojis, no hashtags, no exclamation marks. Confident and plain over polished.
- Say "renews at the standard price unless cancelled" wherever the price appears.
- No "limited time" unless tied to the real expiry set in ASC; no countdowns; no "only X left" unless it is the ASC max-redemptions figure.
- No health, weight, body-composition or performance-outcome claims. No before/after bodies.
- Do not mention founding places, grants, contributions, crowdfunding or the email route in Lane B assets — different rail, different page, and access on that rail is granted not sold.
- Persistence is the brand on screen; the Page name shown above the ad is `Persistence App: Coach & Train`.

## Prohibited (would fail Meta or Apple review, or the SoT integrity rules)

Fake urgency, invented numbers, testimonials of any kind, screenshots of other apps, music you don't have rights to, references to the App Store offer inside the mobile app itself.

## Learning question per concept

- C1: does the _reason_ for the price out-perform the product itself with cold traffic?
- C2: does seeing the speed of logging drive clicks without a story?
- C3: does problem recognition alone earn the click?

Judge on landing page views per £ first, then `store_click` on `meta` in `/admin/marketing`, then ASC redemptions.

## QA before upload (all yes)

- [ ] Buyer recognisable within 2 s
- [ ] Claim exactly matches `/meta` and the ASC configuration (read the ASC values back; don't quote from memory)
- [ ] Renewal sentence present
- [ ] Scarcity figure is the real ASC max-redemptions (not the founding pool)
- [ ] No founding-place, contribution or "funds the launch" language
- [ ] No health/outcome claims, no testimonials, no invented numbers
- [ ] Both aspect ratios exported; captions burned in
- [ ] Filenames follow the convention
- [ ] You'd be comfortable showing it to a customer, an Apple reviewer and yourself in three months
