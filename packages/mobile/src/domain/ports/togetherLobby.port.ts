import type { TogetherWorkoutPort } from "./togetherWorkout.port";
import type { TogetherSharedPort } from "./togetherShared.port";
export type TogetherLobbyAudience = "invite-only" | "friends" | "open";
/** Nearby is the user-facing local mode; LAN is its silent fallback on a phone without the Nearby module. */
export type TogetherTransport = "lan" | "nearby";
/** One line of the host's plan as shown before joining: "Barbell Back Squat · 4 × 6" (PER-60). */
export interface TogetherPlanRow {
  name: string;
  sets: number;
  reps: number | null;
}
/** What the host advertises about the workout besides its name (PER-60). */
export interface TogetherHostDetails {
  /** Epoch ms the workout started. */
  startedAt: number;
  plan: readonly TogetherPlanRow[];
}
/** Reviewed lobby state only. No credentials, signing seeds or PREV grants reach UI. */
export interface TogetherLobbySnapshot {
  /** Public session identity for account-bound explicit exit callbacks. */
  sessionId?: string;
  transport?: TogetherTransport;
  phase:
    | "browsing"
    | "disabled"
    | "idle"
    | "preparing"
    | "selected"
    | "hosting"
    | "searching"
    | "connecting"
    | "pending-approval"
    | "joined"
    | "reconnecting"
    | "unavailable"
    | "full";
  audience?: TogetherLobbyAudience;
  discovered?: readonly {
    sessionId: string;
    hostUserId: string;
    workoutName: string;
    memberCount: number;
    startedAt?: number;
    plan?: readonly TogetherPlanRow[];
    /** The host's six-character session code, when the host sent one. */
    code?: string;
  }[];
  /** True while the nearby radio is scanning; `browsing` with it false lists the last results (PER-60). */
  searching?: boolean;
  error?: string;
  role?: "host" | "guest";
  invitation?: string;
  /** The host's own six-character session code, shown under the QR (PER-60). */
  invitationCode?: string;
  selection?: {
    hostUserId: string;
    workoutName: string;
    startedAt?: number;
    plan?: readonly TogetherPlanRow[];
  };
  members: readonly { userId: string; host: boolean }[];
  pending: readonly { peerId: string; userId: string }[];
}
export interface TogetherLobbyPort {
  readonly transports?: readonly TogetherTransport[];
  selectTransport?(transport: TogetherTransport): void;
  readonly workout?: TogetherWorkoutPort;
  readonly shared?: TogetherSharedPort;
  getSnapshot(): TogetherLobbySnapshot;
  subscribe(listener: () => void): () => void;
  host(
    workoutName: string,
    audience?: TogetherLobbyAudience,
    details?: TogetherHostDetails,
  ): Promise<void>;
  browse(): Promise<void>;
  selectDiscovered(sessionId: string): Promise<void>;
  selectInvite(text: string): Promise<void>;
  /** A typed session code: selects the discovered session that advertised it, else "code-not-found". */
  selectCode?(code: string): Promise<void>;
  /** Explicit user consent; selection alone never starts discovery or admission. */
  join(): Promise<void>;
  approve(peerId: string): Promise<void>;
  decline(peerId: string): Promise<void>;
  removeParticipant?(userId: string): Promise<void>;
  reconnect(): Promise<void>;
  cancel(): Promise<void>;
  invalidateAuthorization(code: string): void;
  setOnline(online: boolean): void;
  setActive(active: boolean): void;
  /** Provisioning account binding is owned by composition; this only invalidates the lobby. */
  setAccount(userId: string | null): void;
  dispose(): Promise<void>;
}
