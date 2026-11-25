/** Match the backend's scoped output identity without delimiter ambiguity. */
export function outputIdentity(instanceId: string | null, localId: string): string {
  return JSON.stringify([instanceId, localId]);
}

export function outputInstanceId(id: string): string | null {
  try {
    const decoded: unknown = JSON.parse(id);
    return Array.isArray(decoded) && decoded.length === 2 && typeof decoded[0] === "string"
      ? decoded[0]
      : null;
  } catch {
    return null;
  }
}
