import { useEffect, useState } from "react";

/** Delay expensive reads while keeping the editable value synchronous. */
export function useDebouncedValue<T>(value: T, delay: number) {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return settled;
}
