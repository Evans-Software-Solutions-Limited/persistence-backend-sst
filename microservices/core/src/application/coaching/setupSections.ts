import { and, eq } from "drizzle-orm";
import {
  nutritionTargets,
  profiles,
  type CoachClientSetupItem,
} from "@persistence/db";
import type { DbOrTx } from "../repositories/personalRecordsRepository";
// PER-116 (BE-C1): the starter_form and repeating_form sections.
import {
  repeatingFormHandler,
  starterFormHandler,
} from "./forms/formSetupSections";
import { NutritionTargetRepository } from "../repositories/nutritionTargetRepository";
import { NotificationRepository } from "../repositories/notificationRepository";
import { NotificationDispatcher } from "../notifications/push/notificationDispatcher";
import {
  auditTrainerAction,
  type DbTransaction,
} from "../relationships/auditTrainerAction";
import { CLIENT_BRIEF_DEEP_LINK } from "../trainers/briefs/sendClientBrief";
import { mealPlanSetupHandler } from "../nutrition/mealPlans/mealPlanSetupHandler";
import { resourceSetupHandler } from "./resources/resourceSetupSection";

/**
 * Set-up sections for an invited client (PER-108, design A D1/D3/D4, canvas
 * C11l–r) and the hook each area uses to plug in.
 *
 * A section is AVAILABLE once it has a handler in `HANDLERS` below. Writing
 * items for any other section answers 422 `section_unavailable`, so set-up
 * sections switch on one by one as their build tickets ship:
 *
 *   programme        → BE-G1b (PER-112): program_assignments, schedule_mode 'sequence'
 *   meal_plan        → BE-D2  (PER-118): nutrition_plan_assignments
 *   starter_form     → BE-C1  (PER-116): coach_form_requests, trigger on_join
 *   repeating_form   → BE-C1  (PER-116): coach_form_schedules
 *   resource         → BE-I1  (PER-122): coach_resource_assignments
 *
 * To switch one on, add a `SetupSectionHandler` to `HANDLERS`. The accept
 * flow, preview, copy-from and section validation pick it up with no other
 * change.
 */

export const SETUP_SECTIONS = [
  "starter_form",
  "repeating_form",
  "programme",
  "nutrition_target",
  "meal_plan",
  "resource",
  "welcome_message",
] as const;
export type SetupSection = (typeof SETUP_SECTIONS)[number];

export const SECTION_LABELS: Record<SetupSection, string> = {
  starter_form: "Starter forms",
  repeating_form: "Check-ins",
  programme: "Programme",
  nutrition_target: "Calorie and macro target",
  meal_plan: "Meal plans",
  resource: "Resources",
  welcome_message: "Welcome message",
};

export function isSetupSection(value: string): value is SetupSection {
  return (SETUP_SECTIONS as readonly string[]).includes(value);
}

/** One set-up item as written by the coach. */
export interface SetupItemInput {
  refId?: string | null;
  config: Record<string, unknown>;
  sortOrder: number;
}

/** What the athlete (and the coach's preview) sees before accepting. */
export interface AcceptPreview {
  sections: { section: SetupSection; label: string; count: number }[];
  welcomeMessage?: string;
  programmes: { name: string; workouts: number }[];
  plans: { name: string }[];
  forms: { title: string }[];
}

export interface MaterialiseContext {
  tx: DbTransaction;
  trainerId: string;
  clientId: string;
  relationshipId: string;
}

export interface MaterialiseResult {
  /** The row created in the area's own table, recorded on the set-up item. */
  refId: string | null;
  /** Best-effort work to run once the accept has committed (pushes). */
  afterCommit?: () => Promise<void>;
}

export type ValidateResult =
  | { ok: true; item: SetupItemInput }
  | { ok: false; message: string };

export interface SetupSectionHandler {
  /** At most this many items in the section (undefined = no limit). */
  maxItems?: number;
  /**
   * Check and normalise one item. A `refId` must be the caller's own
   * programme, plan, form or resource; checking that is the handler's job.
   */
  validate(
    db: DbOrTx,
    trainerId: string,
    item: SetupItemInput,
  ): Promise<ValidateResult>;
  /**
   * Bring the item into the client's account on accept. Runs inside the
   * accept transaction, once per (relationship, set-up item).
   */
  materialise(
    ctx: MaterialiseContext,
    item: CoachClientSetupItem,
  ): Promise<MaterialiseResult>;
  /** Items to copy from one of the caller's active clients (copy-from). */
  copyFromClient?(
    db: DbOrTx,
    trainerId: string,
    clientId: string,
  ): Promise<SetupItemInput[]>;
  /** Lists the area adds to the accept preview (programmes, plans, forms). */
  preview?(
    db: DbOrTx,
    items: CoachClientSetupItem[],
  ): Promise<Partial<Pick<AcceptPreview, "programmes" | "plans" | "forms">>>;
}

// ─── nutrition_target ────────────────────────────────────────────────────────

const MACRO_KEYS = ["dailyKcal", "proteinG", "carbsG", "fatG"] as const;
const MAX_KCAL = 20_000;
const MAX_MACRO_G = 2_000;

function finiteNonNegative(value: unknown, max: number): number | null {
  return typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= max
    ? value
    : null;
}

const nutritionTargetHandler: SetupSectionHandler = {
  maxItems: 1,
  async validate(_db, _trainerId, item) {
    if (item.refId) {
      return { ok: false, message: "A nutrition target has no refId" };
    }
    const config: Record<string, unknown> = {};
    for (const key of MACRO_KEYS) {
      const value = finiteNonNegative(
        item.config[key],
        key === "dailyKcal" ? MAX_KCAL : MAX_MACRO_G,
      );
      if (value === null) {
        return { ok: false, message: `config.${key} must be a number ≥ 0` };
      }
      config[key] = value;
    }
    const water = item.config.waterCups ?? 8;
    if (
      !Number.isInteger(water) ||
      (water as number) < 0 ||
      (water as number) > 40
    ) {
      return { ok: false, message: "config.waterCups must be an integer 0–40" };
    }
    config.waterCups = water;
    if (item.config.preset !== undefined) {
      if (
        typeof item.config.preset !== "string" ||
        item.config.preset.length > 40
      ) {
        return { ok: false, message: "config.preset must be a short string" };
      }
      config.preset = item.config.preset;
    }
    return {
      ok: true,
      item: { refId: null, config, sortOrder: item.sortOrder },
    };
  },
  async materialise(ctx, item) {
    const c = item.config as Record<string, number | string>;
    const input = {
      dailyKcal: c.dailyKcal as number,
      proteinG: c.proteinG as number,
      carbsG: c.carbsG as number,
      fatG: c.fatG as number,
      waterCups: c.waterCups as number,
      preset: (c.preset as string | undefined) ?? undefined,
    };
    // One target per athlete; whoever set it last wins (Brad, 20 Nov), and
    // set_by_user_id drives "Set by Ellie".
    await new NutritionTargetRepository().upsertForClient(
      ctx.clientId,
      input,
      ctx.trainerId,
      ctx.tx,
    );
    await auditTrainerAction({
      trainerId: ctx.trainerId,
      clientId: ctx.clientId,
      actionType: "nutrition_target_set",
      targetTable: "nutrition_targets",
      targetRowId: ctx.clientId,
      payload: { ...input, source: "client_setup" },
      tx: ctx.tx,
    });
    return { refId: null };
  },
  async copyFromClient(db, trainerId, clientId) {
    // Only a target THIS coach set. Another coach's target is theirs.
    const rows = await db
      .select()
      .from(nutritionTargets)
      .where(
        and(
          eq(nutritionTargets.userId, clientId),
          eq(nutritionTargets.setByUserId, trainerId),
        ),
      )
      .limit(1);
    const row = rows[0];
    if (!row) return [];
    return [
      {
        refId: null,
        sortOrder: 0,
        config: {
          dailyKcal: Number(row.dailyKcal),
          proteinG: Number(row.proteinG),
          carbsG: Number(row.carbsG),
          fatG: Number(row.fatG),
          waterCups: row.waterCups,
          ...(row.preset ? { preset: row.preset } : {}),
        },
      },
    ];
  },
};

// ─── welcome_message ─────────────────────────────────────────────────────────

export const WELCOME_MESSAGE_MAX_LENGTH = 1000;

const welcomeMessageHandler: SetupSectionHandler = {
  maxItems: 1,
  async validate(_db, _trainerId, item) {
    if (item.refId) {
      return { ok: false, message: "A welcome message has no refId" };
    }
    const text =
      typeof item.config.text === "string" ? item.config.text.trim() : "";
    if (text.length === 0 || text.length > WELCOME_MESSAGE_MAX_LENGTH) {
      return {
        ok: false,
        message: `config.text must be 1–${WELCOME_MESSAGE_MAX_LENGTH} characters`,
      };
    }
    return {
      ok: true,
      item: { refId: null, config: { text }, sortOrder: item.sortOrder },
    };
  },
  async materialise(ctx, item) {
    // Until chat ships (design E, PER-120) the welcome message arrives as a
    // coach_brief notification. Design E will also post it as the first
    // message in the relationship's channel.
    const trainer = await ctx.tx
      .select({ fullName: profiles.fullName, role: profiles.role })
      .from(profiles)
      .where(eq(profiles.id, ctx.trainerId))
      .limit(1);
    const name = trainer[0]?.fullName;
    const title = !name
      ? "Welcome from your coach"
      : trainer[0]?.role === "physiotherapist"
        ? `Welcome from ${name}`
        : `Welcome from Coach ${name}`;

    const notification = await new NotificationRepository().create(
      ctx.clientId,
      {
        type: "coach_brief",
        title,
        message: String(item.config.text),
        data: { deepLink: CLIENT_BRIEF_DEEP_LINK, trainerId: ctx.trainerId },
      },
      ctx.tx,
    );
    await auditTrainerAction({
      trainerId: ctx.trainerId,
      clientId: ctx.clientId,
      actionType: "brief_sent",
      targetTable: "notifications",
      targetRowId: notification.id,
      payload: { message: item.config.text, source: "client_setup" },
      tx: ctx.tx,
    });
    return {
      refId: notification.id,
      afterCommit: () =>
        new NotificationDispatcher().dispatchExisting(
          ctx.clientId,
          notification,
        ),
    };
  },
};

/**
 * The live sections. ⚠ Add an area's handler here when its build ticket
 * ships — nothing else needs to change.
 */
const HANDLERS: Partial<Record<SetupSection, SetupSectionHandler>> = {
  // PER-116 (BE-C1): coach forms.
  starter_form: starterFormHandler,
  repeating_form: repeatingFormHandler,
  nutrition_target: nutritionTargetHandler,
  welcome_message: welcomeMessageHandler,
  meal_plan: mealPlanSetupHandler, // PER-118
  resource: resourceSetupHandler, // PER-122
};

/**
 * Plug a handler in at runtime. Returns a function that puts the previous
 * handler back. Areas normally add themselves to `HANDLERS`; this exists so the
 * accept flow's hook contract can be exercised end to end in tests.
 */
export function registerSetupSectionHandler(
  section: SetupSection,
  handler: SetupSectionHandler,
): () => void {
  const previous = HANDLERS[section];
  HANDLERS[section] = handler;
  return () => {
    if (previous) HANDLERS[section] = previous;
    else delete HANDLERS[section];
  };
}

export function sectionHandler(
  section: SetupSection,
): SetupSectionHandler | undefined {
  return HANDLERS[section];
}

export function availableSections(): SetupSection[] {
  return SETUP_SECTIONS.filter((s) => HANDLERS[s] !== undefined);
}

/**
 * One projection for both the coach's preview and the athlete's invite
 * preview, so the two can never disagree.
 */
export async function buildAcceptPreview(
  db: DbOrTx,
  items: CoachClientSetupItem[],
): Promise<AcceptPreview> {
  const preview: AcceptPreview = {
    sections: [],
    programmes: [],
    plans: [],
    forms: [],
  };
  for (const section of SETUP_SECTIONS) {
    const inSection = items.filter((i) => i.section === section);
    if (inSection.length === 0) continue;
    preview.sections.push({
      section,
      label: SECTION_LABELS[section],
      count: inSection.length,
    });
    if (section === "welcome_message") {
      preview.welcomeMessage = String(
        (inSection[0]!.config.text as string | undefined) ?? "",
      );
    }
    const extra = await HANDLERS[section]?.preview?.(db, inSection);
    if (extra?.programmes) preview.programmes.push(...extra.programmes);
    if (extra?.plans) preview.plans.push(...extra.plans);
    if (extra?.forms) preview.forms.push(...extra.forms);
  }
  return preview;
}
