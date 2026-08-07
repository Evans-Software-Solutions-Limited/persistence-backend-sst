# Tech Steering

## Stack direction

Use the SST monorepo template as the starting point.

## Repo shape

- `core/` for domain models, zod schemas, shared prompt contracts, and recommendation types
- `functions/` for API routes, async jobs, reminders, summaries, and analysis orchestration
- `scripts/` for support/admin tasks
- `infra/` for queues, storage, cron, API, auth, and secrets

## AI boundaries

- keep prompts and output schemas versioned
- prefer structured outputs for analysis and recommendation objects
- separate user-facing wording from internal analysis objects
- add explicit uncertainty/confidence handling

## Media/data handling

- photos in object storage
- metadata and analysis records in database
- clear deletion path
- consent tracked explicitly

## Safety

- system design should reinforce wellness boundaries
- symptom/injury prompts need safer handling paths
- avoid hidden medical inference logic
