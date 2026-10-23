import type { PreferencesWriter } from "./preferences-writer";

/** A settings write may invalidate the account context used by the visible quote. */
export async function prepareSubmissionPreferences(writer: PreferencesWriter) {
  const before = writer.getSavedSnapshot()?.execution;
  await writer.flush();
  const after = writer.getSavedSnapshot()?.execution;
  if (
    before?.imageRequestEncoding !== after?.imageRequestEncoding ||
    before?.serverImageCache !== after?.serverImageCache
  )
    throw new Error("执行设置已保存，请等待费用重新估算后提交。");
}
