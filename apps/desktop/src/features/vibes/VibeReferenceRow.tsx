import { useId, useState, type ReactNode } from "react";
import { RotateCcw } from "lucide-react";
import type {
  ModelCapabilities,
  NumericRange,
  VibeEncodingInput,
  VibeReferenceInput,
  VibeReferenceOverride,
} from "../../bindings/workbench";
import { Button, Field, IconButton, Notice, Toggle } from "../../shared/ui";
import { AssetImage, useMediaAsset } from "../media";
import { VibeMaterialDialog } from "./VibeMaterialDialog";
import { VibeAssetDetails } from "./VibeAssetDetails";
import { vibeMaterialName, type VibePatch } from "./model";

export function VibeNumber({
  value,
  range,
  onChange,
  invalid,
}: {
  value: number;
  range?: NumericRange | null;
  onChange: (value: number) => void;
  invalid?: boolean;
}) {
  const [typing, setTyping] = useState<{ source: number; text: string } | null>(null);
  return (
    <input
      type="number"
      step="any"
      min={range?.min}
      max={range?.max}
      aria-invalid={invalid || undefined}
      value={typing?.source === value ? typing.text : value}
      onChange={(event) => {
        const number = event.currentTarget.valueAsNumber;
        const complete = Number.isFinite(number);
        setTyping({ source: complete ? number : value, text: event.currentTarget.value });
        if (complete) onChange(number);
      }}
      onBlur={() => setTyping(null)}
      onWheel={(event) => event.currentTarget.blur()}
    />
  );
}

export function VibeReferenceRow({
  value,
  index,
  capabilities,
  onChange,
  actions,
  override,
  onReset,
  issues = [],
  onEncode,
}: {
  value: VibeReferenceInput;
  index: number;
  capabilities: ModelCapabilities | null;
  onChange: (patch: VibePatch) => void;
  actions?: ReactNode;
  override?: VibeReferenceOverride;
  onReset?: (field: keyof VibePatch) => void;
  issues?: { field: string; message: string }[];
  onEncode?: (input?: VibeEncodingInput) => void;
}) {
  const media = useMediaAsset(value.input.assetId);
  const [picking, setPicking] = useState(false);
  const id = useId();
  const label = `Vibe ${index + 1}`;
  const reset = (field: keyof VibePatch) =>
    override?.[field] != null && onReset ? (
      <IconButton
        label={`撤销${label}${field === "strength" ? "强度" : field === "input" ? "材料" : "启用状态"}覆盖`}
        onClick={() => onReset(field)}
      >
        <RotateCcw size={13} />
      </IconButton>
    ) : null;
  return (
    <article
      className="vibe-row"
      data-vibe-id={value.id}
      data-disabled={!value.enabled || undefined}
    >
      <header data-vibe-field="enabled">
        <strong>{label}</strong>
        <span className="spacer" />
        <Toggle
          label={`启用${label}`}
          checked={value.enabled}
          onChange={(enabled) => onChange({ enabled })}
        />
        {reset("enabled")}
        {actions}
      </header>
      <div className="vibe-material" data-vibe-field="input">
        {media.asset?.kind === "image" && (
          <AssetImage asset={media.asset} alt={label} className="vibe-thumbnail" />
        )}
        <div>
          {media.loading && <output>正在读取材料…</output>}
          {media.asset && <span>{vibeMaterialName(media.asset)}</span>}
          {media.asset && !media.asset.available && <p role="alert">材料文件不可用</p>}
          {media.error && (
            <Notice actions={<Button onClick={media.retry}>重试</Button>}>{media.error}</Notice>
          )}
          <div className="button-group">
            <Button onClick={() => setPicking(true)}>替换材料</Button>
            {reset("input")}
          </div>
        </div>
      </div>
      {value.input.kind === "encoded" ? (
        <VibeAssetDetails id={value.input.assetId} onEncode={onEncode} />
      ) : null}
      <div className="vibe-fields">
        <div data-vibe-field="strength">
          <Field label="强度">
            <VibeNumber
              value={value.strength}
              range={capabilities?.vibeReferenceOptions.strength}
              invalid={issues.some((issue) => issue.field === "strength")}
              onChange={(strength) => onChange({ strength })}
            />
          </Field>
          {reset("strength")}
        </div>
        {value.input.kind === "image" && (
          <div data-vibe-field="informationExtracted">
            <Field label="信息提取量">
              <VibeNumber
                value={value.input.informationExtracted}
                range={capabilities?.vibeReferenceOptions.informationExtracted}
                onChange={(informationExtracted) => {
                  if (value.input.kind === "image")
                    onChange({ input: { ...value.input, informationExtracted } });
                }}
              />
            </Field>
          </div>
        )}
      </div>
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
