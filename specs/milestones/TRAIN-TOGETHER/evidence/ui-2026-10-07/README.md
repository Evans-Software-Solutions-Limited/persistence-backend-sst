# Together completion follow-up — 7 October 2026

Browser screenshots use actual TogetherPreparingPresenter and SessionSummaryPresenter
with simulated state at 402 × 874. The preview substitutes the native bottom-sheet
chassis with a browser fixture; it does not prove native gestures, animation or
physical-device transport. No native/prebuild/EAS build was run.

- `preparing.png`: one preparing body; pinned Cancel stays accessible.
- `summary.png`: existing Workout Complete summary, one completed set / 200 kg.
  Monthly count is deliberately unknown while canonical server effects are pending.

The existing native rating presenter is reused unchanged. Container/SQLite tests
verify rating → own result confirmation → pointer cleanup → normal summary;
the rating screen was not visually verified in a native runtime in this pass.
