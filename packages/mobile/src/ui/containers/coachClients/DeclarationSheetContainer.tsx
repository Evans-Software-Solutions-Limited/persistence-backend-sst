import { useEffect } from "react";
import { useForm } from "react-hook-form";

import type { CoachClientApiError } from "@/domain/ports/api.port";
import {
  DECLARATION_SERVER_FIELDS,
  declarationResolver,
  type DeclarationValues,
} from "@/ui/forms/clientProfileForms";
import { messageAt } from "@/shared/form";
import { DeclarationSheetPresenter } from "@/ui/presenters/coachClients/DeclarationSheetPresenter";

/**
 * The coach declaration (D6b) as a react-hook-form: the tick must be on.
 * The server keeps the final say: a refusal lands on the tick's field
 * (a new statement version maps to its own message).
 */
export function DeclarationSheetContainer(p: {
  visible: boolean;
  busy: boolean;
  onConfirm: () => Promise<CoachClientApiError | null>;
  onClose: () => void;
}) {
  const form = useForm<DeclarationValues>({
    resolver: declarationResolver,
    defaultValues: { agreed: false },
  });
  const { visible } = p;
  useEffect(() => {
    if (visible) form.reset({ agreed: false });
  }, [visible, form]);

  const agreed = form.watch("agreed");
  const confirm = form.handleSubmit(async () => {
    const refused = await p.onConfirm();
    if (!refused) return;
    const mapped =
      refused.serverCode === "declaration_version_mismatch"
        ? DECLARATION_SERVER_FIELDS.statementVersion!.message!
        : refused.message || "Couldn't save the declaration. Try again.";
    form.setError("agreed", { type: "server", message: mapped });
  });

  return (
    <DeclarationSheetPresenter
      visible={p.visible}
      agreed={agreed}
      error={messageAt(form.formState.errors, "agreed") ?? null}
      busy={p.busy}
      onToggle={(on) =>
        form.setValue("agreed", on, {
          shouldDirty: true,
          shouldValidate: false,
        })
      }
      onConfirm={() => void confirm()}
      onClose={p.onClose}
    />
  );
}
