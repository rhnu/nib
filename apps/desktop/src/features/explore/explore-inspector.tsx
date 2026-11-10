import {
  IconButton,
  Button,
  Field,
  Modal,
  Notice,
  Select,
  ButtonGroup,
  Col,
  Row,
  Grid,
} from "@/shared/ui";

import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowDownToLine, Copy, Search, X } from "lucide-react";
import type { ExploreSummary } from "@/bindings/explore";
import { t, useTranslation } from "@/shared/i18n";

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
      <section className="explore-prompt-section my-[14px] mx-0 [&_>_header_h3]:m-0 [&_.icon-button]:[width:26px] [&_.icon-button]:[height:26px] [&_.icon-button]:[min-width:26px] [&_.icon-button]:p-space-1">
        <Row align="stretch" as="header" gap={3} justify="between" className="mb-space-2">
          <h3>{label}</h3>
          <ButtonGroup
            gap={3}
            wrap
            justify="end"
            className="ui-actions flex items-center justify-end flex-wrap gap-space-3"
          >
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
          </ButtonGroup>
        </Row>
        <p className="explore-prompt-text m-0 [max-height:230px] overflow-auto p-space-3 [border:1px_solid_var(--line-subtle)] bg-input font-mono text-label whitespace-pre-wrap [overflow-wrap:anywhere]">
          {text || t("explore.emptyPrompt")}
        </p>
      </section>
    );

  return (
    <Col
      gap={0}
      as="aside"
      className="explore-inspector [width:clamp(310px,_29vw,_400px)] min-w-0 [border-left:1px_solid_var(--line)] bg-panel [&_h3]:[margin:0_0_7px] [&_h3]:text-label [&_h3]:font-semibold max-[960px]:[width:320px] max-[700px]:w-full max-[700px]:[border:0]"
      aria-label={t("explore.inspector")}
    >
      <Row
        gap={4}
        align="center"
        justify="between"
        as="header"
        className="explore-inspector-heading py-[10px] px-space-4 [border-bottom:1px_solid_var(--line-subtle)] [&_h2]:m-0 [&_h2]:min-w-0 [&_h2]:text-section [&_h2]:[overflow-wrap:anywhere]"
      >
        <h2>{item.title}</h2>
        <IconButton label={t("common.close")} onClick={onClose}>
          <X size={16} aria-hidden />
        </IconButton>
      </Row>
      <div className="explore-inspector-scroll flex-1 overflow-y-auto p-space-4">
        <div className="explore-preview [&:hover_>_.explore-image-actions]:[opacity:1] [&:focus-within_>_.explore-image-actions]:[opacity:1] relative [border:1px_solid_var(--line-subtle)] bg-input [&_.explore-image]:[aspect-ratio:auto] [&_.explore-image]:[height:290px] [&_img]:object-contain [&_.explore-image-actions]:[bottom:6px]">
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
        <Row
          gap={0}
          align="stretch"
          wrap
          className="explore-item-facts [gap:4px_12px] [margin:8px_0_12px] text-caption text-muted"
        >
          <span>{item.author}</span>
          <span>{item.width > 0 && item.height > 0 ? `${item.width} × ${item.height}` : ""}</span>
          {item.rating && (
            <span>{t("explore.siteRating", { rating: t(`explore.rating_${item.rating}`) })}</span>
          )}
        </Row>
        <Grid
          align="stretch"
          gap={3}
          columns={1}
          className="explore-prompt-target [grid-template-columns:1fr_1fr] pb-space-4 [border-bottom:1px_solid_var(--line-subtle)] [&_.select-trigger]:w-full [&_.select-trigger]:min-w-0"
        >
          <Field label={t("explore.target")}>
            <Select
              value={
                targets.some((target) => target.key === prompts.target) ? prompts.target : "main"
              }
              onValueChange={prompts.onTarget}
              options={targets.map((target) => ({ value: target.key, label: target.label }))}
            />
          </Field>
          <Field label={t("explore.scope")}>
            <Select
              value={prompts.scope}
              onValueChange={(value) => prompts.onScope(value as "positive" | "negative")}
              options={[
                { value: "positive", label: t("prompt.positivePrompt") },
                { value: "negative", label: t("prompt.negativePrompt") },
              ]}
            />
          </Field>
        </Grid>
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
              <section className="explore-tag-group my-[14px] mx-0" key={group.category}>
                <h3>
                  {group.category in categoryKeys
                    ? t(categoryKeys[group.category as keyof typeof categoryKeys])
                    : group.category}
                </h3>
                <Row gap={0} align="stretch" wrap className="explore-tags gap-[5px]">
                  {group.tags.map((tag) => (
                    <Row
                      gap={0}
                      align="stretch"
                      as="span"
                      className="explore-tag [max-width:100%] [border:1px_solid_var(--line)] rounded-control bg-raised [&_>_button:first-child]:py-[3px] [&_>_button:first-child]:px-space-2 [&_>_button:first-child]:[border:0] [&_>_button:first-child]:[border-radius:0] [&_>_button:first-child]:[background:transparent] [&_>_button:first-child]:text-left [&_>_button:first-child]:[overflow-wrap:anywhere] [&_>_button[aria-pressed='true']]:text-accent [&_>_button[aria-pressed='true']]:[background:var(--accent-soft)] [&_>_.icon-button]:p-space-1 [&_>_.icon-button]:[height:26px] [&_>_.icon-button]:[min-width:23px] [&_>_.icon-button]:[width:23px] [&_>_.icon-button]:[border:0] [&_>_.icon-button]:[border-left:1px_solid_var(--line-subtle)] inline-flex"
                      key={tag}
                    >
                      <Button
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
                      </Button>
                      <IconButton
                        label={t("explore.searchTag", { tag })}
                        onClick={() => onSearchTag(tag)}
                      >
                        <Search size={12} aria-hidden />
                      </IconButton>
                    </Row>
                  ))}
                </Row>
              </section>
            ))}
            <section className="explore-basket my-[14px] mx-0 pt-space-4 [border-top:1px_solid_var(--line-subtle)] [&_.ui-actions]:mt-[10px]">
              <Row align="stretch" as="header" gap={3} justify="between" className="mb-space-2">
                <h3>{t("explore.selectedTags", { count: basket.length })}</h3>
                <Button disabled={!basket.length} onClick={() => onBasket([])}>
                  {t("explore.clear")}
                </Button>
              </Row>
              {basket.length > 0 && (
                <>
                  <Row gap={0} align="stretch" wrap className="explore-tags gap-[5px]">
                    {basket.map((tag) => (
                      <IconButton
                        label={t("explore.removeTag", { tag })}
                        className="explore-query-tag items-center gap-space-1 [max-width:100%] py-[2px] px-space-2 [border:1px_solid_var(--line)] rounded-control bg-raised [overflow-wrap:anywhere] [&_.icon-button]:[width:20px] [&_.icon-button]:[height:20px] [&_.icon-button]:[min-width:20px] [&_.icon-button]:p-0 [&_.icon-button]:[border:0]"
                        type="button"
                        key={tag}
                        aria-label={t("explore.removeTag", { tag })}
                        onClick={() => onBasket(basket.filter((value) => value !== tag))}
                      >
                        {tag.replaceAll("_", " ")}
                        <X size={12} aria-hidden />
                      </IconButton>
                    ))}
                  </Row>
                  <ButtonGroup
                    gap={3}
                    wrap
                    justify="end"
                    className="ui-actions flex items-center justify-end flex-wrap gap-space-3"
                  >
                    <Button disabled={actions.busy} onClick={prompts.appendTags}>
                      {t("explore.appendSelected")}
                    </Button>
                    <Button disabled={actions.busy} onClick={prompts.copyTags}>
                      {t("explore.copySelected")}
                    </Button>
                  </ButtonGroup>
                </>
              )}
            </section>
          </>
        )}
        {data?.source === "novelAi" && (
          <>
            {data.description && (
              <p className="muted text-muted explore-description whitespace-pre-wrap [overflow-wrap:anywhere]">
                {data.description}
              </p>
            )}
            <p className="muted text-muted">{t(`explore.metadata_${data.metadata.status}`)}</p>
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
                <Grid
                  align="stretch"
                  gap={0}
                  columns={1}
                  as="dl"
                  className="explore-parameters [grid-template-columns:1fr_1fr] [gap:8px_12px] [margin:8px_0_14px] [&_>_div]:min-w-0 [&_dt]:text-caption [&_dt]:text-muted [&_dd]:[margin:2px_0_0] [&_dd]:[overflow-wrap:anywhere] [&_dd]:text-label"
                >
                  {data.metadata.parameters.map((parameter) => (
                    <div key={parameter.name}>
                      <dt>{parameter.name}</dt>
                      <dd>{parameter.value}</dd>
                    </div>
                  ))}
                </Grid>
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
          className="explore-lightbox [&_>_.explore-image]:flex-1 [&_>_.explore-image]:min-h-0 [&_>_.explore-image]:[aspect-ratio:auto] [&_.explore-image_img]:object-contain"
          title={item.title}
          onClose={() => setLargeOpen(false)}
          finalFocus={() => (returnFocus.current?.isConnected ? returnFocus.current : true)}
        >
          <ExploreImage item={item} variant="original" details />
        </Modal>
      )}
    </Col>
  );
}
