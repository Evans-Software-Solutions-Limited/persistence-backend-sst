# PER-129 · APP-C1 — coach forms (C10) and the Check-ins tab (C3.3)

Linear: [PER-129](https://linear.app/evans-software-solutions/issue/PER-129)
(parent PER-90). Backend design: "Backend design C — Forms, check-ins and
coach notifications" (D1–D3, D6). Canvas: https://claude.ai/artifact/VBc4WTCmYuT5uJ1V6GyqSM
boards **C10a–c, C10g–h, C10j, C3.3a–b** (K layout). Signed off 18 Nov.

Ships in the next **store release**, reviewed on staging. No native change,
no app version bump. Backend changes stay additive (1.2.0 phones keep working).

## Brad's calls (24 Nov, in session)

- Gaps in the API are closed **in this ticket**, not deferred:
  form stats (C10a/C10g counts), C10b question extras, and a per-client
  cadence change (C10j). Done in the backend commit on this branch.
- **iPhone gets the K-layout coach shell** as part of this ticket (Library
  tab, client tabs), not just the forms pages.

## Delivery

Two PRs on PER-129:

1. **Backend + web** — branch `bradleysimmsevans/per-129-app-c1-coach-web-iphone-forms`.
2. **iPhone** — branch `bradleysimmsevans/per-129-app-c1-iphone`, stacked on
   the backend commit of PR 1 (rebase on main after PR 1 merges).

## API (all under the coach's JWT; trainer role)

Existing (PER-116): see `microservices/core/src/application/coaching/forms/formsHandlers.ts`.

| Method and path                                                            | Use                                                                                                                                                                                                                                                                                       |
| -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /trainers/me/forms?include=templates&since=`                          | library: `{forms: FormDTO[], templates?, deletedIds?, asOf}`                                                                                                                                                                                                                              |
| `GET /trainers/me/forms/stats`                                             | **new.** `{forms: [{formId, reached, done, outstanding, clients: [{clientId, name, requestId, status: done\|pending\|missed, late, sentAt, dueAt, completedAt, remindersSent, lastReminderAt}]}], totals: {forms, repeating, outstanding, onTimeRate (0–1 or null), onTimeSample}, asOf}` |
| `POST /trainers/me/forms`                                                  | `{title, description?, questions}`; `Idempotency-Key`                                                                                                                                                                                                                                     |
| `GET /trainers/me/forms/:id`                                               | form + current version                                                                                                                                                                                                                                                                    |
| `PATCH /trainers/me/forms/:id`                                             | `{title?, description?, questions?, expectedRevision}` → 409 `revision_conflict` `{current}`                                                                                                                                                                                              |
| `DELETE /trainers/me/forms/:id`                                            | archive                                                                                                                                                                                                                                                                                   |
| `GET /trainers/me/form-schedules`                                          | `{schedules: ScheduleDTO[], asOf}`                                                                                                                                                                                                                                                        |
| `POST /trainers/me/form-schedules`                                         | `{formId, trigger, audience, clientIds?, weekday?, timeLocal?, dueAfterHours?, reminders?}`; `Idempotency-Key`                                                                                                                                                                            |
| `PATCH /trainers/me/form-schedules/:id`                                    | same fields + `status` + `expectedRevision` → 409 `revision_conflict` `{current}`                                                                                                                                                                                                         |
| `DELETE /trainers/me/form-schedules/:id`                                   | stop                                                                                                                                                                                                                                                                                      |
| `GET /trainers/me/clients/:clientId/forms`                                 | Check-ins "Sent to …": `[{form, rule, rules, lastDoneAt, lastSentAt, pendingRequestId, state: done\|notDoneYet\|paused}]`                                                                                                                                                                 |
| `PUT /trainers/me/clients/:clientId/forms/:formId/setup`                   | C10j: `{status: active\|paused\|excluded, override?: {trigger?: once\|weekly\|daily, weekday?, timeLocal?, dueAfterHours?, reminders?} \| null, scheduleId?}` (no revision; last write wins)                                                                                              |
| `GET /trainers/me/clients/:clientId/form-responses?formId=&cursor=&limit=` | history + compare (`ResponseDTO` with its own version's questions)                                                                                                                                                                                                                        |
| `POST /trainers/me/clients/:clientId/form-responses/:id/review`            | `{replyText?}` marks reviewed; idempotent                                                                                                                                                                                                                                                 |

**Questions** (`version.questions[]`): `{id, type, prompt, required, options?,
min?, max?, unit?, help?, detailsIfYes?, prefill?}`. Types: `short_text`,
`long_text`, `number`, `scale` (1–5), `single_choice`, `multiple_choice`
(2–12 options), `photo`, `yes_no`. `prefill` ∈ `sessions_done`,
`meal_plan_followed`, `steps`, `weight` (number questions) and
`progress_photos` (photo) — "Filled for them". A `detailsIfYes` answer may be
`{value: true, details}`. Max 40 questions, prompt ≤ 300, help ≤ 300.

**Rules**: weekday 1 = Mon … 7 = Sun; `timeLocal` "HH:MM" in the **athlete's**
zone; `dueAfterHours` and reminders `[{afterHours}]` (≤ 5, 1–720) count from
the send. The UI shows due/reminders as day + time ("Monday 12:00", "Sunday
18:00 if not done") for weekly/daily rules and converts to hours from the
send (e.g. Sun 09:00 send → Mon 12:00 due = 27 h). For join/once/end forms
(no send time) they're shown as "N hours/days after it's sent".

Answers display: `scale` "4 / 5", `number` value + unit, `yes_no` Yes/No
(+ details), choices joined, photo "Photo" (answering waits on PER-121).

## Screens

### Web (`packages/web/src/coach`, K layout from PER-124)

- Rail: **Library** becomes live (`/coach/library/forms`), with the Library
  sub-nav (Workouts, Programmes, Meal plans, Resources inert; Forms live).
- **C10a library**: header stats from `/forms/stats` totals; sections by
  trigger: Starter forms (on_join), Repeating (weekly/daily), Once, When
  coaching ends; forms with no rule in "Not sent yet"; **Templates** shows an
  empty state (none seeded). Selected form's panel: done/outstanding, Send
  to clients, Edit questions, Schedule (sent/due/reminders/who) with Change,
  Outstanding list (`stats.clients`).
- **C10b editor** (`/coach/library/forms/:id/edit`, `/new`): question list
  left, selected question right; all 8 types; help, required, details if yes,
  filled-for-them source; duplicate, delete, reorder; version banner; Save
  sends `expectedRevision`; 409 → "Edited on another device" with the server
  copy.
- **C10c send** (`/coach/library/forms/:id/send`): Who (select / all), When
  (join · once · weekly · daily · coaching ends), day, time, due, reminders,
  summary sentence, "Send to N clients". Editing an existing rule = PATCH
  with `expectedRevision`.
- **C3.3a Check-ins tab** (`/coach/clients/:id/check-ins`): Sent to {name}
  with last-done pills (green "Last done …" / amber "Not done yet" / Paused),
  - Add form (picks from library → send to this client); History; the
    selected form's latest response vs a "vs {date} ▾" dropdown of any earlier
    response; Review and reply; Mark reviewed. Weekly check-in (first weekly
    rule) selected by default. Tapping a "Sent to" form opens the **C10j side
    panel** (When incl. once/weekly/daily, day, time, due, reminders, Pause,
    Stop, Save).

### iPhone (`packages/mobile`)

- **K shell (coach mode)**: tabs Today · Clients · Library · Messages · You
  (canvas C2/C10g). Today = existing coach home; Library = segments Forms ·
  Workouts · Programmes · Meals · Resources (Programmes = existing programs
  screen; Forms live; others placeholder); Messages = "In development"
  placeholder (chat is PER-92). Client page gets the C3 tab strip; Overview =
  the existing client detail content; Check-ins live; other tabs placeholder
  unless an existing screen already covers them.
- **C10g** Library → Forms, **C10h** send sheet, **C10j** per-client setup,
  **C3.3b** Check-ins tab (latest first: New card with Review, History, Sent
  to {name}). Editor on iPhone uses the same fields as C10b.
- **Offline**: cache forms (with current version), schedules, stats and each
  client's form state + responses in SQLite; edits go through the offline
  queue with `expectedRevision`; a 409 shows "Edited on another device" and
  keeps the server copy. Review/reply marks are queued (idempotent).

## Differences from the canvas (known)

- "Opened, not sent" (C10a Outstanding) isn't tracked; rows show "Reminder
  sent {time}" or "Not done".
- "voice reply" in C3.3 History: no voice replies; text replies only.
- "Synced to Body" tag and filled-for-them values come from the athlete app
  (PER-130); the coach sees what was sent.
- Templates: empty state (none seeded, Brad 20 Nov).
