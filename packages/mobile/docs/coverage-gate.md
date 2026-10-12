# Mobile coverage gate

`bun run test:unit` enforces 90% statements, branches, functions and lines over
every file matched by `collectCoverageFrom` in `package.json`. Since 12 October
2026 that includes the whole adapters layer (`src/adapters/**`) except two files
that are explicitly excluded until their test campaigns land:

| File                                     | Lines | Coverage when excluded (S/B/F/L) | Why excluded                                                                                                                                  |
| ---------------------------------------- | ----- | -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/adapters/storage/sqlite.adapter.ts` | 3,962 | 3 / 2 / 3 / 3                    | The production SQLite cache has almost no direct tests; it needs a `node:sqlite`-backed suite like `togetherJournal.test.ts`, table by table. |
| `src/adapters/api/sst-api.adapter.ts`    | 3,263 | 62 / 66 / 46 / 62                | Half the endpoint methods are untested; needs fetch-mocked tests per route group alongside the existing `sst-api.*.test.ts` files.            |

Rules for these exclusions:

- They are temporary. Remove the `!` entry in the same PR that brings the file
  to 90% in every metric; do not add new exclusions.
- New adapter files are gated automatically. Write their tests with the file.
- Per-file numbers are checked in review, not only the global aggregate: a file
  that only passes because the aggregate absorbs it is not done.
