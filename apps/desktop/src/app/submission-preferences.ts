import type { PreferencesWriter } from "./preferences-writer";
import { sameExecutionPreferences } from "./execution-preferences";

/** A settings write may invalidate the account context used by the visible quote. */
export async function prepareSubmissionPreferences(writer: PreferencesWriter) {
  const before = writer.getSavedSnapshot()?.execution;
  await writer.flush();
  const after = writer.getSavedSnapshot()?.execution;
  if (!sameExecutionPreferences(before, after))
    throw new Error("执行设置已保存，请等待费用重新估算后提交。");
}
