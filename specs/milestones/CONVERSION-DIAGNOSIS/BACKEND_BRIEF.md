# Conversion diagnosis — backend agent

## Assignment and ownership

Implement spec 30 AC5.1–AC5.7 / D5.1–D5.5 / T5.1,T5.4,T5.6. Read the [overview](BRIEF.md) and parent triplet before edits. Own core admin marketing handler/repository, contract and backend tests. Coordinate shared contract changes with the web agent; do not edit mobile or campaign creative. Preserve other agents' changes.

## Steps

1. Inventory the existing admin marketing handler, analytics event definitions/emitters, checkout confirmation source and session-record flow. Record exact counting units, retained identifiers, date fields, deduplication, exclusion markers and attribution limits. Inspect accessible read-only evidence; do not assume deployed events because an emitter exists in source.
2. Implement D5.5's admin-only GET route using established Elysia guard/schema/repository patterns. Reuse plan/channel ownership validation. Keep reads bounded; no advertising provider requests or new data collection. If identifiers needed for a transition are not retained, return unavailable rather than reconstructing identity.
3. Preserve existing admin APIs. Build stages independently with coverage metadata and isolate source failures. Aggregate only existing lawful first-party data. External video/store numbers and manual totals retain their actual interval and source. No migration should be necessary for the initial existing-source report; justify any proposed persistence change before widening scope.
4. Add meaningful tests: auth and plan boundary; invalid/overlong intervals; zero versus absent; source failure; unsupported channel linkage; manual interval mismatch; repeats; late payments/offline sync; explicit test-account exclusions; purchase before workout; zero denominator; matched cohort only. Assert no account IDs or health details leak into report payload/logs.
5. Update T5.1/T5.4 only to the extent actually done and write a source inventory with remaining limitations. Use runtime checks for newly exposed API output and integration fixtures shared with web.

## Evidence and delivery

Run affected backend tests plus repository gates. Return changed files, acceptance mapping, real test output, source inventory, unresolved live access gaps and deployment notes. Real source audit may remain pending and must be labeled; it does not justify fictional measurements. Do not claim to know TikTok abandonment until linked evidence supports it. No paid campaigns, event expansion or native builds.
