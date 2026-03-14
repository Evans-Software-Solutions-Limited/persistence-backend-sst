# CLAUDE.md – Sessions Module

## What This Module Owns

User workout sessions: creation, listing, getting, updating, deletion. Each session represents a single workout instance (e.g., "Chest day on 2024-03-14").

Sessions contain:
- Sets (repetitions + weight for each exercise in the session)
- Exercises (exercise instances, can have multiple sets each)
- Metadata (status: in_progress, completed, cancelled; user notes; start/end time)

## What Not to Break

### User Data Isolation
- Every session belongs to exactly one user
- Sessions are filtered by `userId` from JWT token, not from request
- User A cannot view, edit, or delete User B's sessions
- Test: create session as User A, try to access/modify as User B → 404 or 403

### Session Status Transitions
- Valid statuses: `in_progress`, `completed`, `cancelled`
- Valid transitions:
  - `in_progress` → `completed` (finish session)
  - `in_progress` → `cancelled` (abort session)
  - `in_progress` → `in_progress` (update notes, add sets)
  - `completed` → `cancelled` (allow revert, but audit)
- Invalid transitions (e.g., `completed` → `in_progress`) should be rejected
- Status change must update `updatedAt` timestamp

### Sets & Exercise Data Consistency
- Each set belongs to a session (via `sessionId`)
- When deleting a session, all associated sets are cascade-deleted
- When updating session status to `completed`, all sets must be present (or flag for review)
- No orphaned sets (sets without a session)
- Test: delete session, verify sets are gone

### Workout Reference
- Session can reference a workout template (optional `workoutId`)
- If workout is deleted, sessions are NOT deleted (preserve historical data)
- Workout is for reference/template; session data is independent
- Changing workout after session created does not affect session

### Notes & Metadata
- User can add/update `userNotes` (free text, max 1000 chars)
- Metadata includes start/end time, duration calculation
- Prevent notes injection (validate length, sanitise if logging)

## Local Conventions

### Repository Pattern
- `SessionRepository` owns all session DB queries
- Methods: `create(userId, data)`, `get(userId, sessionId)`, `list(userId, filters)`, `update(userId, sessionId, data)`, `delete(userId, sessionId)`
- All methods take `userId` first parameter (implicit ownership check)
- Constructor injection of `db` client

### Type Safety
- Status: `type SessionStatus = "in_progress" | "completed" | "cancelled"`
- Session object includes timestamps (createdAt, updatedAt)
- Request body validation via `t.Object({...})`

### Error Handling
- Missing session → 404
- Unauthorized (wrong userId) → 404 (don't leak existence)
- Invalid status transition → 400 with message
- DB error → 500 with retry indication

## Common Mistakes

1. **Forgetting to filter by userId** → user sees another user's session
2. **Not cascade-deleting sets** → orphaned sets in DB
3. **Allowing invalid status transitions** → data inconsistency
4. **Storing user input (notes) without validation** → injection risk
5. **Not updating updatedAt on edits** → stale cache/sync issues
6. **Assuming workoutId uniqueness** → multiple sessions from same workout is valid
7. **Not testing concurrent updates** → race condition on status change

## Test Expectations

- **Unit tests:** Repository methods with mock DB, status validation
- **Integration tests:** Handler → repository → DB (or mock)
- **Scenarios:**
  - Create session for user A (userId from JWT)
  - Get session as user A → success
  - Try to get as user B → 404
  - Update status: in_progress → completed (success)
  - Update status: completed → in_progress (fail or audit, decide)
  - Add sets to in_progress session (success)
  - Add sets to completed session (fail or flag)
  - Delete session → sets cascade-deleted
  - List sessions with filters (status, date range)
  - Concurrent updates to same session

## Files to Know

| File | Purpose |
|------|---------|
| `create/sessionsCreateHandler.ts` | POST /sessions |
| `get/sessionsGetHandler.ts` | GET /sessions/:id |
| `list/sessionsListHandler.ts` | GET /sessions |
| `update/sessionsUpdateHandler.ts` | PATCH /sessions/:id |
| `delete/sessionsDeleteHandler.ts` | DELETE /sessions/:id |
| `exercises/create/sessionExercisesCreateHandler.ts` | POST /sessions/:id/exercises |
| `exercises/get/sessionExercisesGetHandler.ts` | GET /sessions/:id/exercises/:exerciseId |
| `exercises/delete/sessionExercisesDeleteHandler.ts` | DELETE /sessions/:id/exercises/:exerciseId |
| `sets/create/setsCreateHandler.ts` | POST /sessions/:sessionId/exercises/:exerciseId/sets |
| `sets/{get,update,delete}Handler.ts` | Set CRUD |
| `../repositories/sessionRepository.ts` | Data access layer |

## Session/Set/Exercise Hierarchy

```
Session (belongs to User)
  └─ Exercise (within Session)
      └─ Set (of Exercise)
          └─ reps, weight, duration, notes
```

When querying:
- Get all sets in a session: `sessionRepository.getSets(userId, sessionId)`
- Get all exercises in a session: `sessionRepository.getExercises(userId, sessionId)`
- Delete exercise: cascade-delete its sets
- Delete session: cascade-delete all exercises and sets
