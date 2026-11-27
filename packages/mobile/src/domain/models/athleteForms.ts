import type { FormTrigger, Question } from "./coachForms";

/**
 * PER-130 (APP-C2): the athlete's side of coach forms (backend design C, D3
 * "Athlete" and D6). Wire shapes mirror the merged BE-C1 routes:
 *
 *   GET  /users/me/form-requests                → AthleteFormRequests
 *   POST /users/me/form-requests/:id/response   → 201 response, or
 *        409 `request_closed` / 422 `invalid_answers` / 404
 *   POST /users/me/media/uploads                → FormAnswerUpload (BE-F1)
 *
 * camelCase on the wire, so the adapter passes payloads straight through.
 */

/** `AthleteRequestDTO`: one form to fill in, with its version's questions. */
export type AthleteFormRequest = {
  id: string;
  formId: string;
  title: string;
  description: string | null;
  coach: { id: string; name: string | null };
  trigger: FormTrigger;
  periodKey: string;
  sentAt: string;
  dueAt: string | null;
  /** A missed request can still be answered until this time (7 days). */
  closesAt: string | null;
  status: "pending" | "missed";
  /** True once it's missed: answering it now is late. */
  late: boolean;
  version: { id: string; version: number; questions: Question[] };
};

/** `GET /users/me/form-requests` (pending and missed, Coach-tab order). */
export type AthleteFormRequests = {
  requests: AthleteFormRequest[];
  asOf: string;
};

/** `POST /users/me/media/uploads` (purpose `form_answer`). */
export type FormAnswerUpload = {
  mediaId: string;
  status: "pending" | "ready";
  /** The presigned PUT; null once the file is there. */
  upload: {
    url: string;
    method: "PUT";
    headers: Record<string, string>;
    expiresAt: string;
  } | null;
};

/** A refused or accepted response submit: the raw status and body. */
export type FormResponseSubmit = { status: number; json: unknown };

/**
 * One answer as the fill-in screen holds it (react-hook-form values). The
 * API shape is made from it when the form is sent (`toApiAnswers`).
 *
 * - text questions and numbers: the typed text;
 * - scale: 1–5, or null;
 * - single choice: the option, or null; multiple choice: the options;
 * - yes/no: the answer and any details;
 * - photo: the picture on this phone and, once uploaded, its media id.
 */
export type AnswerValue =
  | string
  | number
  | null
  | string[]
  | { value: boolean | null; details: string }
  | { uri: string | null; mediaId: string | null };

export type PhotoAnswer = { uri: string | null; mediaId: string | null };
export type YesNoAnswer = { value: boolean | null; details: string };

/**
 * What this phone knows about one request beyond the server's list: the
 * draft ("Saved as you go"), and what happened when it was sent. Kept in
 * `form_request_local`, so it survives restarts and offline.
 */
export type LocalFormState = {
  requestId: string;
  /** Copied from the request, so a sent form still shows once the server
   * list no longer has it ("Done and missed"). */
  title: string;
  coachId: string;
  trigger: FormTrigger;
  /** Answers by question index (`q0`, `q1`…), as the form holds them. */
  answers: Record<string, AnswerValue>;
  /** The question last shown, so reopening carries on from there. */
  step: number;
  updatedAt: string;
  /** When Send was pressed; null while it's a draft. */
  submittedAt: string | null;
  /** When the server accepted it; null while it waits to send. */
  sentAt: string | null;
  /** 409 `request_closed` / 404: shown as "This check-in is no longer needed". */
  closed: boolean;
  /** The server refused the answers (422): the body, so the form can show it. */
  rejected: unknown;
  /** Idempotency keys for a form sent straight away (photo forms). */
  submitKey: string | null;
  uploadKeys: Record<string, string>;
  /** C10q "Later" (or starting one): the joining-forms page has been seen. */
  introSeen: boolean;
};

/** Exact copy for a 409 `request_closed` (PER-130 ticket, design C D6). */
export const NO_LONGER_NEEDED = "This check-in is no longer needed";

/**
 * C10q health-screening line. Brad and the team write it (PER-90, 18 Nov);
 * until then nothing is shown in its place.
 */
export const HEALTH_SCREENING_COPY: string | null = null;
