import type { ExecutionPreferences } from "../bindings/settings";

/** Every SDK option participates in account and quote invalidation. */
export function sameExecutionPreferences(
  left: ExecutionPreferences | undefined,
  right: ExecutionPreferences | undefined,
) {
  return (
    left?.imageBaseUrl === right?.imageBaseUrl &&
    left?.imageRequestEncoding === right?.imageRequestEncoding &&
    left?.serverImageCache === right?.serverImageCache
  );
}
