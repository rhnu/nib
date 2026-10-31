import { useContext, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ExtractedTag } from "@/bindings/safety";
import { Button, Field, Modal, Notice, notify } from "@/shared/ui";
import {
  t,
  useTranslation,
  useMessageState,
  MessageError,
  deferMessage,
  formatNumber,
} from "@/shared/i18n";
import { WorkbenchContext } from "@/features/workbench/workbench-context";
import { promptApi } from "@/features/prompt/api";
import { formatLexiconTerms } from "@/features/prompt/format-runtime";
import { trackPendingWork } from "@/shared/host/pending-work";
import { safetyApi } from "./safety-api";
import { appendRecognizedTags, tagPromptTargets } from "./tag-prompt";
import { errorMessage } from "@/shared/host/error";

/** Manual recognition is independent of automatic safety checks and keeps both tag categories. */
export function ImageTagDialog({ assetId, onClose }: { assetId: string; onClose: () => void }) {
  useTranslation();
  const workbench = useContext(WorkbenchContext);
  const [generalThreshold, setGeneralThreshold] = useState(0.35);
  const [characterThreshold, setCharacterThreshold] = useState(0.85);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [targetKey, setTargetKey] = useState("main");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useMessageState();
  const lock = useRef(false);
  const availability = useQuery({
    queryKey: ["image-analysis-status"],
    queryFn: safetyApi.status,
    meta: { downloadableResources: ["anime-dbrating", "wd-swinv2-tagger-v3"] },
  });
  const tags = useQuery({
    queryKey: ["image-tags", assetId],
    queryFn: () => safetyApi.tags(assetId),
    staleTime: Infinity,
    enabled: availability.data?.wdAvailable === true,
    meta: { downloadableResource: "wd-swinv2-tagger-v3" },
  });
  const groups = [
    {
      key: "general" as const,
      threshold: generalThreshold,
      setThreshold: setGeneralThreshold,
      items: tags.data?.general ?? [],
    },
    {
      key: "characters" as const,
      threshold: characterThreshold,
      setThreshold: setCharacterThreshold,
      items: tags.data?.characters ?? [],
    },
  ];
  const visible = groups.flatMap((group) =>
    group.items
      .filter((tag) => tag.confidence >= group.threshold)
      .map((tag) => ({ tag, key: `${group.key}:${tag.name}` })),
  );
  const selected = visible.filter(({ key }) => !excluded.has(key)).map(({ tag }) => tag);
  const targets = workbench
    ? tagPromptTargets(workbench.state.draft, workbench.state.resources)
    : [];
  const target = targets.find((item) => item.key === targetKey);
  const model = workbench
    ? (workbench.state.draft.settings.model ??
      workbench.state.resolved?.settings.model ??
      workbench.workspace.info.defaultModelId)
    : undefined;

  const run = async (append: boolean) => {
    if (lock.current || selected.length === 0) return;
    lock.current = true;
    setBusy(true);
    setError(null);
    try {
      await trackPendingWork(
        (async () => {
          const snapshot = workbench?.state.readCurrentDraft();
          const profile = await promptApi.syntax(model);
          const text = await formatLexiconTerms(
            selected.map((tag) => ({ name: tag.promptText, weight: null })),
            profile,
          );
          if (!append) {
            await navigator.clipboard.writeText(text);
            notify(() => t("safety.copied"));
            return;
          }
          if (!workbench || !snapshot || !target)
            throw new MessageError(deferMessage(() => t("safety.stale")));
          let current = snapshot;
          if (target.linked) {
            const preset = current.presets.find((item) => item.id === target.presetId);
            if (!preset) throw new MessageError(deferMessage(() => t("safety.stale")));
            const expanded = await promptApi.expandPreset(preset);
            current = {
              ...current,
              presets: current.presets.map((item) => (item.id === expanded.id ? expanded : item)),
            };
          }
          if (workbench.state.readCurrentDraft() !== snapshot)
            throw new MessageError(deferMessage(() => t("safety.stale")));
          const next = appendRecognizedTags(current, target, text);
          if (!next) throw new MessageError(deferMessage(() => t("safety.stale")));
          workbench.state.edit(next);
          notify(() => t("safety.appended"));
        })(),
      );
    } catch (cause) {
      setError(cause);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };

  const openDownloads = async () => {
    if (await workbench?.openDownloads()) onClose();
  };

  return (
    <Modal open onClose={onClose} title={t("safety.tags")} wide>
      <fieldset className="image-tag-dialog" disabled={busy} aria-busy={busy}>
        {(availability.isPending || tags.isFetching) && <output>{t("safety.recognizing")}</output>}
        {availability.error && (
          <Notice
            actions={
              <Button onClick={() => void availability.refetch()}>{t("safety.recognize")}</Button>
            }
          >
            {errorMessage(availability.error)}
          </Notice>
        )}
        {tags.error && (
          <Notice
            actions={<Button onClick={() => void tags.refetch()}>{t("safety.recognize")}</Button>}
          >
            {errorMessage(tags.error)}
          </Notice>
        )}
        {!availability.data?.wdAvailable && (
          <p className="image-safety-hint">{t("safety.needsModel")}</p>
        )}
        {workbench && !availability.data?.wdAvailable && (
          <Button onClick={() => void openDownloads()}>{t("safety.downloads")}</Button>
        )}
        {tags.data && (
          <>
            <div className="image-tag-groups">
              {groups.map((group) => (
                <section key={group.key}>
                  <h3>{t(`safety.${group.key}`)}</h3>
                  <Field label={t("safety.threshold")}>
                    <input
                      type="number"
                      min={0}
                      max={1}
                      step={0.05}
                      value={group.threshold}
                      onChange={(event) => {
                        const value = Number(event.target.value);
                        if (Number.isFinite(value) && value >= 0 && value <= 1)
                          group.setThreshold(value);
                      }}
                    />
                  </Field>
                  <div className="image-tag-list">
                    {group.items
                      .filter((tag) => tag.confidence >= group.threshold)
                      .map((tag: ExtractedTag) => {
                        const key = `${group.key}:${tag.name}`;
                        return (
                          <label key={key}>
                            <input
                              type="checkbox"
                              checked={!excluded.has(key)}
                              onChange={(event) =>
                                setExcluded((current) => {
                                  const next = new Set(current);
                                  if (event.target.checked) next.delete(key);
                                  else next.add(key);
                                  return next;
                                })
                              }
                            />
                            <span>{tag.name}</span>
                            <output>
                              {formatNumber(tag.confidence, {
                                style: "percent",
                                maximumFractionDigits: 1,
                              })}
                            </output>
                          </label>
                        );
                      })}
                    {!group.items.some((tag) => tag.confidence >= group.threshold) && (
                      <p className="muted">{t("safety.noTags")}</p>
                    )}
                  </div>
                </section>
              ))}
            </div>
            <div className="button-group">
              <Button onClick={() => setExcluded(new Set())}>{t("safety.selectAll")}</Button>
              <Button onClick={() => setExcluded(new Set(visible.map((item) => item.key)))}>
                {t("safety.selectNone")}
              </Button>
              <Button
                disabled={tags.isFetching || busy || !availability.data?.wdAvailable}
                onClick={() => void tags.refetch()}
              >
                {t("safety.recognize")}
              </Button>
            </div>
            <div className="button-group">
              <Button disabled={busy || !selected.length} onClick={() => void run(false)}>
                {t("safety.copy")}
              </Button>
              {workbench && (
                <>
                  <Field label={t("safety.target")}>
                    <select
                      value={targetKey}
                      onChange={(event) => setTargetKey(event.target.value)}
                    >
                      {targets.map((item) => (
                        <option key={item.key} value={item.key}>
                          {item.label}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Button
                    disabled={busy || !selected.length || !target}
                    onClick={() => void run(true)}
                  >
                    {t("safety.append")}
                  </Button>
                </>
              )}
            </div>
            {target?.linked && <p className="image-safety-hint">{t("safety.expandsPreset")}</p>}
            <p className="image-safety-hint">
              {t("safety.model")}: {tags.data.modelVersion}
            </p>
          </>
        )}
        {error && <Notice>{error}</Notice>}
      </fieldset>
    </Modal>
  );
}
