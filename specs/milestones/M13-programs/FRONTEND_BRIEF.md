# M13 — Frontend brief (PRs F1 + F2)

> Execute `specs/19-programs/tasks.md` Phases 19.3–19.4 after B1+B2 are
> merged. Prototype wins on visuals; container/presenter split; reads =
> `useCachedResource`, writes = `enqueueMutation` commands
> (`create-workout.command.ts` is the canonical shape).

## PR F1 — coach surfaces (Phase 19.3)

- **API port + adapters + commands**: `listPrograms` / `getProgram` /
  `createProgram` / `updateProgram` / `deleteProgram` / `assignProgram` /
  `unassignProgram` / `assignWorkout`; commands with local-id reconciliation
  on programme create.
- **Programs tab** — replace the ComingSoon stub in
  `app/(app)/(tabs)/programs.tsx` with `ProgramsListContainer` →
  `ProgramsListPresenter` porting `coach.jsx ProgramsScreenV2` +
  `extra.jsx:290–328` card anatomy: large header ("Programmes", eyebrow
  `N ACTIVE · N DRAFTS`), search, ACTIVE/DRAFTS chips, cards (accent left
  border cycling primary/gold/success/ember by index, name, description
  line, `N WKS` or `ONGOING` pill, `N CLIENT(S)` pill, ACTIVE/DRAFT pill),
  dashed "+ New programme" CTA.
- **Editor** — `app/(app)/programs/create.tsx` + `[id].tsx` →
  `ProgramEditorContainer`/`Presenter`: name, description, duration segment
  (`Fixed weeks` numeric | `Ongoing`), days/wk stepper, ordered workout list
  (add via workout picker, remove, up/down reorder; duplicates allowed),
  "changes apply to future weeks" copy, assignments section in edit mode.
  Seed presenter state via **ref-guarded one-shot `useEffect`** keyed on the
  loading flag — never `useState(initializer)`. Gate: `mode !== 'coach'` →
  redirect to tabs index.
- **AssignProgramSheet** — root-mounted (`(app)/_layout`, sibling of Stack),
  zustand open-state store: client picker (active clients), start date
  (default today), "Show in training plan" + "Show in workouts library"
  toggles.
- **Client Detail** — `ProgrammeCard` port (`client-detail.jsx:564`): ACTIVE
  PROGRAMME eyebrow, name, `Week N / M` + segmented progress bar; indefinite
  → `Week N · Ongoing`, no bar. No live programme → "Assign programme" CTA.
  Plus minimal ad-hoc "Assign workout" sheet (workout picker + optional due
  date).
- ClientsList + Coach You need **no presenter changes** (programLabel /
  programme-ends / programStats arrive through existing fields).

## PR F2 — athlete surfaces (Phase 19.4)

- Dashboard model + adapter: `activeProgramme { name, week, totalWeeks,
endDate }`.
- Home "Your programme" card — ProgrammeCard visual with athlete accent,
  above the assigned section; hidden when null.
- Home assigned section → "Today's training": due-date-ordered occurrences,
  attribution badge preserved, presenter structure otherwise unchanged.
- Train tab: verify only (server-side filter/dedupe — no code change
  expected).

Mobile gate from repo ROOT: `node packages/mobile/node_modules/.bin/tsc
--noEmit -p packages/mobile/tsconfig.json`; `jest --projects packages/mobile`;
eslint FROM `packages/mobile` cwd; prettier from repo root.
