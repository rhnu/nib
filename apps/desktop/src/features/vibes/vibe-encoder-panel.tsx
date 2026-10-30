import { useAccount } from "@/features/generation/account/account-context";
import { useQuery } from "@tanstack/react-query";
import { resultsApi } from "@/features/generation/results/api";
import { mediaApi } from "@/features/media/api";
import { VibeAssetDetails } from "./vibe-asset-details";
import { useVibeAction } from "./use-vibe-action";
import { downloadBytes } from "./model";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Draft, VibeEncodingInput, VibeReferenceInput } from "@/bindings/workbench";
import { Button, Field, HelpMarker, Notice } from "@/shared/ui";
import { trackPendingWork } from "@/shared/host/pending-work";
import { errorMessage } from "@/shared/host/error";
import { ImagePickerDialog, useMediaAsset, AssetImage } from "@/features/media";
import { useMediaQuery } from "@/features/media/use-media-query";
import { imageName } from "@/features/media/model";
import { useGenerationDraft } from "@/features/inputs/use-generation-draft";
import { useGenerationQuote } from "@/features/generation/submission/use-generation-quote";
import { GenerationActions } from "@/features/generation/submission/generation-actions";
import { encodingApi } from "./encoding-api";
import { encodingSubmission, isReusableEncoding, optionalEncodingSeed } from "./encoding-model";
import "./encoder.css";

function EncoderOutput({
  assetId,
  onAddReference,
}: {
  assetId: string;
  onAddReference?: (reference: VibeReferenceInput) => void;
}) {
  const action = useVibeAction();
  return (
    <article className="vibe-encoder-output">
      <VibeAssetDetails id={assetId} />
      <div className="button-group">
        {onAddReference && (
          <Button
            disabled={action.busy}
            onClick={() =>
              void action.run(async (active) => {
                const reference = await mediaApi.createVibeReference(assetId);
                if (active()) onAddReference(reference);
              })
            }
          >
            添加到当前创作
          </Button>
        )}
        <Button
          disabled={action.busy}
          onClick={() =>
            void action.run(async (active) => {
              const bytes = await mediaApi.content(assetId);
              if (active()) downloadBytes(bytes, "vibe.bin", "application/octet-stream");
            })
          }
        >
          下载编码
        </Button>
        <Button
          disabled={action.busy}
          onClick={() =>
            void action.run(async (active) => {
              const document = await mediaApi.createEncodedVibeDocument(assetId);
              const bytes = await mediaApi.exportVibeDocument(document.id);
              if (active()) downloadBytes(bytes, "vibe.naiv4vibe");
            })
          }
        >
          导出氛围转移文件
        </Button>
      </div>
      {action.error && <Notice>{action.error}</Notice>}
    </article>
  );
}

export function VibeEncoderPanel({
  draft,
  readCurrentDraft,
  onChange,
  refreshKey,
  onAddReference,
}: {
  draft: Draft;
  readCurrentDraft: () => Draft;
  onChange: (input: VibeEncodingInput) => void;
  refreshKey: unknown;
  onAddReference?: (reference: VibeReferenceInput) => void;
}) {
  const options = useMediaQuery(
    ["model", "vibe-encoding-options"],
    "encoding",
    encodingApi.options,
  );
  const input = draft.vibeEncoder;
  const media = useMediaAsset(input?.assetId ?? null);
  const mask = useMediaAsset(input?.maskAssetId ?? null);
  const base = useGenerationDraft(draft);
  const submission = useMemo(() => (input ? encodingSubmission(base, input) : null), [base, input]);
  const { accountSummaryLoading } = useAccount();
  const resultsQuery = useQuery({
    queryKey: ["results", "vibes"],
    queryFn: () => resultsApi.results({ kind: "vibe", jobId: null, limit: 200, before: null }),
    refetchOnWindowFocus: false,
  });
  const results = resultsQuery.data?.items;
  const outputs = input
    ? (results?.filter(
        (result) =>
          result.operation.kind === "encodeVibe" &&
          result.operation.input.assetId === input.assetId,
      ) ?? [])
    : [];
  const estimate = useGenerationQuote(
    submission ?? base,
    refreshKey,
    submission !== null && !accountSummaryLoading,
  );
  const [picker, setPicker] = useState<"source" | "mask" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const latest = useRef({ active: true, sequence: 0, readCurrentDraft, onChange });
  const root = useRef<HTMLDivElement>(null);
  const advanced = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    if (advanced.current && (mask.error || estimate.fields.includes("mask")))
      advanced.current.open = true;
  }, [mask.error, estimate.fields]);
  useLayoutEffect(() => {
    Object.assign(latest.current, { readCurrentDraft, onChange });
  });
  useEffect(() => {
    const current = latest.current;
    current.active = true;
    return () => {
      current.active = false;
      current.sequence++;
    };
  }, []);
  const update = (patch: Partial<VibeEncodingInput>) => {
    const current = latest.current;
    const input = current.readCurrentDraft().vibeEncoder;
    if (input) current.onChange({ ...input, ...patch });
  };
  const prepare = async (assetId: string) => {
    const current = latest.current;
    const previous = current.readCurrentDraft().vibeEncoder;
    const model = previous?.model ?? options.value?.models[0];
    if (!model) return;
    const sequence = ++current.sequence;
    setBusy(true);
    setError("");
    try {
      await trackPendingWork(
        (async () => {
          const created = await encodingApi.create(assetId, model);
          if (!current.active || current.sequence !== sequence) return;
          const live = current.readCurrentDraft().vibeEncoder;
          current.onChange(live ? { ...live, assetId } : created);
        })(),
      );
    } catch (cause) {
      if (current.active && current.sequence === sequence) setError(errorMessage(cause));
    } finally {
      if (current.active && current.sequence === sequence) setBusy(false);
    }
  };
  const locate = (field: string) => {
    const key =
      (
        {
          information_extracted: "informationExtracted",
          mask: "maskAssetId",
          image: "assetId",
          encode_vibe: "model",
        } as Record<string, string>
      )[field] ?? field;
    if (
      ["maskAssetId", "cropToMask", "focusSeed", "infoExtractSeed"].includes(key) &&
      advanced.current
    )
      advanced.current.open = true;
    requestAnimationFrame(() => {
      const target = root.current?.querySelector<HTMLElement>(
        `[data-encoder-field="${CSS.escape(key)}"]`,
      );
      target?.scrollIntoView({ block: "nearest" });
      target?.querySelector<HTMLElement>("input, select, button")?.focus();
    });
  };
  const encoded = input && results?.some((result) => isReusableEncoding(result, input));
  return (
    <div className="vibe-encoder" ref={root}>
      {options.loading && <output>正在读取编码选项…</output>}
      {options.error && (
        <Notice actions={<Button onClick={options.retry}>重试</Button>}>{options.error}</Notice>
      )}
      {error && <Notice>{error}</Notice>}
      <div className="vibe-encoder-source" data-encoder-field="assetId">
        {media.asset && (
          <AssetImage asset={media.asset} alt="编码源图" className="vibe-encoder-preview" />
        )}
        <div>
          {media.asset && <p>{imageName(media.asset)}</p>}
          {media.error && (
            <Notice actions={<Button onClick={media.retry}>重试</Button>}>{media.error}</Notice>
          )}
          <Button
            disabled={busy || !options.value?.models.length}
            onClick={() => setPicker("source")}
          >
            {busy ? "正在准备…" : input ? "更换图片" : "选择图片"}
          </Button>
        </div>
      </div>
      {input && (
        <>
          <div className="vibe-encoder-fields">
            <div data-encoder-field="model">
              <Field label="编码模型">
                <select
                  value={input.model}
                  onChange={(event) => update({ model: event.target.value })}
                >
                  {!options.value?.models.includes(input.model) && (
                    <option value={input.model}>{input.model} · 已保存</option>
                  )}
                  {options.value?.models.map((model) => (
                    <option key={model}>{model}</option>
                  ))}
                </select>
              </Field>
            </div>
            <div data-encoder-field="informationExtracted">
              <Field label="信息提取量">
                <input
                  type="number"
                  step="any"
                  min={options.value?.informationExtracted.min}
                  max={options.value?.informationExtracted.max}
                  value={input.informationExtracted}
                  onWheel={(event) => event.currentTarget.blur()}
                  onChange={(event) => {
                    if (Number.isFinite(event.target.valueAsNumber))
                      update({ informationExtracted: event.target.valueAsNumber });
                  }}
                />
              </Field>
            </div>
          </div>
          <details ref={advanced} className="vibe-encoder-advanced">
            <summary>高级</summary>
            <div data-encoder-field="maskAssetId" className="vibe-encoder-mask">
              {mask.asset && (
                <AssetImage
                  asset={mask.asset}
                  alt="编码遮罩"
                  className="vibe-encoder-mask-preview"
                />
              )}
              {mask.error && <Notice>{mask.error}</Notice>}
              <Button onClick={() => setPicker("mask")}>
                {input.maskAssetId ? "更换遮罩" : "选择遮罩"}
              </Button>
              {input.maskAssetId && (
                <Button onClick={() => update({ maskAssetId: null, cropToMask: null })}>
                  清除遮罩
                </Button>
              )}
            </div>
            <div className="vibe-encoder-fields">
              <div data-encoder-field="cropToMask">
                <Field label="裁剪到遮罩">
                  <select
                    disabled={!input.maskAssetId}
                    value={input.cropToMask === null ? "" : String(input.cropToMask)}
                    onChange={(event) =>
                      update({
                        cropToMask:
                          event.target.value === "" ? null : event.target.value === "true",
                      })
                    }
                  >
                    <option value="">默认</option>
                    <option value="true">开启</option>
                    <option value="false">关闭</option>
                  </select>
                </Field>
              </div>
              {(["focusSeed", "infoExtractSeed"] as const).map((key) => (
                <div key={key} data-encoder-field={key}>
                  <Field label={key === "focusSeed" ? "Focus Seed" : "信息提取种子"}>
                    <input
                      type="number"
                      step={1}
                      value={input[key] ?? ""}
                      placeholder="默认"
                      onWheel={(event) => event.currentTarget.blur()}
                      onChange={(event) =>
                        update({ [key]: optionalEncodingSeed(event.target.value) })
                      }
                    />
                  </Field>
                </div>
              ))}
            </div>
          </details>
          <div className="vibe-encoder-status">
            <span>{encoded ? "已有可复用编码" : "可编码当前输入，或从材料中选择已有编码"}</span>
            <HelpMarker label="编码与参考">
              改变提取量、模型或遮罩需要重新编码。编码结果可从材料库复用，添加已有材料不会重新编码。
            </HelpMarker>
          </div>
          {submission && (
            <GenerationActions
              draft={submission}
              readCurrentDraft={() => {
                const current = readCurrentDraft();
                return encodingSubmission(current, current.vibeEncoder!);
              }}
              refreshKey={refreshKey}
              resolved={null}
              estimate={estimate}
              operationPending={busy}
              onFocusField={locate}
            />
          )}
        </>
      )}
      {resultsQuery.error && (
        <Notice actions={<Button onClick={() => void resultsQuery.refetch()}>重试读取编码</Button>}>
          {errorMessage(resultsQuery.error)}
        </Notice>
      )}
      {outputs.length > 0 && (
        <section className="vibe-encoder-outputs" aria-label="已保存编码">
          <h3>已保存编码</h3>
          {outputs.slice(0, 4).map((result) => (
            <EncoderOutput
              key={result.id}
              assetId={result.assetId}
              onAddReference={onAddReference}
            />
          ))}
        </section>
      )}
      <ImagePickerDialog
        open={picker !== null}
        title={picker === "mask" ? "选择编码遮罩" : "选择编码图片"}
        onClose={() => setPicker(null)}
        onSelect={(asset) => {
          const target = picker;
          setPicker(null);
          if (target === "mask") update({ maskAssetId: asset.id });
          else if (target === "source") void prepare(asset.id);
        }}
      />
    </div>
  );
}
