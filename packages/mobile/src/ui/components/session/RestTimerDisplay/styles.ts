import { color } from "@/ui/theme/tokens";

export const styles = {
  container: {
    position: "absolute" as const,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: color.$bg,
    justifyContent: "center" as const,
    alignItems: "center" as const,
    zIndex: 2000,
    elevation: 20,
  },
  content: {
    alignItems: "center" as const,
    width: "100%" as const,
    paddingHorizontal: 32,
  },
  timerContainer: {
    alignItems: "center" as const,
    marginBottom: 32 * 2,
  },
  timerText: {
    fontSize: 72,
    fontWeight: "700" as const,
    color: color.$primary,
    marginVertical: 24,
    fontVariant: ["tabular-nums" as const],
  },
  timerLabel: {
    fontSize: 16,
    fontWeight: "400" as const,
    lineHeight: 24,
    color: color.$text2,
    textTransform: "uppercase" as const,
    letterSpacing: 1,
  },
  buttonContainer: {
    width: "100%" as const,
    maxWidth: 300,
  },
  stopButton: {
    paddingVertical: 16,
    paddingHorizontal: 24,
    borderRadius: 12,
    backgroundColor: color.$surface2,
    borderWidth: 1,
    borderColor: color.$surface3,
    alignItems: "center" as const,
    justifyContent: "center" as const,
  },
  stopButtonText: {
    fontSize: 16,
    lineHeight: 24,
    color: color.$text,
    fontWeight: "600" as const,
  },
};
