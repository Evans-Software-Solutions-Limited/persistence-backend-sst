import { treaty } from "@elysiajs/eden";
import { type CoreApi } from "@sst-monorepo-template/core";

export const api = {
  core: treaty<CoreApi>(import.meta.env.VITE_CORE_API_URL),
};
