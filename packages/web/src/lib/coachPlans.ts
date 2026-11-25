/**
 * Coach platform access links (PER-146). The web coach platform is only for
 * coaches with an active coach subscription; everyone else goes to the coach
 * plans page, which is the Pricing page with its Coaches tab open.
 */

/** The Pricing page with the Coaches tab selected. */
export const COACH_PLANS_PATH = "/pricing?for=coaches";

/**
 * Where `/coach` sends someone without coach access. `from=coach` makes the
 * Pricing page explain why they landed there.
 */
export const COACH_PLANS_REDIRECT = `${COACH_PLANS_PATH}&from=coach`;

/** The coach platform sign-in, linked from the marketing nav and footer. */
export const COACH_SIGN_IN_PATH = "/coach/login";
