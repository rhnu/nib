import { useId, useState, type ReactNode } from "react";
import { ImagePlus, Info, RotateCcw } from "lucide-react";
import type {
  ModelCapabilities,
  PreciseReferenceInput,
  PreciseReferenceOverride,
} from "../../bindings/workbench";
import {
  Button,
  FormField,
  HelpMarker,
  IconButton,
  Modal,
  Notice,
  NumberSlider,
  Toggle,
} from "../../shared/ui";
import { AssetImage, ImagePickerDialog, useMediaAsset } from "../media";
import { imageName } from "../media/model";
import {
  preciseReferenceMessages,
  type PreciseReferenceField,
  type PreciseReferencePatch,
} from "./model";

const typeLabels: Record<string, string> = {
  character: "角色",
  style: "风格",
  "character&style": "角色与风格",
  costume: "服装",
  delta: "差异",
};

/** Drafts, resources and linked overrides use the same retained reference controls. */
export function PreciseReferenceRow({
  value,
  index,
  capabilities,
  onChange,
  actions,
  override,
  onReset,
  issues = [],
}: {
  value: PreciseReferenceInput;
  index: number;
  capabilities: ModelCapabilities | null;
  onChange: (patch: PreciseReferencePatch) => void;
  actions?: ReactNode;
  override?: PreciseReferenceOverride;
  onReset?: (field: PreciseReferenceField) => void;
  issues?: { field: string; message: string }[];
}) {
  const prefix = useId();
  const [picking, setPicking] = useState(false);
  const [details, setDetails] = useState(false);
  const media = useMediaAsset(value.assetId);
  const options = capabilities?.preciseReferenceOptions;
  const label = `精确参考 ${index + 1}`;
  const hasIssue = (field: string) => issues.some((issue) => issue.field === field);
  const messages = (field: string) =>
    hasIssue(field) ? (
      <output id={`${prefix}-${field}-issues`} className="precise-reference-message">
        {issues
          .filter((issue) => issue.field === field)
          .map((issue, index) => (
            <p key={index}>{issue.message}</p>
          ))}
      </output>
    ) : null;
  const reset = (field: PreciseReferenceField, name: string) =>
    override?.[field] != null && onReset ? (
      <IconButton label={`撤销${name}覆盖`} onClick={() => onReset(field)}>
        <RotateCcw size={13} />
      </IconButton>
    ) : undefined;
  const numeric = (
    field: "strength" | "fidelity" | "informationExtracted",
    name: string,
    help: string,
  ) => (
    <div className="precise-reference-field" data-reference-field={field}>
      <FormField
        label={name}
        htmlFor={`${prefix}-${field}`}
        help={<HelpMarker label={`${name}说明`}>{help}</HelpMarker>}
        actions={reset(field, name)}
        feedback={messages(field)}
      >
        <NumberSlider
          id={`${prefix}-${field}`}
          label={`${label}${name}`}
          value={value[field]}
          range={
            field === "informationExtracted"
              ? (options?.informationExtracted ?? { min: 0, max: 1 })
              : undefined
          }
          invalid={hasIssue(field)}
          describedBy={hasIssue(field) ? `${prefix}-${field}-issues` : undefined}
          onChange={(number) => onChange({ [field]: number })}
        />
      </FormField>
    </div>
  );
  const savedTypeUnsupported = !!options && !options.referenceTypes.includes(value.referenceType);
  return (
    <article
      className="precise-reference-row media-input-container"
      data-reference-id={value.id}
      data-disabled={!value.enabled || undefined}
    >
      <header>
        <strong>{label}</strong>
        {override && <span className="tag">覆盖</span>}
        <span className="spacer" />
        <Toggle
          label={`启用${label}`}
          checked={value.enabled}
          onChange={(enabled) => onChange({ enabled })}
        />
        {reset("enabled", "启用状态")}
        {actions}
      </header>
      {messages("enabled")}
      <div className="media-input-layout">
        <div className="media-input-preview" data-reference-field="assetId">
          {media.asset && <AssetImage asset={media.asset} alt={label} />}
          <fieldset className="media-input-tools" aria-label={`${label}图片操作`}>
            <IconButton
              label={`替换${label}图片`}
              aria-invalid={hasIssue("assetId") || undefined}
              onClick={() => setPicking(true)}
            >
              <ImagePlus size={14} />
            </IconButton>
            {reset("assetId", "图片")}
            <IconButton
              label={`查看${label}图片信息`}
              disabled={!media.asset}
              onClick={() => setDetails(true)}
            >
              <Info size={14} />
            </IconButton>
          </fieldset>
        </div>
        <div className="media-input-settings">
          <div data-reference-field="referenceType">
            <FormField
              label="用途"
              htmlFor={`${prefix}-type`}
              actions={reset("referenceType", "用途")}
              feedback={messages("referenceType")}
            >
              <select
                id={`${prefix}-type`}
                value={value.referenceType}
                aria-invalid={hasIssue("referenceType") || undefined}
                aria-describedby={
                  hasIssue("referenceType") ? `${prefix}-referenceType-issues` : undefined
                }
                onChange={(event) => onChange({ referenceType: event.currentTarget.value })}
              >
                {!options?.referenceTypes.includes(value.referenceType) && (
                  <option value={value.referenceType}>
                    {typeLabels[value.referenceType] ?? value.referenceType} · 已保存
                  </option>
                )}
                {options?.referenceTypes.map((type) => (
                  <option key={type} value={type}>
                    {typeLabels[type] ?? type}
                  </option>
                ))}
              </select>
            </FormField>
          </div>
          {numeric(
            "strength",
            "Strength",
            "控制参考图片对结果的影响。滑块提供 0–1 常用区间，也可直接输入区间外的有符号数值。",
          )}
          {numeric(
            "fidelity",
            "Fidelity",
            "控制参考约束的精确程度。滑块提供 0–1 常用区间，也可直接输入区间外的有符号数值。",
          )}
          {numeric(
            "informationExtracted",
            "信息提取量",
            "控制从参考图片中提取的信息量，范围为 0–1。",
          )}
        </div>
      </div>
      {media.loading && <output>正在读取图片…</output>}
      {media.error && (
        <Notice actions={<Button onClick={media.retry}>重试读取</Button>}>{media.error}</Notice>
      )}
      {messages("assetId")}
      {savedTypeUnsupported && (
        <p className="precise-reference-message">当前模型不支持已保存的用途。</p>
      )}
      <Modal open={details} onClose={() => setDetails(false)} title={`${label} · 图片信息`}>
        {media.asset && (
          <div className="precise-reference-details">
            <AssetImage asset={media.asset} alt={label} />
            <p>{imageName(media.asset)}</p>
            <p>
              {media.asset.width} × {media.asset.height} · {media.asset.mimeType}
            </p>
          </div>
        )}
      </Modal>
      <ImagePickerDialog
        open={picking}
        title="选择精确参考图片"
        onClose={() => setPicking(false)}
        onSelect={(asset) => onChange({ assetId: asset.id })}
      />
    </article>
  );
}

export function PreciseReferenceAvailability({
  capabilities,
}: {
  capabilities: ModelCapabilities | null;
}) {
  if (!capabilities) return <output className="precise-reference-status">正在读取参考能力…</output>;
  const messages = preciseReferenceMessages(capabilities);
  return (
    <>
      {messages.precise && <p className="precise-reference-message">{messages.precise}</p>}
      {messages.vibe && capabilities.vibeReference.reason !== "conflictWithPreciseReference" && (
        <p className="precise-reference-message">{messages.vibe}</p>
      )}
    </>
  );
}
