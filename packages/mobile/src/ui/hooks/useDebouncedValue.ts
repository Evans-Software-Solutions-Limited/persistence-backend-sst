import { useEffect, useState } from "react";

/**
 * Returns a value that only updates after `delayMs` of stable input.
 *
 * Used by the exercise list search box to avoid re-filtering the cached
 * library on every keystroke. 300ms matches the behaviour described in
 * specs/03-exercise-library/tasks.md.
 */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const handle = setTimeout(() => {
      setDebounced(value);
    }, delayMs);
    return () => clearTimeout(handle);
  }, [value, delayMs]);

  return debounced;
}
