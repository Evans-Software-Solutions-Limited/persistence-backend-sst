/**
 * Hidden diagnostic route — the API request log. No navigation entry; deep
 * link only (`<scheme>://request-log`). The container redirects production
 * builds to Home, so this screen never reaches product users.
 */
export { RequestLogContainer as default } from "@/ui/containers/RequestLogContainer";
