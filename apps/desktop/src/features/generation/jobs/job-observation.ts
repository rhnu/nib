import type { FrozenSubmission, RequestSettlement } from "../../../bindings/generation";

const failureLabels: Record<string, string> = {
  stream: "流式响应中断或不完整",
  invalidRequest: "请求参数无效",
  preparation: "请求准备失败",
  api: "服务端拒绝请求",
  transport: "网络传输失败",
  encode: "内容编码失败",
  decode: "返回内容解码失败",
  metadata: "图片元信息处理失败",
};

export function settlementSummary(
  outcome: RequestSettlement | null,
  kind: FrozenSubmission["kind"],
) {
  if (!outcome) return "等待请求终态";
  if (outcome.kind === "cancelled") return "请求已取消";
  if (outcome.kind === "succeeded") {
    if (kind === "encodeVibe") return "编码请求成功";
    return outcome.imageCount ? `请求成功 · ${outcome.imageCount} 个图像产出` : "请求成功";
  }
  return `${failureLabels[outcome.failure] ?? "请求失败"}${outcome.httpStatus === null ? "" : ` · HTTP ${outcome.httpStatus}`}`;
}
