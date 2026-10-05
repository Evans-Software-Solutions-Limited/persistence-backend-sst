/** Test capability only. Release bundles cannot activate Together through a public env flag. */
export function togetherTestEnabled(
  development: boolean,
  requested: string | undefined,
): boolean {
  return development && requested === "true";
}
