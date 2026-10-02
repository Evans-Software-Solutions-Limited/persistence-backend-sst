/** Reviewed lobby state only. No credentials, signing seeds or PREV grants reach UI. */
export interface TogetherLobbySnapshot {
  phase:
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
  error?: string;
  role?: "host" | "guest";
  invitation?: string;
  selection?: { hostUserId: string; workoutName: string };
  members: readonly { userId: string; host: boolean }[];
  pending: readonly { peerId: string; userId: string }[];
}
export interface TogetherLobbyPort {
  getSnapshot(): TogetherLobbySnapshot;
  subscribe(listener: () => void): () => void;
  host(workoutName: string): Promise<void>;
  selectInvite(text: string): Promise<void>;
  /** Explicit user consent; selection alone never starts discovery or admission. */
  join(): Promise<void>;
  approve(peerId: string): Promise<void>;
  decline(peerId: string): Promise<void>;
  reconnect(): Promise<void>;
  cancel(): Promise<void>;
  invalidateAuthorization(code: string): void;
  setOnline(online: boolean): void;
  setActive(active: boolean): void;
  /** Provisioning account binding is owned by composition; this only invalidates the lobby. */
  setAccount(userId: string | null): void;
  dispose(): Promise<void>;
}
