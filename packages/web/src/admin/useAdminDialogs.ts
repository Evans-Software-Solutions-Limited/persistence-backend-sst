import { createContext, useContext } from "react";
export type AdminDialogs = {
  prompt: (message: string, initial?: string) => Promise<string | null>;
  confirm: (message: string) => Promise<boolean>;
};
export const AdminDialogContext = createContext<AdminDialogs>({
  prompt: async () => null,
  confirm: async () => false,
});
export const useAdminDialogs = () => useContext(AdminDialogContext);
