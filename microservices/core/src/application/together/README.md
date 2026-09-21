# Together backend

The production backend implements D8/D9 behind `TOGETHER_ENABLED` (default off).
See `specs/milestones/TRAIN-TOGETHER/TRANSPORT-ADR.md` for the decision, provider
setup and rollback; `RECOVERY-PROOF.md` records tests and remaining release gates.

- `togetherRoutes.ts` / `togetherRepository.ts`: authenticated sessions,
  invitations/admission, independent editing, delegation, discovery and replay.
- `shared.ts`: ordered actor locks, active/paid access, atomic receipts and limits.
- `recording.ts`: frozen per-athlete finalization through the existing recording,
  PR, streak and volume services; durable retry after failure.
- `transport.ts`: content-free AWS WebSocket hints, one-use tickets and bounded
  outbox/finalizer recovery. SQS accelerates recovery; the cron sweep is a backstop.
- `featureRoutes.ts`: separately typed `TogetherApi`, mounted by the Hono parent
  alongside the existing core API. Disabled routes cannot affect solo routes.
- `templates*`, adjacent `social/` and `places/`: independent plan copies, shared
  privacy/safety primitives and Geoapify adapter.

`recoveryProof.ts` remains the original isolated contract projection. It is not
mounted or used as a production recorder. Its 17 tests prove durable local
transactions, receipt/outbox recovery and disk reopen using fixture history/effect
markers. The production integration tests additionally exercise the real recording
pipeline, migration and existing effective-entitlement rules.

Run repository tests with `bun run test:unit --concurrency=1` (not `bun test`).
For the isolated projection alone:

```sh
bun run --cwd microservices/core test:unit src/application/together/recoveryProof.test.ts --coverage.include='src/application/together/recoveryProof.ts'
```

PGlite serializes its connection. Local Promise interleavings are not evidence of
real multi-connection PostgreSQL contention, deployed AWS behavior, mobile SQLite
recovery or two-phone latency. Those gates remain explicit; no native build,
deploy, merge or provider activation is authorized by this backend work.
