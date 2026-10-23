/** Match the backend's scoped output identity without delimiter ambiguity. */
export function outputIdentity(instanceId: string | null, localId: string): string {
  return JSON.stringify([instanceId, localId]);
}
