import { create } from "zustand";

/**
 * useSendBriefSheet — the coach "Send brief" composer sheet (M17). Opened
 * from Client Detail's Quick Actions: the coach types a short free-text
 * brief; the client receives a `coach_brief` notification (+ push) that
 * deep-links their Training page.
 *
 * `POST /trainers/me/clients/:clientId/brief` — ONLINE-ONLY direct adapter
 * call (never the sync queue), matching the other coach writes. Root-mounted
 * (feedback_sheets_mount_at_root).
 */
export interface SendBriefSheetState {
  open: boolean;
  clientId: string | null;
  /** Client display name for the sheet copy; null falls back to generic. */
  clientName: string | null;
  openSheet: (clientId: string, clientName?: string) => void;
  closeSheet: () => void;
}

export const useSendBriefSheet = create<SendBriefSheetState>((set) => ({
  open: false,
  clientId: null,
  clientName: null,
  openSheet: (clientId, clientName) =>
    set({ open: true, clientId, clientName: clientName ?? null }),
  closeSheet: () => set({ open: false, clientId: null, clientName: null }),
}));
