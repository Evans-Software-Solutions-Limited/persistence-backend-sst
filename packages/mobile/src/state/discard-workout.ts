import { create } from "zustand";

export type DiscardConfirmation = { ownerKey: string; onConfirm(): void };
/** Root-mounted confirmation; the initiating hook still owns identity checks. */
export const useDiscardConfirmation = create<{
  request: DiscardConfirmation | null;
  open(request: DiscardConfirmation): void;
  close(expected?: DiscardConfirmation): void;
}>((set) => ({
  request: null,
  open: (request) => set({ request }),
  close: (expected) =>
    set((state) =>
      !expected || state.request === expected ? { request: null } : state,
    ),
}));
