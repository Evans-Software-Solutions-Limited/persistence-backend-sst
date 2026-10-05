import type { TogetherWorkoutPort } from "./togetherWorkout.port";
import type { TogetherSharedPort } from "./togetherShared.port";
export type TogetherLobbyAudience = "invite-only" | "open";
export type TogetherTransport = "lan" | "nearby" | "hotspot-owner";
/** Reviewed lobby state only. No credentials, signing seeds or PREV grants reach UI. */
export interface TogetherLobbySnapshot {
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
  }[];
  error?: string;
  role?: "host" | "guest";
  invitation?: string;
  selection?: { hostUserId: string; workoutName: string };
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
  host(workoutName: string, audience?: TogetherLobbyAudience): Promise<void>;
  browse(): Promise<void>;
  selectDiscovered(sessionId: string): Promise<void>;
  selectInvite(text: string): Promise<void>;
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
