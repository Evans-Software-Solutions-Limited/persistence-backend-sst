import { useCallback, useEffect, useRef, useState } from "react";

/** How long the row 3 toast stays up (canvas: 3.5 s). */
export const TOGETHER_TOAST_MS = 3500;

/** One short-lived line; a newer message replaces the last and restarts the clock. */
export function useTogetherToast(): [string | null, (message: string) => void] {
  const [message, setMessage] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const show = useCallback((next: string) => {
    if (timer.current) clearTimeout(timer.current);
    setMessage(next);
    timer.current = setTimeout(() => {
      timer.current = null;
      setMessage(null);
    }, TOGETHER_TOAST_MS);
  }, []);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  return [message, show];
}
