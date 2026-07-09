import Elysia from "elysia";
// Coach client notes CRUD (10-trainer-features Phase 12) — POST / PUT / DELETE
// under /trainers/me/clients/:clientId/notes[/:noteId]. Grouped into their own
// sub-app so `trainersOnBehalfRoutes` adds ONE `.use()` rather than three: the
// Eden Treaty type in packages/web is already near TS's depth ceiling (adding a
// single individual root handler tripped TS2589 in the goal-types work), so
// every new cluster of routes goes in via a nested sub-app (mirrors goalsRoutes).
import { trainersMeCreateClientNoteHandler } from "./trainers/notes/trainersMeCreateClientNoteHandler";
import { trainersMeUpdateClientNoteHandler } from "./trainers/notes/trainersMeUpdateClientNoteHandler";
import { trainersMeDeleteClientNoteHandler } from "./trainers/notes/trainersMeDeleteClientNoteHandler";

export const trainersClientNotesRoutes = new Elysia()
  .use(trainersMeCreateClientNoteHandler)
  .use(trainersMeUpdateClientNoteHandler)
  .use(trainersMeDeleteClientNoteHandler);
