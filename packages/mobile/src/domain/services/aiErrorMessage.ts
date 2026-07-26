import type { ApiError } from "@/shared/errors";

/**
 * Copy for a failed AI estimation, chosen by what actually went wrong.
 *
 * ## Why this exists
 *
 * Both AI surfaces used to collapse every non-429 failure into one line:
 * "Couldn't estimate that — try rephrasing or use Quick Add instead." A 402
 * (not entitled), a 401 (session expired), a 422 (model refused), a 503
 * (provider unreachable), a 500 and an offline device all rendered identically.
 *
 * That is how the 2026-07-26 incident stayed unexplained for a day: Claude Haiku
 * 4.5 was ungranted in the production Bedrock account, so every request returned
 * 503 — and the app told the user to rephrase, which could never have worked. The
 * copy actively pointed away from the real problem.
 *
 * Two rules encoded here:
 *
 *   1. **"Try rephrasing" belongs to 422 alone.** That is the one status where
 *      the wording genuinely is the problem (the model refused or returned an
 *      unparseable shape). Saying it for a 503 blames the user for an outage.
 *   2. **Never advise "use Quick Add instead" from inside Quick Add.** Both AI
 *      entry points live in the Quick Add sheet, so that sentence told users to
 *      go where they already were. Point at *searching for the food* instead.
 */

/** Which surface the failure happened on — only used to name the input. */
export type AiEstimateSurface = "text" | "photo";

export function aiEstimateErrorMessage(
  error: Pick<ApiError, "code" | "status">,
  surface: AiEstimateSurface,
): string {
  // Offline / unreachable is checked FIRST and by `code`, not status: a request
  // that never left the device has no status at all, and "check your connection"
  // is the only useful thing to say.
  if (error.code === "network" || error.code === "timeout") {
    return "No connection — AI estimation needs to be online. Search for the food instead.";
  }

  switch (error.status) {
    case 401:
      return "Your session expired — sign in again to use AI estimation.";

    // Server-side entitlement gate. Reaching this means the client-side gate and
    // the server disagreed (the sheet is opened only when the gate allows), so
    // it is worth naming rather than hiding behind generic copy.
    case 402:
      return "AI estimation is a paid feature — upgrade to use it, or search for the food instead.";

    case 429:
      return "Daily AI limit reached — it resets tomorrow. Search for the food instead.";

    // The ONLY status where rephrasing / retaking is real advice.
    case 422:
      return surface === "text"
        ? 'Couldn\'t read that description — try naming the foods and portions, e.g. "2 fried eggs and a flat white".'
        : "Couldn't read that photo — try better lighting or a closer shot.";

    // 503 `ai_unavailable`: the provider was unreachable, refused us, or timed
    // out. Nothing the user can do to their input will change it.
    case 503:
      return "AI estimation is temporarily unavailable — try again shortly, or search for the food instead.";

    default:
      // Anything else (500, an unexpected status, no status) — do not speculate
      // about the cause, and do not imply the user's input was at fault.
      return "Something went wrong estimating that — try again shortly, or search for the food instead.";
  }
}
