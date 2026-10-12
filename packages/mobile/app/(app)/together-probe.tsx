/**
 * Hidden diagnostic route — Together crypto probe (PER-20 / D16). No navigation
 * entry; deep link only (`<scheme>://together-probe`). The container redirects
 * production builds to Home, so this screen never reaches product users.
 */
export { TogetherProbeContainer as default } from "@/ui/containers/TogetherProbeContainer";
