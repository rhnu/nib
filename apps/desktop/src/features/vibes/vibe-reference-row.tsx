import { useId, useState, type ReactNode } from "react";
import { Binary, ImagePlus, Info, RotateCcw } from "lucide-react";
import type {
  ModelCapabilities,
  VibeReferenceInput,
  VibeReferenceOverride,
} from "@/bindings/workbench";
import {
  Button,
  FormField,
  HelpMarker,
  IconButton,
  Modal,
  Notice,
  NumberSlider,
  Toggle,
} from "@/shared/ui";
import { AssetImage, useMediaAsset } from "@/features/media";
import { mediaApi } from "@/features/media/api";
import { useMediaQuery } from "@/features/media/use-media-query";
import { VibeMaterialDialog } from "./vibe-material-dialog";
import { VibeAssetDetails } from "./vibe-asset-details";
import { vibeMaterialName, type VibePatch } from "./model";
import { InlineVibeEncoding } from "./inline-vibe-encoding";

/** Each retained material keeps its editing controls and asynchronous encoding feedback together. */
export function VibeReferenceRow({
  value,
  index,
  capabilities,
  onChange,
  actions,
  override,
  onReset,
  issues = [],
}: {
  value: VibeReferenceInput;
  index: number;
  capabilities: ModelCapabilities | null;
  onChange: (patch: VibePatch) => void;
  actions?: ReactNode;
  override?: VibeReferenceOverride;
  onReset?: (field: keyof VibePatch) => void;
  issues?: { field: string; message: string }[];
}) {
  const media = useMediaAsset(value.input.assetId);
  const encodedId = value.input.kind === "encoded" ? value.input.assetId : null;
  const inspection = useMediaQuery(
    ["media", "vibe-inspection", encodedId],
    encodedId,
    mediaApi.inspectVibeAsset,
  );
  const original = useMediaAsset(inspection.value?.sourceImageAssetId ?? null);
  const preview = value.input.kind === "image" ? media.asset : original.asset;
  const [picking, setPicking] = useState(false);
  const [details, setDetails] = useState(false);
  const id = useId();
  const label = `氛围转移 ${index + 1}`;
  const reset = (field: keyof VibePatch) =>
    override?.[field] != null && onReset ? (
      <IconButton
        label={`撤销${label}${field === "strength" ? "强度" : field === "input" ? "材料" : "启用状态"}覆盖`}
        onClick={() => onReset(field)}
      >
        <RotateCcw size={13} />
      </IconButton>
    ) : undefined;
  const renderMaterial = (encodingAction?: ReactNode, encodingFeedback?: ReactNode) => (
    <>
      <div className="media-input-layout">
        <div className="media-input-preview" data-vibe-field="input">
          {preview?.kind === "image" ? (
            <AssetImage asset={preview} alt={label} className="vibe-thumbnail" />
          ) : (
            <Binary size={28} aria-label="编码材料" />
          )}
          <fieldset className="media-input-tools" aria-label={`${label}材料操作`}>
            <IconButton label={`替换${label}材料`} onClick={() => setPicking(true)}>
              <ImagePlus size={14} />
            </IconButton>
            {reset("input")}
            {encodingAction}
            <IconButton
              label={`查看${label}材料信息`}
              disabled={!media.asset}
              onClick={() => setDetails(true)}
            >
              <Info size={14} />
            </IconButton>
          </fieldset>
        </div>
        <div className="media-input-settings">
          <div data-vibe-field="strength">
            <FormField
              label="Strength"
              htmlFor={`${id}-strength`}
              help={
                <HelpMarker label="强度说明">
                  控制参考影响。滑块提供 0–1 常用区间，也可直接输入区间外的有符号数值。
                </HelpMarker>
              }
              actions={reset("strength")}
            >
              <NumberSlider
                id={`${id}-strength`}
                label={`${label}强度`}
                value={value.strength}
                invalid={issues.some((issue) => issue.field === "strength")}
                describedBy={issues.length ? id : undefined}
                onChange={(strength) => onChange({ strength })}
              />
            </FormField>
          </div>
          {value.input.kind === "image" && (
            <div data-vibe-field="informationExtracted">
              <FormField
                label="信息提取量"
                htmlFor={`${id}-information`}
                help={
                  <HelpMarker label="信息提取量说明">
                    控制编码时提取的信息量，范围为 0–1。改变提取量后需重新编码。
                  </HelpMarker>
                }
              >
                <NumberSlider
                  id={`${id}-information`}
                  label={`${label}信息提取量`}
                  value={value.input.informationExtracted}
                  range={
                    capabilities?.vibeReferenceOptions.informationExtracted ?? { min: 0, max: 1 }
                  }
                  invalid={issues.some((issue) => issue.field === "informationExtracted")}
                  describedBy={issues.length ? id : undefined}
                  onChange={(informationExtracted) => {
                    if (value.input.kind === "image")
                      onChange({ input: { ...value.input, informationExtracted } });
                  }}
                />
              </FormField>
            </div>
          )}
        </div>
      </div>
      {media.loading && <output className="vibe-status">正在读取材料…</output>}
      {media.asset && !media.asset.available && (
        <p className="vibe-message" role="alert">
          材料文件不可用
        </p>
      )}
      {media.error && (
        <Notice actions={<Button onClick={media.retry}>重试</Button>}>{media.error}</Notice>
      )}
      {encodingFeedback}
    </>
  );
  return (
    <article
      className="vibe-row media-input-container"
      data-vibe-id={value.id}
      data-disabled={!value.enabled || undefined}
    >
      <header data-vibe-field="enabled">
        <strong>{label}</strong>
        <span className="vibe-status">{value.input.kind === "encoded" ? "已编码" : "原图"}</span>
        <span className="spacer" />
        <Toggle
          label={`启用${label}`}
          checked={value.enabled}
          onChange={(enabled) => onChange({ enabled })}
        />
        {reset("enabled")}
        {actions}
      </header>
      {value.input.kind === "image" && capabilities?.encodeVibe ? (
        <InlineVibeEncoding value={value} capabilities={capabilities} onChange={onChange}>
          {renderMaterial}
        </InlineVibeEncoding>
      ) : (
        renderMaterial()
      )}
      {capabilities?.vibeInputPath &&
        ((value.input.kind === "image" && capabilities.vibeInputPath !== "image") ||
          (value.input.kind === "encoded" && capabilities.vibeInputPath === "image")) && (
          <p className="vibe-message">
            此材料类型不适用于当前模型，请选择
            {capabilities.vibeInputPath === "image" ? "原图" : "编码"}。
          </p>
        )}
      {issues.length > 0 && (
        <output id={id} className="vibe-message" role="alert">
          {issues.map((issue, index) => (
            <p key={index}>{issue.message}</p>
          ))}
        </output>
      )}
      <Modal open={details} onClose={() => setDetails(false)} title={`${label} · 材料信息`}>
        {details && (
          <div className="vibe-material-details">
            {media.asset && <p>{vibeMaterialName(media.asset)}</p>}
            {value.input.kind === "encoded" ? (
              <VibeAssetDetails id={value.input.assetId} />
            ) : (
              preview && <AssetImage asset={preview} alt={label} />
            )}
          </div>
        )}
      </Modal>
      <VibeMaterialDialog
        open={picking}
        onClose={() => setPicking(false)}
        capabilities={capabilities}
        onSelect={(values) => {
          if (values[0]) onChange({ input: values[0].input });
          setPicking(false);
        }}
        single
      />
    </article>
  );
}
