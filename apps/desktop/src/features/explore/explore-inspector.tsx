import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowDownToLine, Copy, Search, X } from "lucide-react";
import type { ExploreSummary } from "@/bindings/explore";
import { t, useTranslation } from "@/shared/i18n";
import { Button, IconButton, Modal, Notice, Select } from "@/shared/ui";
import { tagPromptTargets } from "@/features/media/tag-prompt";
import { useWorkbenchContext } from "@/features/workbench/workbench-context";
import { exploreApi } from "./api";
import { exploreErrorMessage } from "./error";
import { ExploreImage } from "./explore-image";
import { ExploreImageActions, type ExploreImageActions as Actions } from "./image-actions";

const categoryKeys = {
  general: "explore.category_general",
  artist: "explore.category_artist",
  copyright: "explore.category_copyright",
  character: "explore.category_character",
  meta: "explore.category_meta",
} as const;

export type ExplorePromptActions = {
  target: string;
  scope: "positive" | "negative";
  onTarget: (value: string) => void;
  onScope: (value: "positive" | "negative") => void;
  appendText: (value: string) => void;
  copyText: (value: string) => void;
  appendTags: () => void;
  copyTags: () => void;
  previewRestore: () => void;
};

/** Inspection is read-only until an explicit append, replace or image-use action. */
export function ExploreInspector({
  item,
  basket,
  onBasket,
  onClose,
  onSearchTag,
  actions,
  prompts,
}: {
  item: ExploreSummary;
  basket: string[];
  onBasket: (value: string[]) => void;
  onClose: () => void;
  onSearchTag: (tag: string) => void;
  actions: Actions;
  prompts: ExplorePromptActions;
}) {
  useTranslation();
  const { state } = useWorkbenchContext();
  const [largeOpen, setLargeOpen] = useState(false);
  const returnFocus = useRef<HTMLElement | null>(null);

  const openLarge = () => {
    returnFocus.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setLargeOpen(true);
  };

  const detail = useQuery({
    queryKey: ["explore", "detail", item.key],
    queryFn: () => exploreApi.detail(item.key),
    retry: false,
    staleTime: 60_000,
  });
  const targets = tagPromptTargets(state.draft, state.resources).filter((target) => !target.linked);
  const data = detail.data?.details;

  const textSection = (label: string, text: string | null) =>
    text !== null && (
      <section className="explore-prompt-section">
        <header>
          <h3>{label}</h3>
          <div className="ui-actions">
            <IconButton label={t("explore.copyText")} onClick={() => prompts.copyText(text)}>
              <Copy size={14} aria-hidden />
            </IconButton>
            <IconButton
              label={t("explore.appendText")}
              disabled={actions.busy || !text}
              onClick={() => prompts.appendText(text)}
            >
              <ArrowDownToLine size={14} aria-hidden />
            </IconButton>
          </div>
        </header>
        <p className="explore-prompt-text">{text || t("explore.emptyPrompt")}</p>
      </section>
    );

  return (
    <aside className="explore-inspector" aria-label={t("explore.inspector")}>
      <header className="explore-inspector-heading">
        <h2>{item.title}</h2>
        <IconButton label={t("common.close")} onClick={onClose}>
          <X size={16} aria-hidden />
        </IconButton>
      </header>
      <div className="explore-inspector-scroll">
        <div className="explore-preview">
          <ExploreImage
            key={JSON.stringify(item.key)}
            item={item}
            variant="preview"
            details
            onOpen={openLarge}
            openLabel={t("explore.viewLarge")}
          />
          <ExploreImageActions item={item} actions={actions} references onExpand={openLarge} />
        </div>
        <div className="explore-item-facts">
          <span>{item.author}</span>
          <span>{item.width > 0 && item.height > 0 ? `${item.width} × ${item.height}` : ""}</span>
          {item.rating && (
            <span>{t("explore.siteRating", { rating: t(`explore.rating_${item.rating}`) })}</span>
          )}
        </div>
        <div className="explore-prompt-target">
          <label>
            <span>{t("explore.target")}</span>
            <Select
              value={
                targets.some((target) => target.key === prompts.target) ? prompts.target : "main"
              }
              onValueChange={prompts.onTarget}
              options={targets.map((target) => ({ value: target.key, label: target.label }))}
            />
          </label>
          <label>
            <span>{t("explore.scope")}</span>
            <Select
              value={prompts.scope}
              onValueChange={(value) => prompts.onScope(value as "positive" | "negative")}
              options={[
                { value: "positive", label: t("prompt.positivePrompt") },
                { value: "negative", label: t("prompt.negativePrompt") },
              ]}
            />
          </label>
        </div>
        {detail.isPending && <output>{t("explore.loadingDetails")}</output>}
        {detail.error && (
          <Notice
            actions={<Button onClick={() => void detail.refetch()}>{t("explore.retry")}</Button>}
          >
            {t("explore.detailsFailed")} {exploreErrorMessage(detail.error, item.key.source)}
          </Notice>
        )}
        {data?.source === "danbooru" && (
          <>
            {data.tagGroups.map((group) => (
              <section className="explore-tag-group" key={group.category}>
                <h3>
                  {group.category in categoryKeys
                    ? t(categoryKeys[group.category as keyof typeof categoryKeys])
                    : group.category}
                </h3>
                <div className="explore-tags">
                  {group.tags.map((tag) => (
                    <span className="explore-tag" key={tag}>
                      <button
                        type="button"
                        aria-pressed={basket.includes(tag)}
                        onClick={() =>
                          onBasket(
                            basket.includes(tag)
                              ? basket.filter((value) => value !== tag)
                              : [...basket, tag],
                          )
                        }
                      >
                        {tag.replaceAll("_", " ")}
                      </button>
                      <IconButton
                        label={t("explore.searchTag", { tag })}
                        onClick={() => onSearchTag(tag)}
                      >
                        <Search size={12} aria-hidden />
                      </IconButton>
                    </span>
                  ))}
                </div>
              </section>
            ))}
            <section className="explore-basket">
              <header>
                <h3>{t("explore.selectedTags", { count: basket.length })}</h3>
                <Button disabled={!basket.length} onClick={() => onBasket([])}>
                  {t("explore.clear")}
                </Button>
              </header>
              {basket.length > 0 && (
                <>
                  <div className="explore-tags">
                    {basket.map((tag) => (
                      <button
                        className="explore-query-tag"
                        type="button"
                        key={tag}
                        aria-label={t("explore.removeTag", { tag })}
                        onClick={() => onBasket(basket.filter((value) => value !== tag))}
                      >
                        {tag.replaceAll("_", " ")}
                        <X size={12} aria-hidden />
                      </button>
                    ))}
                  </div>
                  <div className="ui-actions">
                    <Button disabled={actions.busy} onClick={prompts.appendTags}>
                      {t("explore.appendSelected")}
                    </Button>
                    <Button disabled={actions.busy} onClick={prompts.copyTags}>
                      {t("explore.copySelected")}
                    </Button>
                  </div>
                </>
              )}
            </section>
          </>
        )}
        {data?.source === "novelAi" && (
          <>
            {data.description && <p className="muted explore-description">{data.description}</p>}
            <p className="muted">{t(`explore.metadata_${data.metadata.status}`)}</p>
            {data.metadata.warnings.map((warning, index) => (
              <Notice key={index}>{warning}</Notice>
            ))}
            {textSection(t("prompt.positivePrompt"), data.metadata.prompt)}
            {textSection(t("prompt.negativePrompt"), data.metadata.negativePrompt)}
            {Array.from(
              {
                length: Math.max(
                  data.metadata.characters.length,
                  data.metadata.negativeCharacters.length,
                ),
              },
              (_, index) => (
                <div key={index}>
                  {textSection(
                    t("explore.characterPositive", { index: index + 1 }),
                    data.metadata.characters[index] ?? null,
                  )}
                  {textSection(
                    t("explore.characterNegative", { index: index + 1 }),
                    data.metadata.negativeCharacters[index] ?? null,
                  )}
                </div>
              ),
            )}
            {data.metadata.parameters.length > 0 && (
              <section>
                <h3>{t("explore.parameters")}</h3>
                <dl className="explore-parameters">
                  {data.metadata.parameters.map((parameter) => (
                    <div key={parameter.name}>
                      <dt>{parameter.name}</dt>
                      <dd>{parameter.value}</dd>
                    </div>
                  ))}
                </dl>
              </section>
            )}
            {(data.metadata.status === "available" || data.metadata.status === "partial") && (
              <Button disabled={actions.busy} onClick={prompts.previewRestore}>
                {t("explore.previewReplace")}
              </Button>
            )}
          </>
        )}
      </div>
      {largeOpen && (
        <Modal
          open
          wide
          className="explore-lightbox"
          title={item.title}
          onClose={() => setLargeOpen(false)}
          finalFocus={() => (returnFocus.current?.isConnected ? returnFocus.current : true)}
        >
          <ExploreImage item={item} variant="original" details />
        </Modal>
      )}
    </aside>
  );
}
