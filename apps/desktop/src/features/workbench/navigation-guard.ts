/** Resolve pending input commits before deciding whether the current canvas may be left. */
export async function canLeaveWorkbench({
  readOnly,
  waitForInputs,
  confirmMask,
}: {
  readOnly: boolean;
  waitForInputs: () => Promise<void>;
  confirmMask: () => Promise<boolean>;
}) {
  if (readOnly) return false;
  await waitForInputs();
  return confirmMask();
}
