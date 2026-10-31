import type { common as source } from "../en/common";

export const common = {
  undo: "撤销",
  redo: "重做",
  cut: "剪切",
  copy: "复制",
  copyValue: "复制数值",
  paste: "粘贴",
  selectAll: "全选",
  editFailed: "编辑失败：{{detail}}",
  copyImage: "复制图片",
  imageCopied: "图片已复制",
  imageCopyFailed: "图片复制失败：{{detail}}",
  imageActionFailed: "图片操作失败：{{detail}}",
  displayFailed: "{{label}}显示失败：{{detail}}",
  closeBlocked: "窗口未关闭，仍有内容或设置未保存：{{value0}}",
  help: "说明",
  closeHelp: "关闭说明",
  close: "关闭",
  sliderLabel: "{{value0}}滑块",
  retryDisplay: "重试显示",
  renderFailed: "{{value0}}渲染失败",
} satisfies { [K in keyof typeof source]: string };
