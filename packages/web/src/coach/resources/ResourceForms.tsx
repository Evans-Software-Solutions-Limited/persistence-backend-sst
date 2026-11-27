import { useState } from "react";
import { useForm } from "react-hook-form";
import { applyServerErrors } from "@/lib/form";
import {
  LINK_SERVER_FIELDS,
  RESOURCE_FILE_ACCEPT,
  RESOURCE_TITLE_MAX,
  RESOURCE_URL_MAX,
  UPLOAD_SERVER_FIELDS,
  linkResolver,
  resourceError,
  titleFromFileName,
  uploadResolver,
  type LinkFormValues,
  type UploadFormValues,
} from "../lib/resources";
import { Dialog, Notice } from "../ui/parts";

/**
 * Add link and Upload (C3.7 picker "Upload" / "Link", C5b "Add link" /
 * "Upload"). Both are react-hook-form with a TypeBox resolver; the server's
 * 422s land on the fields, anything else shows in the dialog's banner.
 * `onSave` throws on failure and resolves when saved.
 */

function FieldError({ id, message }: { id: string; message?: string }) {
  return message ? (
    <span className="err" id={id}>
      {message}
    </span>
  ) : null;
}

export function LinkDialog({
  onSave,
  onClose,
  hint,
}: {
  onSave: (values: LinkFormValues) => Promise<void>;
  onClose: () => void;
  hint?: string;
}) {
  const [error, setError] = useState<string | null>(null);
  const form = useForm<LinkFormValues>({
    resolver: linkResolver,
    defaultValues: { title: "", url: "" },
  });
  const { errors, isSubmitting } = form.formState;

  const submit = form.handleSubmit(async (values) => {
    setError(null);
    try {
      await onSave(values);
    } catch (e) {
      if (applyServerErrors(e, form.setError, LINK_SERVER_FIELDS)) return;
      setError(resourceError(e, null, "We couldn't add that link."));
    }
  });

  return (
    <Dialog title="Add a link" onClose={onClose}>
      <form
        noValidate
        onSubmit={(e) => void submit(e)}
        style={{ display: "grid", gap: 14, marginTop: 12 }}
      >
        {error && <Notice tone="error">{error}</Notice>}
        <div>
          <label className="fl" htmlFor="resource-link-title">
            Name
          </label>
          <input
            id="resource-link-title"
            className="fld"
            maxLength={RESOURCE_TITLE_MAX}
            aria-invalid={!!errors.title}
            aria-describedby={
              errors.title ? "resource-link-title-err" : undefined
            }
            {...form.register("title")}
          />
          <FieldError
            id="resource-link-title-err"
            message={errors.title?.message}
          />
        </div>
        <div>
          <label className="fl" htmlFor="resource-link-url">
            Link
          </label>
          <input
            id="resource-link-url"
            className="fld"
            type="url"
            inputMode="url"
            placeholder="https://"
            maxLength={RESOURCE_URL_MAX}
            aria-invalid={!!errors.url}
            aria-describedby={errors.url ? "resource-link-url-err" : undefined}
            {...form.register("url")}
          />
          <FieldError
            id="resource-link-url-err"
            message={errors.url?.message}
          />
        </div>
        {hint && <span className="hint">{hint}</span>}
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button type="button" className="btn sm ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn v sm" disabled={isSubmitting}>
            {isSubmitting ? "Adding…" : "Add link"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

export function UploadDialog({
  onSave,
  onClose,
  offline,
  hint,
}: {
  onSave: (values: UploadFormValues) => Promise<void>;
  onClose: () => void;
  offline: boolean;
  hint?: string;
}) {
  const [error, setError] = useState<string | null>(null);
  const form = useForm<UploadFormValues>({
    resolver: uploadResolver,
    defaultValues: { title: "", file: null },
  });
  const { errors, isSubmitting } = form.formState;

  const submit = form.handleSubmit(async (values) => {
    setError(null);
    try {
      await onSave(values);
    } catch (e) {
      if (applyServerErrors(e, form.setError, UPLOAD_SERVER_FIELDS)) return;
      setError(resourceError(e, null, "We couldn't upload that file."));
    }
  });

  return (
    <Dialog title="Upload a file" onClose={onClose}>
      <form
        noValidate
        onSubmit={(e) => void submit(e)}
        style={{ display: "grid", gap: 14, marginTop: 12 }}
      >
        {offline && (
          <Notice tone="info">
            Uploading needs a connection. You can upload once you're back
            online.
          </Notice>
        )}
        {error && <Notice tone="error">{error}</Notice>}
        <div>
          <label className="fl" htmlFor="resource-file">
            File
          </label>
          <input
            id="resource-file"
            className="fld"
            type="file"
            accept={RESOURCE_FILE_ACCEPT}
            style={{ paddingTop: 10 }}
            aria-invalid={!!errors.file}
            aria-describedby="resource-file-hint"
            onChange={(e) => {
              const file = e.target.files?.[0] ?? null;
              form.setValue("file", file, { shouldValidate: true });
              if (file && !form.getValues("title").trim()) {
                form.setValue("title", titleFromFileName(file.name));
              }
            }}
          />
          <span className="hint" id="resource-file-hint">
            PDF, JPEG or PNG, up to 25 MB.
          </span>
          <FieldError id="resource-file-err" message={errors.file?.message} />
        </div>
        <div>
          <label className="fl" htmlFor="resource-file-title">
            Name
          </label>
          <input
            id="resource-file-title"
            className="fld"
            maxLength={RESOURCE_TITLE_MAX}
            aria-invalid={!!errors.title}
            aria-describedby={
              errors.title ? "resource-file-title-err" : undefined
            }
            {...form.register("title")}
          />
          <FieldError
            id="resource-file-title-err"
            message={errors.title?.message}
          />
        </div>
        {hint && <span className="hint">{hint}</span>}
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button type="button" className="btn sm ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            className="btn v sm"
            disabled={isSubmitting || offline}
          >
            {isSubmitting ? "Uploading…" : "Upload"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
