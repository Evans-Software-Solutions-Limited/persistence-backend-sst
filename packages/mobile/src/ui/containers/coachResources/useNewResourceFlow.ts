import { useCallback, useState } from "react";
import { useForm } from "react-hook-form";
import type { CoachResource } from "@/domain/models/coachResources";
import { defaultImageTitle } from "@/domain/services/coachResources.service";
import { applyServerErrors, applyValues, fieldMessages } from "@/shared/form";
import { readLocalFile } from "@/shared/utils/localFile";
import {
  LINK_RESOURCE_SERVER_FIELDS,
  RESOURCE_NAME_SERVER_FIELDS,
  linkResourceResolver,
  resourceNameResolver,
  type LinkResourceValues,
  type ResourceNameValues,
} from "@/ui/forms/resourceForms";
import type { useCoachResourceActions } from "@/ui/hooks/useCoachResources";
import {
  useResourceImagePicker,
  type PickedResourceImage,
} from "@/ui/hooks/useResourceImagePicker";

type Actions = Pick<
  ReturnType<typeof useCoachResourceActions>,
  "addLink" | "upload"
>;

/**
 * "Link" and "Upload" for the resources screens: the two react-hook-forms
 * (the link, and the picked photo's name), the photo picker, and the save.
 * A 422 lands on the fields; anything else shows in the sheet.
 */
export function useNewResourceFlow(opts: {
  online: boolean;
  actions: Actions;
  onCreated: (resource: CoachResource, queued: boolean) => void;
}) {
  const { online, actions, onCreated } = opts;
  const picker = useResourceImagePicker();
  const linkForm = useForm<LinkResourceValues>({
    resolver: linkResourceResolver,
    defaultValues: { title: "", url: "" },
  });
  const nameForm = useForm<ResourceNameValues>({
    resolver: resourceNameResolver,
    defaultValues: { title: "" },
  });
  const linkValues = linkForm.watch();
  const nameValues = nameForm.watch();
  const [sheet, setSheet] = useState<"link" | "name" | null>(null);
  const [picked, setPicked] = useState<PickedResourceImage | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const startLink = useCallback(() => {
    linkForm.reset({ title: "", url: "" });
    setError(null);
    setSheet("link");
  }, [linkForm]);

  const startUpload = useCallback(async () => {
    if (!online) return;
    const image = await picker.pick();
    if (!image) return;
    setPicked(image);
    nameForm.reset({ title: defaultImageTitle(image.fileName, new Date()) });
    setError(null);
    setSheet("name");
  }, [online, picker, nameForm]);

  const close = useCallback(() => {
    setSheet(null);
    setError(null);
  }, []);

  const saveLink = linkForm.handleSubmit(async (values) => {
    setBusy(true);
    setError(null);
    try {
      const result = await actions.addLink(values);
      if (result.ok) {
        setSheet(null);
        onCreated(result.resource, result.queued);
        return;
      }
      if (
        applyServerErrors(
          result.error,
          linkForm.setError,
          LINK_RESOURCE_SERVER_FIELDS,
        )
      ) {
        return;
      }
      setError(result.error.message || "We couldn't add that link.");
    } finally {
      setBusy(false);
    }
  });

  const saveName = nameForm.handleSubmit(async ({ title }) => {
    if (!picked) return;
    setBusy(true);
    setError(null);
    try {
      const result = await actions.upload({
        title,
        contentType: picked.contentType,
        read: () => readLocalFile(picked.uri),
      });
      if (result.ok) {
        setSheet(null);
        setPicked(null);
        onCreated(result.resource, false);
        return;
      }
      if (
        applyServerErrors(
          result.error,
          nameForm.setError,
          RESOURCE_NAME_SERVER_FIELDS,
        )
      ) {
        return;
      }
      const e = result.error;
      setError(
        "code" in e && (e.code === "network" || e.code === "timeout")
          ? "Uploading needs a connection. Try again when you're back online."
          : e.message || "We couldn't upload that photo.",
      );
    } finally {
      setBusy(false);
    }
  });

  return {
    sheet,
    busy,
    startLink,
    startUpload,
    linkSheet: {
      visible: sheet === "link",
      onClose: close,
      values: linkValues,
      errors: fieldMessages(linkForm.formState.errors, ["title", "url"]),
      onChange: (v: LinkResourceValues) => applyValues(linkForm, v),
      onSave: () => void saveLink(),
      busy,
      offline: !online,
      error,
    },
    nameSheet: {
      visible: sheet === "name",
      onClose: close,
      values: nameValues,
      errors: fieldMessages(nameForm.formState.errors, ["title"]),
      onChange: (v: ResourceNameValues) => applyValues(nameForm, v),
      onSave: () => void saveName(),
      busy,
      error,
    },
  };
}
