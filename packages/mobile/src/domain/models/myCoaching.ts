/**
 * The athlete's side of coaching relationships (PER-126, APP-A3; backend
 * design A, D3). Wire shapes mirror the merged BE-A1 routes 1:1:
 *
 *   GET /users/me/coaching      → MyCoaching (Coach tab chips, You → Coaching)
 *   GET /invites/:code/preview  → InvitePreview (C11j, before consent)
 *
 * camelCase on the wire, so the adapter passes payloads straight through.
 */

/** Feature switches the coach set for this relationship (C3.9). */
export type CoachFeatures = {
  nutrition: boolean;
  checkIns: boolean;
  photos: boolean;
  habits: boolean;
  messages: boolean;
  resources: boolean;
};

/** One active coach of the signed-in athlete. */
export type MyCoach = {
  relationshipId: string;
  trainerId: string;
  name: string;
  avatarUrl: string | null;
  /** When coaching started (ISO), or null when the server has no date. */
  since: string | null;
  features: CoachFeatures;
  due: { forms: number };
  newPlans: number;
  resources: number;
};

export type MyCoaching = {
  coaches: MyCoach[];
  /** Server time the list was read (ISO). */
  asOf: string;
};

export type SetupSection =
  | "starter_form"
  | "repeating_form"
  | "programme"
  | "nutrition_target"
  | "meal_plan"
  | "resource"
  | "welcome_message";

/** What a coach set up before the athlete accepts (design A, D4). */
export type AcceptPreview = {
  sections: { section: SetupSection; label: string; count: number }[];
  welcomeMessage?: string;
  programmes: { name: string; workouts: number }[];
  plans: { name: string }[];
  forms: { title: string }[];
};

export type InvitePreview = {
  /** `personal` codes are tied to a prepared profile and accept as active. */
  kind: "personal" | "general";
  coach: { name: string; avatarUrl: string | null };
  ready: AcceptPreview | null;
  /** When the code stops working (ISO). */
  expiresAt: string;
};

/**
 * One line listing what the coach has ready, in the canvas C11j style:
 * "Lean bulk programme · 2 forms · calorie target · 2 resources".
 * Empty when nothing is set up (the section is then hidden).
 */
export function readyLine(ready: AcceptPreview | null): string {
  if (!ready) return "";
  const parts: string[] = [];
  const plural = (n: number, one: string, many: string) =>
    n === 1 ? `1 ${one}` : `${n} ${many}`;
  for (const s of ready.sections) {
    switch (s.section) {
      case "programme":
        if (ready.programmes.length === 1) {
          parts.push(`${ready.programmes[0]!.name} programme`);
        } else {
          parts.push(plural(s.count, "programme", "programmes"));
        }
        break;
      case "starter_form":
        parts.push(plural(s.count, "form", "forms"));
        break;
      case "repeating_form":
        parts.push(plural(s.count, "check-in", "check-ins"));
        break;
      case "nutrition_target":
        parts.push("calorie target");
        break;
      case "meal_plan":
        parts.push(plural(s.count, "meal plan", "meal plans"));
        break;
      case "resource":
        parts.push(plural(s.count, "resource", "resources"));
        break;
      case "welcome_message":
        parts.push("welcome message");
        break;
    }
  }
  return parts.join(" · ");
}

/** "Ellie Hart" → "Ellie"; falls back to the whole name. */
export function firstName(name: string): string {
  const first = name.trim().split(/\s+/)[0];
  return first && first.length > 0 ? first : name;
}
