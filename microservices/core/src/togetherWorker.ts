import { initSentry, wrapLambda } from "./shared/sentry";
import { drainTogether } from "./application/together/transport";
initSentry();
export const handler = wrapLambda(async () => drainTogether());
