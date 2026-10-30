import { t, useTranslation, useMessageState } from "@/shared/i18n";
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
  useTranslation();

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
            {t("vibes.addToCreation")}
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
          {t("vibes.downloadEncoding")}
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
          {t("vibes.exportVibeFile")}
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
  useTranslation();

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
  const [error, setError] = useMessageState();
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
      if (current.active && current.sequence === sequence) setError(cause);
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
      {options.loading && <output>{t("vibes.loadingEncodingOptions")}</output>}
      {options.error && (
        <Notice actions={<Button onClick={options.retry}>{t("vibes.retry")}</Button>}>
          {options.error}
        </Notice>
      )}
      {error && <Notice>{error}</Notice>}
      <div className="vibe-encoder-source" data-encoder-field="assetId">
        {media.asset && (
          <AssetImage
            asset={media.asset}
            alt={t("vibes.encodingSourceImage")}
            className="vibe-encoder-preview"
          />
        )}
        <div>
          {media.asset && <p>{imageName(media.asset)}</p>}
          {media.error && (
            <Notice actions={<Button onClick={media.retry}>{t("vibes.retry")}</Button>}>
              {media.error}
            </Notice>
          )}
          <Button
            disabled={busy || !options.value?.models.length}
            onClick={() => setPicker("source")}
          >
            {busy ? t("vibes.preparing") : input ? t("vibes.changeImage") : t("vibes.chooseImage")}
          </Button>
        </div>
      </div>
      {input && (
        <>
          <div className="vibe-encoder-fields">
            <div data-encoder-field="model">
              <Field label={t("vibes.encodingModel")}>
                <select
                  value={input.model}
                  onChange={(event) => update({ model: event.target.value })}
                >
                  {!options.value?.models.includes(input.model) && (
                    <option value={input.model}>
                      {input.model}
                      {t("vibes.savedTag")}
                    </option>
                  )}
                  {options.value?.models.map((model) => (
                    <option key={model}>{model}</option>
                  ))}
                </select>
              </Field>
            </div>
            <div data-encoder-field="informationExtracted">
              <Field label={t("vibes.informationExtracted")}>
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
            <summary>{t("vibes.advanced")}</summary>
            <div data-encoder-field="maskAssetId" className="vibe-encoder-mask">
              {mask.asset && (
                <AssetImage
                  asset={mask.asset}
                  alt={t("vibes.encodingMask")}
                  className="vibe-encoder-mask-preview"
                />
              )}
              {mask.error && <Notice>{mask.error}</Notice>}
              <Button onClick={() => setPicker("mask")}>
                {input.maskAssetId ? t("vibes.changeMask") : t("vibes.chooseMask")}
              </Button>
              {input.maskAssetId && (
                <Button onClick={() => update({ maskAssetId: null, cropToMask: null })}>
                  {t("vibes.clearMask")}
                </Button>
              )}
            </div>
            <div className="vibe-encoder-fields">
              <div data-encoder-field="cropToMask">
                <Field label={t("vibes.cropToMask")}>
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
                    <option value="">{t("vibes.default")}</option>
                    <option value="true">{t("vibes.on")}</option>
                    <option value="false">{t("vibes.off")}</option>
                  </select>
                </Field>
              </div>
              {(["focusSeed", "infoExtractSeed"] as const).map((key) => (
                <div key={key} data-encoder-field={key}>
                  <Field
                    label={key === "focusSeed" ? t("vibes.focusSeed") : t("vibes.extractionSeed")}
                  >
                    <input
                      type="number"
                      step={1}
                      value={input[key] ?? ""}
                      placeholder={t("vibes.default")}
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
            <span>
              {encoded ? t("vibes.reusableEncodingAvailable") : t("vibes.encodingChoices")}
            </span>
            <HelpMarker label={t("vibes.encodingReferenceHelp")}>
              {t("vibes.encodingReferenceDescription")}
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
        <Notice
          actions={
            <Button onClick={() => void resultsQuery.refetch()}>
              {t("vibes.retryEncodingRead")}
            </Button>
          }
        >
          {errorMessage(resultsQuery.error)}
        </Notice>
      )}
      {outputs.length > 0 && (
        <section className="vibe-encoder-outputs" aria-label={t("vibes.savedEncodings")}>
          <h3>{t("vibes.savedEncodings")}</h3>
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
        title={picker === "mask" ? t("vibes.chooseEncodingMask") : t("vibes.chooseEncodingImage")}
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
