import { initSentry, wrapLambda } from "./shared/sentry";
import { handleTogetherSocket } from "./application/together/transport";
initSentry();
export const handler = wrapLambda(handleTogetherSocket);
