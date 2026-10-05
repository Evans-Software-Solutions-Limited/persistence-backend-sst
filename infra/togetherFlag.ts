/** Release defaults on; explicit rollback values are normalized and typos fail deployment. */
export function togetherEnabledForDeployment(
  value: string | undefined,
): boolean {
  if (value === undefined) return true;
  switch (value.trim().toLowerCase()) {
    case "true":
    case "1":
    case "on":
      return true;
    case "false":
    case "0":
    case "off":
      return false;
    default:
      throw new Error("TOGETHER_ENABLED must be true/false, 1/0, or on/off");
  }
}
