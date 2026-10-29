import { useQuery } from "@tanstack/react-query";
import { useEffect, useId, useRef, useState } from "react";
import { Info, Paintbrush } from "lucide-react";
import type { GenerationQuote, ParameterDiagnostic } from "../../bindings/generation";
import type { MediaAsset } from "../../bindings/media";
import type { CreationOperation, Draft, ModelCapabilities } from "../../bindings/workbench";
import { errorMessage } from "../../shared/host/error";
import { Button, Field, HelpMarker, Toggle } from "../../shared/ui";
import { ImageImporter } from "../media/ImageImporter";
import { ImagePickerDialog } from "../media/ImagePickerDialog";
import { ImageMetadataDialog } from "../media/ImageMetadataDialog";
import { AssetImage } from "../media/AssetImage";
import { useMediaAsset } from "../media/useMediaAsset";
import {
  imageOperationAction,
  imageOperationApi,
  operationLabel,
  operationSourceId,
  optionalImageSeed,
  type ImageOperationAction,
} from "./image-operation";
import "./image-operation.css";
import { InpaintSettings } from "./InpaintSettings";

interface ImageOperationPanelProps {
  draft: Draft;
  capabilities: ModelCapabilities | null;
  estimate: GenerationQuote | null;
  diagnostics?: ParameterDiagnostic[];
  errorFields?: string[];
  models: string[];
  readCurrentDraft: () => Draft;
  edit: (draft: Draft) => void;
  onRestore: (draft: Draft) => void;
  onError: (message: string) => void;
  onRequestOperation: (id: string, kind: ImageOperationAction) => void;
  onPrepareImportedOperation: (id: string, kind: ImageOperationAction) => Promise<void>;
  onReturnToText: () => void;
  inputVersion: number;
  onEditMask: (assetId: string) => void;
}

/** The draft owns input values; this panel owns only open dialogs and the next import's action. */
export function ImageOperationPanel({
  draft,
  capabilities,
  estimate,
  diagnostics: providedDiagnostics,
  errorFields = [],
  models,
  readCurrentDraft,
  edit,
  onRestore,
  onError,
  onRequestOperation,
  onPrepareImportedOperation,
  onReturnToText,
  inputVersion,
  onEditMask,
}: ImageOperationPanelProps) {
  const prefix = useId();
  const operation = draft.inputs.operation;
  const currentAction =
    operation.kind === "inpainting" ? "inpainting" : imageOperationAction(operation);
  const [importAction, setImportAction] = useState<ImageOperationAction | "inpainting" | null>(
    null,
  );
  const action = currentAction === "textToImage" ? (importAction ?? currentAction) : currentAction;
  const sourceId = operationSourceId(operation);
  const media = useMediaAsset(sourceId);
  const mask = useMediaAsset(operation.kind === "inpainting" ? operation.maskAssetId : null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [metadataAsset, setMetadataAsset] = useState<MediaAsset | null>(null);
  const optionsQuery = useQuery({
    queryKey: ["model", "image-operation-options"],
    queryFn: imageOperationApi.options,
    staleTime: Infinity,
  });
  const options = optionsQuery.data ?? null;
  const optionsError = optionsQuery.error ? errorMessage(optionsQuery.error) : null;
  const advanced = useRef<HTMLDetailsElement>(null);

  const diagnostics = providedDiagnostics ?? estimate?.diagnostics ?? [];
  const diagnosticSignature = diagnostics.map((item) => `${item.field}:${item.change}`).join("|");
  const errorSignature = errorFields.join("|");
  const isAdvancedDiagnostic = [...diagnostics.map((item) => item.field), ...errorFields].some(
    (field) => /extra_?noise_?seed|color_?correct|add_?original_?image/i.test(field),
  );
  useEffect(() => {
    if (advanced.current && isAdvancedDiagnostic) advanced.current.open = true;
  }, [isAdvancedDiagnostic, diagnosticSignature, errorSignature]);

  const requestSource = (asset: MediaAsset) => {
    if (action === "inpainting") onEditMask(asset.id);
    else {
      const target = action === "upscale" || action === "maxEnhance" ? action : "imageToImage";
      onRequestOperation(asset.id, target);
    }
    setImportAction(null);
  };
  const prepareImportedSource = async (asset: MediaAsset) => {
    const target =
      action === "inpainting" || action === "upscale" || action === "maxEnhance"
        ? action
        : "imageToImage";
    // This callback is already inside tracked import work, so it cannot wait for global work.
    await onPrepareImportedOperation(asset.id, target);
    setImportAction(null);
  };
  const selectAction = (next: string) => {
    if (next === "textToImage") {
      setImportAction(null);
      onReturnToText();
    } else if (next === "inpainting") {
      if (sourceId) onEditMask(sourceId);
      else {
        setImportAction(next);
        setPickerOpen(true);
      }
    } else if (next === "imageToImage" || next === "maxEnhance" || next === "upscale") {
      if (sourceId) onRequestOperation(sourceId, next);
      else {
        setImportAction(next);
        setPickerOpen(true);
      }
    }
  };
  const updateOperation = (update: (value: CreationOperation) => CreationOperation) => {
    const current = readCurrentDraft();
    if (
      current.inputs.operation.kind !== operation.kind ||
      operationSourceId(current.inputs.operation) !== sourceId
    ) {
      onError("图像操作已改变，请在当前操作中重新编辑。");
      return;
    }
    edit({
      ...current,
      inputs: { ...current.inputs, operation: update(current.inputs.operation) },
    });
  };
  const numeric = (field: "strength" | "noise", raw: string) => {
    const value = Number(raw);
    if (raw.trim() === "" || !Number.isFinite(value)) return;
    updateOperation((current) =>
      current.kind === "imageToImage" ? { ...current, [field]: value } : current,
    );
  };
  const diagnostic = (field: string) =>
    diagnostics.filter((item) =>
      item.field.replaceAll("_", "").toLowerCase().split(".").includes(field.toLowerCase()),
    );
  const rejected = (field: string) =>
    errorFields.some((path) =>
      path.replaceAll("_", "").toLowerCase().split(".").includes(field.toLowerCase()),
    );
  const controlProps = (field: string) => ({
    "aria-invalid": rejected(field) || undefined,
    "aria-describedby":
      diagnostic(field).length || rejected(field) ? `${prefix}-${field}-message` : undefined,
  });
  const messages = (field: string) =>
    diagnostic(field).length > 0 || rejected(field) ? (
      <output className="image-operation-diagnostic" id={`${prefix}-${field}-message`}>
        {diagnostic(field).map((item, index) => (
          <span key={index}>{item.change}</span>
        ))}
        {rejected(field) && <span>SDK 拒绝该字段，请查看生成区错误并调整。</span>}
      </output>
    ) : null;
  const effectiveOperation = estimate?.resolved?.inputs.operation;
  const geometry =
    effectiveOperation?.kind === "imageToImage" && effectiveOperation.maxEnhance
      ? estimate?.geometry
      : null;

  return (
    <section className="image-operation-panel">
      <header className="section-heading">
        <h2>
          图像输入
          <HelpMarker label="图像输入说明">
            局部重绘先编辑并应用遮罩。纯补绘与局部图生图的可用性来自模型能力；Max Enhance
            的输出与计价尺寸来自估费。
          </HelpMarker>
        </h2>
      </header>
      {draft.maskEditor.sessions.some(
        (session) => session.revision !== session.appliedRevision,
      ) && (
        <div className="image-source-actions" aria-label="待继续的遮罩">
          {draft.maskEditor.sessions
            .filter((session) => session.revision !== session.appliedRevision)
            .map((session, index) => (
              <Button key={session.sourceAssetId} onClick={() => onEditMask(session.sourceAssetId)}>
                继续遮罩 {index + 1} · {session.width} × {session.height}
              </Button>
            ))}
        </div>
      )}
      <div className={`image-source-actions${sourceId ? " has-source" : ""}`}>
        {sourceId && (
          <div className="image-source-operation" data-setting-field="maxEnhance">
            <select
              {...controlProps("maxEnhance")}
              aria-label="图像操作"
              value={action ?? operation.kind}
              onChange={(event) => selectAction(event.target.value)}
            >
              <option value="textToImage">文生图</option>
              <option value="imageToImage">图生图</option>
              <option value="maxEnhance" disabled={capabilities?.maxEnhance === false}>
                Max Enhance
              </option>
              <option value="upscale">独立放大</option>
              <option value="inpainting" disabled={capabilities?.inpainting === false}>
                局部重绘
              </option>
              {currentAction === null && (
                <option value={operation.kind}>{operationLabel(operation)}</option>
              )}
            </select>
            {messages("maxEnhance")}
          </div>
        )}
        <ImageImporter
          key={JSON.stringify([
            operation.kind,
            sourceId,
            currentAction,
            importAction,
            inputVersion,
          ])}
          onImported={prepareImportedSource}
          label={sourceId ? "换图" : "选择文件"}
          onChooseExisting={() => setPickerOpen(true)}
        />
      </div>
      {sourceId && (
        <div className="image-source" data-setting-field="sourceImage">
          {media.loading && <output className="muted">正在读取底图…</output>}
          {media.error && (
            <div className="inline-warning" role="alert">
              {media.error}
              <Button className="quiet" onClick={media.retry}>
                重试
              </Button>
            </div>
          )}
          {media.asset && (
            <>
              <AssetImage
                asset={media.asset}
                alt="当前操作的底图"
                className="image-source-thumbnail"
              />
              <div className="image-source-info">
                <strong>
                  {media.asset.source.kind === "import"
                    ? (media.asset.source.name ?? "已保存图像")
                    : "已保存图像"}
                </strong>
                <small>
                  {media.asset.width ?? "?"} × {media.asset.height ?? "?"} · {media.asset.mimeType}
                </small>
                {!media.asset.available && (
                  <p className="inline-warning">底图不可用，请换图后再提交。</p>
                )}
                <Button className="quiet" onClick={() => setMetadataAsset(media.asset)}>
                  <Info size={13} />
                  图像信息与恢复
                </Button>
                {capabilities?.inpainting !== false && operation.kind !== "inpainting" && (
                  <Button
                    className="quiet"
                    disabled={!media.asset.available}
                    onClick={() => onEditMask(sourceId!)}
                  >
                    <Paintbrush size={13} />
                    绘制遮罩
                  </Button>
                )}
              </div>
            </>
          )}
        </div>
      )}
      {operation.kind === "inpainting" && (
        <>
          <div className="image-source" data-setting-field="maskAssetId">
            {mask.loading && <output className="muted">正在读取已应用遮罩…</output>}
            {mask.error && (
              <div className="inline-warning" role="alert">
                {mask.error}
                <Button className="quiet" onClick={mask.retry}>
                  重试
                </Button>
              </div>
            )}
            {mask.asset && (
              <>
                <AssetImage
                  asset={mask.asset}
                  alt="已应用的局部重绘遮罩"
                  className="image-source-thumbnail"
                />
                <div className="image-source-info">
                  <strong>已应用遮罩</strong>
                  <small>
                    {mask.asset.width ?? "?"} × {mask.asset.height ?? "?"}
                  </small>
                  {!mask.asset.available && (
                    <p className="inline-warning">遮罩不可用，请重新编辑并应用。</p>
                  )}
                </div>
              </>
            )}
            <Button
              className="quiet"
              disabled={!media.asset?.available}
              onClick={() => onEditMask(operation.assetId)}
            >
              <Paintbrush size={13} />
              编辑遮罩
            </Button>
            {messages("maskAssetId")}
            {messages("mask")}
          </div>
          <InpaintSettings
            key={`${sourceId}:${operation.maskAssetId}:${inputVersion}`}
            operation={operation}
            capabilities={capabilities}
            defaults={options?.inpaintConditioning ?? null}
            optionsError={optionsError}
            retryOptions={() => {
              void optionsQuery.refetch();
            }}
            diagnostics={diagnostics}
            errorFields={errorFields}
            update={(change) =>
              updateOperation((current) =>
                current.kind === "inpainting" ? change(current) : current,
              )
            }
          />
        </>
      )}
      {operation.kind === "imageToImage" && (
        <div className="image-operation-fields">
          {operation.maxEnhance && (
            <>
              {capabilities?.maxEnhance === false && (
                <p className="inline-warning" role="alert">
                  当前模型不支持 Max Enhance；已编辑值保留，请更换模型或操作。
                </p>
              )}
              {geometry ? (
                <dl className="image-operation-geometry">
                  <div>
                    <dt>输入</dt>
                    <dd>
                      {geometry.input_size.width} × {geometry.input_size.height}
                    </dd>
                  </div>
                  <div>
                    <dt>输出</dt>
                    <dd>
                      {geometry.output_size.width} × {geometry.output_size.height}
                    </dd>
                  </div>
                  <div>
                    <dt>计价</dt>
                    <dd>
                      {geometry.pricing_size.width} × {geometry.pricing_size.height}
                    </dd>
                  </div>
                </dl>
              ) : (
                <p className="image-operation-note">
                  {estimate &&
                  effectiveOperation?.kind === "imageToImage" &&
                  !effectiveOperation.maxEnhance
                    ? "SDK 有效操作为普通图生图；Max Enhance 未生效，不能以该操作提交。"
                    : "等待估费确认输出与计价尺寸。"}
                </p>
              )}
            </>
          )}
          <div data-setting-field="strength">
            <Field label="Strength">
              <input
                {...controlProps("strength")}
                type="number"
                step="any"
                min={capabilities?.ranges.img2imgStrength.min}
                max={capabilities?.ranges.img2imgStrength.max}
                value={operation.strength}
                onChange={(event) => numeric("strength", event.target.value)}
              />
            </Field>
            {messages("strength")}
          </div>
          <div data-setting-field="noise">
            <Field label="Noise">
              <input
                {...controlProps("noise")}
                type="number"
                step="any"
                min={capabilities?.ranges.img2imgNoise.min}
                max={capabilities?.ranges.img2imgNoise.max}
                value={operation.noise}
                onChange={(event) => numeric("noise", event.target.value)}
              />
            </Field>
            {messages("noise")}
          </div>
          <details className="image-operation-advanced" ref={advanced}>
            <summary>
              图生图高级设置
              <small>
                颜色校正{operation.colorCorrect ? "开" : "关"} · 原图
                {operation.addOriginalImage ? "开" : "关"} · 噪声种子
                {operation.extraNoiseSeed ?? "继承"}
              </small>
            </summary>
            <div className="image-operation-fields">
              <fieldset
                className="image-operation-toggle"
                data-setting-field="colorCorrect"
                aria-label="Color Correct"
                {...controlProps("colorCorrect")}
              >
                <span>Color Correct</span>
                <Toggle
                  label="Color Correct"
                  checked={operation.colorCorrect}
                  onChange={(colorCorrect) =>
                    updateOperation((current) =>
                      current.kind === "imageToImage" ? { ...current, colorCorrect } : current,
                    )
                  }
                />
                {messages("colorCorrect")}
              </fieldset>
              <div data-setting-field="extraNoiseSeed">
                <Field label="额外噪声种子">
                  <input
                    {...controlProps("extraNoiseSeed")}
                    type="number"
                    step={1}
                    placeholder="留空继承生成种子"
                    value={operation.extraNoiseSeed ?? ""}
                    onChange={(event) => {
                      const raw = event.target.value;
                      updateOperation((current) =>
                        current.kind === "imageToImage"
                          ? { ...current, extraNoiseSeed: optionalImageSeed(raw) }
                          : current,
                      );
                    }}
                  />
                </Field>
                {messages("extraNoiseSeed")}
              </div>
              <fieldset
                className="image-operation-toggle"
                data-setting-field="addOriginalImage"
                aria-label="Add Original Image"
                {...controlProps("addOriginalImage")}
              >
                <span>Add Original Image</span>
                <Toggle
                  label="Add Original Image"
                  checked={operation.addOriginalImage}
                  onChange={(addOriginalImage) =>
                    updateOperation((current) =>
                      current.kind === "imageToImage" ? { ...current, addOriginalImage } : current,
                    )
                  }
                />
                {messages("addOriginalImage")}
              </fieldset>
            </div>
          </details>
        </div>
      )}
      {operation.kind === "upscale" && (
        <div className="image-operation-fields">
          <div data-setting-field="upscaleModel">
            <Field label="放大模型">
              <select
                {...controlProps("model")}
                value={operation.model}
                onChange={(event) => {
                  const model = event.target.value;
                  updateOperation((current) =>
                    current.kind === "upscale" ? { ...current, model } : current,
                  );
                }}
              >
                {!models.includes(operation.model) && (
                  <option value={operation.model}>{operation.model} · 已保存</option>
                )}
                {models.map((model) => (
                  <option value={model} key={model}>
                    {model}
                  </option>
                ))}
              </select>
            </Field>
            {messages("model")}
          </div>
          <div data-setting-field="declaredBlurSigma">
            <Field label="Blur Sigma">
              <select
                {...controlProps("declaredBlurSigma")}
                value={operation.declaredBlurSigma}
                disabled={!options}
                onChange={(event) => {
                  const sigma = options?.upscaleBlurSigmas.find(
                    (value) => String(value) === event.target.value,
                  );
                  if (sigma !== undefined)
                    updateOperation((current) =>
                      current.kind === "upscale"
                        ? { ...current, declaredBlurSigma: sigma }
                        : current,
                    );
                }}
              >
                {!options?.upscaleBlurSigmas.includes(operation.declaredBlurSigma) && (
                  <option value={operation.declaredBlurSigma}>
                    {operation.declaredBlurSigma} · 已保存
                  </option>
                )}
                {options?.upscaleBlurSigmas.map((sigma) => (
                  <option key={sigma} value={sigma}>
                    {sigma}
                  </option>
                ))}
              </select>
            </Field>
            {messages("declaredBlurSigma")}
          </div>
          {optionsError && (
            <div className="inline-warning" role="alert">
              {optionsError}
              <Button
                className="quiet"
                onClick={() => {
                  void optionsQuery.refetch();
                }}
              >
                重试
              </Button>
            </div>
          )}
          {!options && !optionsError && <output className="muted">正在读取放大选项…</output>}
        </div>
      )}
      <ImagePickerDialog
        open={pickerOpen}
        onClose={() => {
          setPickerOpen(false);
          setImportAction(null);
        }}
        onSelect={(asset) => {
          setPickerOpen(false);
          requestSource(asset);
        }}
        onRestore={(next) => {
          setImportAction(null);
          onRestore(next);
        }}
      />
      {metadataAsset && (
        <ImageMetadataDialog
          asset={metadataAsset}
          onClose={() => setMetadataAsset(null)}
          onRestore={(next) => {
            setImportAction(null);
            onRestore(next);
          }}
        />
      )}
    </section>
  );
}
