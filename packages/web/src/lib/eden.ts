import { treaty } from "@elysiajs/eden";
import { type CoreApi } from "@persistence/core";

export const api = {
  core: treaty<CoreApi>(import.meta.env.VITE_CORE_API_URL),
};
