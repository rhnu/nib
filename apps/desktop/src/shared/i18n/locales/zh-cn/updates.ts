import type { en } from "../en";

export const updates = {
  title: "应用更新",
  current: "当前版本：{{version}}",
  check: "检查更新",
  checking: "正在检查更新…",
  latest: "当前已是最新版本。",
  available: "nib {{version}} 已发布",
  download: "下载并安装",
  downloading: "正在下载更新…",
  bytes_one: "已下载 {{count, number}} 字节",
  bytes_other: "已下载 {{count, number}} 字节",
  ready: "更新已下载并通过签名验证。请保存编辑，并在准备好后安装。",
  install: "安装并重启",
  installing: "正在保存编辑并准备更新…",
  later: "稍后",
  disabled: "自动更新适用于已安装的 Windows x64 正式版。",
  failed: "更新失败：{{detail}}",
  help: "启动时自动检查，确认后才开始下载和安装。安装前请先完成或取消生成任务和助手运行。",
} satisfies typeof en.updates;
