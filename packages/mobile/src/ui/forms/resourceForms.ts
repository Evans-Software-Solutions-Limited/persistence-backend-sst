import { Type } from "@sinclair/typebox";
import { schemaResolver, trimmed, type ServerFieldMap } from "@/shared/form";
import {
  RESOURCE_TITLE_MAX,
  RESOURCE_URL_MAX,
} from "@/domain/services/coachResources.service";

/**
 * PER-143 resources as react-hook-forms: the C3.7c "Link" sheet and the
 * name for a picked photo ("Upload"). Limits mirror the API (titles 1–120,
 * an https link up to 2,000). The server keeps the final say: its 422
 * `errors[].at` (`title`, `url`) land on these fields.
 */

export const TITLE_MESSAGE = `Add a name of up to ${RESOURCE_TITLE_MAX} characters.`;
export const URL_MESSAGE = "Enter a full link starting with https://";

export interface LinkResourceValues {
  title: string;
  url: string;
}

export const linkResourceSchema = Type.Object({
  title: Type.String({
    minLength: 1,
    maxLength: RESOURCE_TITLE_MAX,
    errorMessage: TITLE_MESSAGE,
  }),
  url: Type.String({
    pattern: String.raw`^[Hh][Tt][Tt][Pp][Ss]://[^\s/?#]+\S*$`,
    maxLength: RESOURCE_URL_MAX,
    errorMessage: URL_MESSAGE,
  }),
});

export const linkResourceResolver = schemaResolver<LinkResourceValues>(
  linkResourceSchema,
  { prepare: trimmed },
);

export const LINK_RESOURCE_SERVER_FIELDS: ServerFieldMap<LinkResourceValues> = {
  title: { field: "title", message: TITLE_MESSAGE },
  url: { field: "url", message: URL_MESSAGE },
};

export interface ResourceNameValues {
  title: string;
}

export const resourceNameSchema = Type.Object({
  title: Type.String({
    minLength: 1,
    maxLength: RESOURCE_TITLE_MAX,
    errorMessage: TITLE_MESSAGE,
  }),
});

export const resourceNameResolver = schemaResolver<ResourceNameValues>(
  resourceNameSchema,
  { prepare: trimmed },
);

export const RESOURCE_NAME_SERVER_FIELDS: ServerFieldMap<ResourceNameValues> = {
  title: { field: "title", message: TITLE_MESSAGE },
};
