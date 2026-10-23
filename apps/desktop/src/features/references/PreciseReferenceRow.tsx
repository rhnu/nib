import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { RotateCcw } from "lucide-react";
import type {
  ModelCapabilities,
  NumericRange,
  PreciseReferenceInput,
  PreciseReferenceOverride,
} from "../../bindings/workbench";
import { Button, HelpMarker, IconButton, Notice, Toggle } from "../../shared/ui";
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

/** Keep incomplete numeric typing local while the parent retains the last complete value. */
function ReferenceNumber({
  id,
  value,
  range,
  onChange,
  invalid,
  describedBy,
}: {
  id: string;
  value: number;
  range: NumericRange | null | undefined;
  onChange: (value: number) => void;
  invalid?: boolean;
  describedBy?: string;
}) {
  const [editing, setEditing] = useState<{ source: number; text: string } | null>(null);
  return (
    <input
      id={id}
      type="number"
      step="any"
      min={range?.min}
      max={range?.max}
      aria-invalid={invalid || undefined}
      aria-describedby={describedBy}
      value={editing?.source === value ? editing.text : value}
      onChange={(event) => {
        const number = event.currentTarget.valueAsNumber;
        const complete = Number.isFinite(number);
        setEditing({ source: complete ? number : value, text: event.currentTarget.value });
        if (complete) onChange(number);
      }}
      onBlur={() => setEditing(null)}
      onWheel={(event) => event.currentTarget.blur()}
    />
  );
}

/** One retained reference has the same fields in drafts, resources and linked overrides. */
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
  const media = useMediaAsset(value.assetId);
  const advanced = useRef<HTMLDetailsElement>(null);
  const issueSignature = JSON.stringify(issues);
  const advancedIssue = issues.some(
    (issue) => issue.field === "fidelity" || issue.field === "informationExtracted",
  );
  useEffect(() => {
    if (advanced.current && advancedIssue) advanced.current.open = true;
  }, [issueSignature, advancedIssue]);
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
    override?.[field] !== null && override?.[field] !== undefined && onReset ? (
      <IconButton label={`撤销${name}覆盖`} onClick={() => onReset(field)}>
        <RotateCcw size={12} />
      </IconButton>
    ) : null;
  const numeric = (
    field: "strength" | "fidelity" | "informationExtracted",
    name: string,
    range: NumericRange | null | undefined,
    help: string,
  ) => (
    <div className="precise-reference-field" data-reference-field={field}>
      <div className="precise-reference-label">
        <label htmlFor={`${prefix}-${field}`}>{name}</label>
        <HelpMarker label={`${name}说明`}>{help}</HelpMarker>
        {reset(field, name)}
      </div>
      <ReferenceNumber
        id={`${prefix}-${field}`}
        range={range}
        value={value[field]}
        invalid={hasIssue(field)}
        describedBy={hasIssue(field) ? `${prefix}-${field}-issues` : undefined}
        onChange={(number) => onChange({ [field]: number })}
      />
      {messages(field)}
    </div>
  );
  const savedTypeUnsupported = !!options && !options.referenceTypes.includes(value.referenceType);
  return (
    <article
      className="precise-reference-row"
      data-reference-id={value.id}
      data-disabled={!value.enabled || undefined}
    >
      <header>
        <strong>{label}</strong>
        {override && <span className="tag">本次覆盖</span>}
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
      <div className="precise-reference-image" data-reference-field="assetId">
        {media.asset && (
          <AssetImage asset={media.asset} alt={label} className="precise-reference-thumbnail" />
        )}
        <div className="precise-reference-image-info">
          {media.loading && <output>正在读取参考图片…</output>}
          {media.asset && <span>{imageName(media.asset)}</span>}
          {media.error && (
            <Notice actions={<Button onClick={media.retry}>重试读取</Button>}>{media.error}</Notice>
          )}
          <div className="button-group">
            <Button
              aria-invalid={hasIssue("assetId") || undefined}
              aria-describedby={hasIssue("assetId") ? `${prefix}-assetId-issues` : undefined}
              onClick={() => setPicking(true)}
            >
              替换图片
            </Button>
            {reset("assetId", "图片")}
          </div>
        </div>
      </div>
      {messages("assetId")}
      <div className="precise-reference-fields">
        <div className="precise-reference-field" data-reference-field="referenceType">
          <div className="precise-reference-label">
            <label htmlFor={`${prefix}-type`}>用途</label>
            {reset("referenceType", "用途")}
          </div>
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
          {messages("referenceType")}
        </div>
        {numeric(
          "strength",
          "强度",
          options?.strength,
          "控制参考图片的视觉特征对生成结果的影响程度。",
        )}
      </div>
      {savedTypeUnsupported && (
        <p className="precise-reference-message">当前 SDK 不支持已保存的用途，由 SDK 校验。</p>
      )}
      <details className="precise-reference-advanced" ref={advanced}>
        <summary>
          高级
          <span className="precise-reference-status">
            {` · Fidelity ${value.fidelity} · 信息提取量 ${value.informationExtracted}`}
          </span>
        </summary>
        <div className="precise-reference-fields">
          {numeric(
            "fidelity",
            "Fidelity",
            options?.fidelity,
            "控制参考约束的精确程度，较高时更难通过提示词覆盖。",
          )}
          {numeric(
            "informationExtracted",
            "信息提取量",
            options?.informationExtracted,
            "用于参考图片的信息提取参数；有效范围由 SDK 提供。",
          )}
        </div>
      </details>
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
      {messages.vibe && <p className="precise-reference-message">{messages.vibe}</p>}
    </>
  );
}
