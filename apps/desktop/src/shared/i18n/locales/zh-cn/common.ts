import type { common as source } from "../en/common";

export const common = {
  displayFailed: "{{label}}显示失败：{{detail}}",
  closeBlocked: "窗口未关闭，仍有内容或设置未保存：{{value0}}",
  help: "说明",
  closeHelp: "关闭说明",
  close: "关闭",
  sliderLabel: "{{value0}}滑块",
  retryDisplay: "重试显示",
  renderFailed: "{{value0}}渲染失败",
} satisfies { [K in keyof typeof source]: string };
