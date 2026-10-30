import type { positioning as source } from "../en/positioning";

export const positioning = {
  character: "角色",
  disabledSuffix: "（停用）",
  canvas: "角色定位画布",
  positionCharacters: "定位角色",
  canvasControls: "角色定位画布操作",
  canvasHelp:
    "点击或拖动标记会启用自定义定位。方向键移动，Shift 加大步幅；坐标和定位方式随当前创作保留。网格位置与范围来自模型。",
  backToImage: "返回图像",
  positioningUnsupported: "当前模型不支持角色定位；已有坐标保留。",
  loadingOptions: "正在读取定位选项…",
  retryRead: "重试读取",
  characterPositions: "角色位置，方向键移动所选角色",
  backgroundImage: "角色定位底图",
  positionCoordinates: "定位 {{value0}}, {{value1}}",
  selectCharacter: "选择{{value0}}",
  xCoordinate: " · X ",
  yCoordinate: " · Y",
} satisfies { [K in keyof typeof source]: string };
