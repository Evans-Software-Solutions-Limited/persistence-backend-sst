import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Dialog } from "radix-ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import "./admin.css";
type Request = {
  message: string;
  initial?: string;
  kind: "prompt" | "confirm";
};
import {
  AdminDialogContext as Context,
  type AdminDialogs,
} from "./useAdminDialogs";

/** One modal at a time; every exit resolves the waiting action without mutating it. */
export function AdminDialogProvider({ children }: { children: ReactNode }) {
  const [request, setRequest] = useState<Request | null>(null);
  const [value, setValue] = useState("");
  const resolve = useRef<((value: string | null) => void) | null>(null);
  const origin = useRef<HTMLElement | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const finish = useCallback((value: string | null) => {
    const done = resolve.current;
    resolve.current = null;
    setRequest(null);
    done?.(value);
  }, []);
  const begin = useCallback(
    (next: Request) =>
      new Promise<string | null>((done) => {
        resolve.current?.(null);
        resolve.current = done;
        const active = document.activeElement;
        if (
          active instanceof HTMLElement &&
          !active.closest('[role="dialog"]')
        ) {
          origin.current = active;
        }
        setValue(next.initial ?? "");
        setRequest(next);
      }),
    [],
  );
  const dialogs = useMemo<AdminDialogs>(
    () => ({
      prompt: (message, initial) => begin({ kind: "prompt", message, initial }),
      confirm: async (message) =>
        (await begin({ kind: "confirm", message })) !== null,
    }),
    [begin],
  );
  useEffect(
    () => () => {
      resolve.current?.(null);
      resolve.current = null;
    },
    [],
  );
  return (
    <Context.Provider value={dialogs}>
      {children}
      <Dialog.Root open={request !== null} onOpenChange={() => finish(null)}>
        <Dialog.Portal>
          <Dialog.Overlay className="admin-dialog-overlay" />
          <Dialog.Content
            className="persistence-admin admin-dialog"
            onOpenAutoFocus={(e) => {
              if (request?.kind === "prompt") {
                e.preventDefault();
                input.current?.focus();
                input.current?.select();
              }
            }}
            onCloseAutoFocus={(e) => {
              e.preventDefault();
              origin.current?.focus();
            }}
          >
            <Dialog.Title className="admin-panel-title">
              {request?.kind === "confirm" ? "Confirm action" : "Admin action"}
            </Dialog.Title>
            <Dialog.Description className="admin-dialog-description">
              {request?.message}
            </Dialog.Description>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                finish(request?.kind === "confirm" ? "confirmed" : value);
              }}
            >
              {request?.kind === "prompt" ? (
                <Input
                  ref={input}
                  aria-label={request.message}
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                />
              ) : null}
              <div className="admin-actions mt-6">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => finish(null)}
                >
                  Cancel
                </Button>
                <Button type="submit">
                  {request?.kind === "confirm" ? "Confirm" : "Continue"}
                </Button>
              </div>
            </form>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </Context.Provider>
  );
}
