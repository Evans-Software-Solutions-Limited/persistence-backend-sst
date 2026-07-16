import { color } from "@/ui/theme/tokens";

export const styles = {
  container: {
    marginBottom: 24,
  },
  limitCard: {
    backgroundColor: "rgba(255, 183, 77, 0.15)", // Low opacity warning background
    borderRadius: 12,
    padding: 24,
    flexDirection: "row" as const,
    alignItems: "flex-start" as const,
    gap: 16,
    borderWidth: 2,
    borderColor: color.$warning,
  },
  limitContent: {
    flex: 1,
  },
  limitTitle: {
    fontSize: 18,
    lineHeight: 24,
    color: color.$text,
    fontWeight: "700" as const,
    marginBottom: 4,
  },
  limitMessage: {
    fontSize: 14,
    fontWeight: "400" as const,
    lineHeight: 20,
    color: color.$text,
    marginBottom: 16,
  },
  upgradeButton: {
    backgroundColor: color.$warning,
    borderRadius: 4,
    paddingVertical: 8,
    paddingHorizontal: 16,
    alignSelf: "flex-start" as const,
  },
  upgradeButtonText: {
    fontSize: 14,
    lineHeight: 20,
    color: color.$text,
    fontWeight: "600" as const,
  },
};
