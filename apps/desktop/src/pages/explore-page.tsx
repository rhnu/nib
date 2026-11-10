import { Button, Modal, Notice, Select, notify, Row, Grid, ButtonGroup, Col } from "@/shared/ui";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useStore } from "zustand";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { ExploreSource, ExploreSummary } from "@/bindings/explore";
import type { ImageExportFormat, MetadataRestore } from "@/bindings/media";
import { useWorkbenchContext } from "@/features/workbench/workbench-context";
import { tagPromptTargets, appendRecognizedTags } from "@/features/media/tag-prompt";
import { promptApi } from "@/features/prompt/api";
import { formatLexiconTerms } from "@/features/prompt/format-runtime";
import { settingLabels, settingValue, type SettingKey } from "@/features/prompt/settings";
import { lexiconApi } from "@/features/lexicon/api";
import { exploreApi, danbooruApi, danbooruConnectionKey } from "@/features/explore/api";
import { exploreErrorMessage } from "@/features/explore/error";
import { ExploreImage } from "@/features/explore/explore-image";
import { ExploreImageActions } from "@/features/explore/image-actions";
import { saveExportedImage } from "@/features/media/image-export";
import { ExploreInspector } from "@/features/explore/explore-inspector";
import { ExploreQueryFields } from "@/features/explore/query-fields";
import { submitExploreQuery, updateExploreSource } from "@/features/explore/session";
import { trackPendingWork } from "@/shared/host/pending-work";
import { queryClient } from "@/shared/query/client";
import {
  t,
  useTranslation,
  useMessageState,
  MessageError,
  deferMessage,
  errorMessage,
} from "@/shared/i18n";

function ExploreSourceBrowser({ source }: { source: ExploreSource }) {
  useTranslation();
  const controller = useWorkbenchContext();
  const { exploreSession: store, state, workspace, options, editorCapabilities } = controller;
  const view = useStore(store, (value) => value.sources[source]);
  const connection = useQuery({
    queryKey: danbooruConnectionKey,
    queryFn: danbooruApi.status,
    retry: false,
    enabled: source === "danbooru",
  });
  const authRevision = source === "danbooru" ? connection.data?.revision : 0;
  const previousIdentity = useRef(authRevision);
  useEffect(() => {
    const previous = previousIdentity.current;
    previousIdentity.current = authRevision;
    if (
      source === "danbooru" &&
      previous !== undefined &&
      authRevision !== undefined &&
      previous !== authRevision
    )
      updateExploreSource(store, source, (current) => ({
        ...current,
        selected: null,
        basket: [],
        scroll: 0,
      }));
  }, [authRevision, source, store]);
  const search = useInfiniteQuery({
    queryKey: ["explore", "search", source, authRevision, view.applied, view.revision],
    queryFn: ({ pageParam }) => exploreApi.search(view.applied, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    enabled: source !== "danbooru" || connection.isSuccess,
    retry: false,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
  const scroller = useRef<HTMLDivElement>(null);
  const restoreScroll = useRef(true);
  useLayoutEffect(() => {
    const node = scroller.current;
    return () => {
      if (node)
        updateExploreSource(store, source, (current) => ({
          ...current,
          scroll: restoreScroll.current ? current.scroll : node.scrollTop,
        }));
    };
  }, [store, source]);
  useLayoutEffect(() => {
    if (restoreScroll.current && search.data && scroller.current) {
      scroller.current.scrollTop = store.getState().sources[source].scroll;
      restoreScroll.current = false;
    }
  }, [search.data, store, source]);
  const previousRevision = useRef(view.revision);
  useLayoutEffect(() => {
    if (previousRevision.current !== view.revision) {
      previousRevision.current = view.revision;
      restoreScroll.current = false;
      if (scroller.current) scroller.current.scrollTop = 0;
    }
  }, [view.revision]);
  const selected =
    view.selected && view.selected.key.authRevision === authRevision ? view.selected : null;
  const items =
    search.data?.pages
      .flatMap((page) => page.items)
      .filter((item) => item.key.authRevision === authRevision)
      .filter(
        (item, index, all) => all.findIndex((other) => other.key.id === item.key.id) === index,
      ) ?? [];
  const [busy, setBusy] = useState(false);
  const locked = useRef(false);
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const [error, setError] = useMessageState();
  const [target, setTarget] = useState("main");
  const [scope, setScope] = useState<"positive" | "negative">("positive");
  const [restore, setRestore] = useState<MetadataRestore | null>(null);

  const setSelected = (value: ExploreSummary | null) =>
    updateExploreSource(store, source, (current) => ({ ...current, selected: value }));

  const model =
    state.draft.settings.model ?? state.resolved?.settings.model ?? workspace.info.defaultModelId;
  const latestModel = useRef(model);
  useLayoutEffect(() => {
    latestModel.current = model;
  }, [model]);
  const syntax = useQuery({
    queryKey: ["prompt-syntax", model],
    queryFn: () => promptApi.syntax(model),
    staleTime: Infinity,
    retry: false,
  });

  const run = async (action: () => Promise<void>) => {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (cause) {
      if (active.current) setError(deferMessage(() => exploreErrorMessage(cause, source)));
    } finally {
      locked.current = false;
      if (active.current) setBusy(false);
    }
  };

  const checkIdentity = (item: ExploreSummary) => {
    if (
      item.key.source === "danbooru" &&
      queryClient.getQueryData<Awaited<ReturnType<typeof danbooruApi.status>>>(
        danbooruConnectionKey,
      )?.revision !== item.key.authRevision
    )
      throw new MessageError(deferMessage(() => t("explore.error_staleIdentity")));
  };

  const append = async (text: string) => {
    if (!active.current || !(await controller.guardNavigation()) || !active.current) return;
    await trackPendingWork(
      (async () => {
        if (latestModel.current !== model)
          throw new MessageError(deferMessage(() => t("explore.promptChanged")));
        const draft = state.readCurrentDraft();
        const destination = tagPromptTargets(draft, state.resources).find(
          (value) => value.key === target && !value.linked,
        );
        if (!destination) throw new MessageError(deferMessage(() => t("explore.targetChanged")));
        const next = appendRecognizedTags(draft, destination, text, scope);
        if (!next) throw new MessageError(deferMessage(() => t("explore.targetChanged")));
        state.edit(next);
      })(),
    );
    await options.navigate("create");
  };

  const formatTags = async () => {
    const profile = syntax.data;
    if (!profile) throw new MessageError(deferMessage(() => t("explore.syntaxUnavailable")));
    const tags = store.getState().sources[source].basket;
    // Use local NAI adaptations when installed; the shared formatter owns syntax escaping.
    const terms = await Promise.all(
      tags.map(async (tag) => {
        try {
          const result = await lexiconApi.search(tag, [], false, 5);
          return result.matches.find(({ term }) => term.name === tag)?.term.promptText ?? tag;
        } catch {
          return tag;
        }
      }),
    );
    return formatLexiconTerms(
      terms.map((name) => ({ name, weight: null })),
      profile,
    );
  };

  const copyText = (text: string) =>
    void run(async () => {
      await navigator.clipboard.writeText(text);
      notify(() => t("explore.copied"));
    });

  const useImage = (item: ExploreSummary, kind: "source" | "precise" | "vibe") =>
    void run(async () => {
      if (!(await controller.guardNavigation())) return;
      checkIdentity(item);
      await trackPendingWork(
        (async () => {
          const asset = await exploreApi.importImage(item.key);
          checkIdentity(item);
          if (!active.current) return;
          if (kind === "source")
            await controller.prepareImportedOperation(asset.id, "imageToImage");
          else await controller.prepareImportedReference(asset.id, kind);
        })(),
      );
    });

  const saveImage = (item: ExploreSummary, format: ImageExportFormat) =>
    void run(async () => {
      checkIdentity(item);
      const content = await exploreApi.exportImage(item.key, format);
      checkIdentity(item);
      if (active.current) await saveExportedImage(content, `${source}-${item.key.id}`);
    });

  const copyImage = (item: ExploreSummary, format: ImageExportFormat) =>
    void run(async () => {
      checkIdentity(item);
      await exploreApi.copyImage(item.key, format);
      if (active.current) notify(() => t("common.imageCopied"), "copy-image");
    });

  const actions = {
    busy,
    useImage,
    saveImage,
    copyImage,
    openWebsite: (item: ExploreSummary) => void run(() => openUrl(item.websiteUrl)),
    precise: editorCapabilities?.canAddPreciseReference ?? false,
    vibe: editorCapabilities?.canAddVibeReference ?? false,
  };

  const searchTag = (tag: string) => {
    updateExploreSource(store, source, (current) => ({
      ...current,
      query:
        current.query.source === "danbooru"
          ? { ...current.query, tags: tag }
          : { ...current.query, tags: [tag] },
    }));
    submitExploreQuery(store, source);
  };

  const previewRestore = () => {
    if (!selected) return;
    const item = selected;
    void run(async () => {
      checkIdentity(item);
      const preview = await exploreApi.restore(item.key);
      if (active.current && store.getState().sources[source].selected?.key.id === item.key.id)
        setRestore(preview);
    });
  };

  return (
    <>
      <div className="explore-toolbar py-space-4 px-space-5 [border-bottom:1px_solid_var(--line)] bg-panel">
        <Row
          gap={0}
          align="center"
          className="explore-source-row gap-[10px] mb-space-4 [&_>_.select-trigger]:[min-width:160px] [&_>_.select-trigger]:[width:auto] max-[700px]:flex-wrap max-[700px]:[&_>_.muted]:w-full"
        >
          <Select
            aria-label={t("explore.source")}
            value={source}
            onValueChange={(value) => store.setState({ source: value as ExploreSource })}
            options={[
              { value: "danbooru", label: t("explore.danbooru") },
              { value: "novelAi", label: t("explore.novelAi") },
            ]}
          />
          {source === "danbooru" && (
            <span className="muted text-muted">
              {connection.data?.state === "connected"
                ? t("explore.connectedAs", { username: connection.data.username ?? "" })
                : connection.data?.state === "invalid"
                  ? t("explore.error_unauthorized")
                  : t("explore.anonymousBrowsing")}
            </span>
          )}
        </Row>
        <ExploreQueryFields
          query={view.query}
          onChange={(query) =>
            updateExploreSource(store, source, (current) => ({ ...current, query }))
          }
          onSubmit={() => submitExploreQuery(store, source)}
          loading={search.isFetching}
        />
      </div>
      {selected && syntax.error && (
        <Notice
          actions={<Button onClick={() => void syntax.refetch()}>{t("explore.retry")}</Button>}
        >
          {t("explore.syntaxUnavailable")}
        </Notice>
      )}
      {error && (
        <Notice actions={<Button onClick={() => setError(null)}>{t("app.dismissNotice")}</Button>}>
          {error}
        </Notice>
      )}
      <Row
        gap={0}
        align="stretch"
        className={`explore-content flex-1 min-w-0 min-h-0 max-[700px]:[&.has-inspector_>_.explore-grid-scroll]:hidden ${selected ? "has-inspector" : ""}`}
      >
        <div
          ref={scroller}
          className="explore-grid-scroll flex-1 min-w-0 overflow-auto p-space-5 [scrollbar-gutter:stable]"
          aria-busy={search.isFetching}
        >
          {connection.error && source === "danbooru" && (
            <Notice
              actions={
                <Button onClick={() => void connection.refetch()}>{t("explore.retry")}</Button>
              }
            >
              {t("explore.connectionFailed")} {errorMessage(connection.error)}
            </Notice>
          )}
          {search.error && (
            <Notice
              actions={
                <Button
                  onClick={() =>
                    void (search.isFetchNextPageError ? search.fetchNextPage() : search.refetch())
                  }
                >
                  {t("explore.retry")}
                </Button>
              }
            >
              {exploreErrorMessage(search.error, source)}
            </Notice>
          )}
          {search.isPending && !search.error && !connection.error && (
            <Grid
              align="stretch"
              gap={0}
              columns={1}
              className="explore-state [min-height:280px] [place-content:center] text-muted"
            >
              <output>{t("explore.loading")}</output>
            </Grid>
          )}
          {search.isSuccess && !items.length && (
            <Grid
              align="stretch"
              gap={0}
              columns={1}
              className="explore-state [min-height:280px] [place-content:center] text-muted"
            >
              <p>{t("explore.empty")}</p>
            </Grid>
          )}
          {items.length > 0 && (
            <Grid
              gap={4}
              align="start"
              columns={1}
              className="explore-grid [grid-template-columns:repeat(auto-fill,_minmax(190px,_1fr))] max-[960px]:[grid-template-columns:repeat(auto-fill,_minmax(155px,_1fr))] max-[960px]:gap-[9px]"
            >
              {items.map((item) => (
                <article
                  className={`explore-card relative min-w-0 overflow-hidden [border:1px_solid_var(--line-subtle)] rounded-control bg-panel [&.is-selected]:[outline:2px_solid_var(--accent)] [&.is-selected]:[outline-offset:1px] [&:hover_>_.explore-image-actions]:[opacity:1] [&:focus-within_>_.explore-image-actions]:[opacity:1] ${selected?.key.id === item.key.id ? "is-selected" : ""}`}
                  key={JSON.stringify(item.key)}
                >
                  <ExploreImage item={item} onOpen={() => setSelected(item)} />
                  <ExploreImageActions
                    item={item}
                    actions={actions}
                    onInspect={() => setSelected(item)}
                  />
                  <Row
                    gap={3}
                    align="stretch"
                    justify="between"
                    className="explore-card-caption [min-height:29px] py-[5px] px-space-3 text-muted text-caption [&_>_span:first-child]:overflow-hidden [&_>_span:first-child]:text-ellipsis [&_>_span:first-child]:whitespace-nowrap [&_>_span:last-child]:shrink-0"
                  >
                    <span title={item.author ?? item.title}>{item.author ?? item.title}</span>
                    <span>{item.rating ? t(`explore.rating_${item.rating}`) : ""}</span>
                  </Row>
                </article>
              ))}
            </Grid>
          )}
          {search.hasNextPage && (
            <Row
              gap={0}
              align="stretch"
              justify="center"
              className="explore-load-more [padding:24px_0_12px]"
            >
              <Button disabled={search.isFetching} onClick={() => void search.fetchNextPage()}>
                {search.isFetchingNextPage ? t("explore.loading") : t("explore.loadMore")}
              </Button>
            </Row>
          )}
        </div>
        {selected && (
          <ExploreInspector
            key={JSON.stringify(selected.key)}
            item={selected}
            basket={view.basket}
            onBasket={(basket) =>
              updateExploreSource(store, source, (current) => ({ ...current, basket }))
            }
            onClose={() => setSelected(null)}
            onSearchTag={searchTag}
            actions={actions}
            prompts={{
              target,
              scope,
              onTarget: setTarget,
              onScope: setScope,
              appendText: (text) => void run(() => append(text)),
              copyText,
              appendTags: () =>
                void run(async () => {
                  const text = await trackPendingWork(formatTags());
                  await append(text);
                }),
              copyTags: () =>
                void run(async () => {
                  const text = await formatTags();
                  await navigator.clipboard.writeText(text);
                  notify(() => t("explore.copied"));
                }),
              previewRestore,
            }}
          />
        )}
      </Row>
      {restore && (
        <Modal open onClose={() => setRestore(null)} title={t("explore.replaceTitle")} wide>
          <Grid
            align="stretch"
            gap={4}
            columns={1}
            className="explore-restore-preview [&_h3]:[margin:0_0_7px] [&_h3]:text-label [&_h3]:font-semibold overflow-y-auto p-space-5"
          >
            <p>{t("explore.replaceHelp")}</p>
            {restore.notices.map((notice, index) => (
              <Notice key={index}>{errorMessage(notice)}</Notice>
            ))}
            {(["positive", "negative"] as const).map((part) => (
              <section key={part}>
                <h3>
                  {t(part === "positive" ? "prompt.positivePrompt" : "prompt.negativePrompt")}
                </h3>
                <p className="explore-prompt-text m-0 [max-height:230px] overflow-auto p-space-3 [border:1px_solid_var(--line-subtle)] bg-input font-mono text-label whitespace-pre-wrap [overflow-wrap:anywhere]">
                  {restore.draft.composition[part]
                    .map((node) => (node.kind === "text" ? node.text : ""))
                    .join("\n")}
                </p>
              </section>
            ))}
            <Grid
              align="stretch"
              gap={0}
              columns={1}
              as="dl"
              className="explore-parameters [grid-template-columns:1fr_1fr] [gap:8px_12px] [margin:8px_0_14px] [&_>_div]:min-w-0 [&_dt]:text-caption [&_dt]:text-muted [&_dd]:[margin:2px_0_0] [&_dd]:[overflow-wrap:anywhere] [&_dd]:text-label"
            >
              {Object.entries(restore.draft.settings)
                .filter(([, value]) => value !== null)
                .map(([key, value]) => (
                  <div key={key}>
                    <dt>{settingLabels[key as SettingKey]}</dt>
                    <dd>{settingValue(key as SettingKey, value)}</dd>
                  </div>
                ))}
            </Grid>
            {restore.draft.characters.map((character, index) => (
              <section key={character.id}>
                <h3>{t("explore.characterPositive", { index: index + 1 })}</h3>
                {(["positive", "negative"] as const).map((part) => (
                  <p
                    className="explore-prompt-text m-0 [max-height:230px] overflow-auto p-space-3 [border:1px_solid_var(--line-subtle)] bg-input font-mono text-label whitespace-pre-wrap [overflow-wrap:anywhere]"
                    key={part}
                  >
                    {character.composition[part]
                      .map((node) => (node.kind === "text" ? node.text : ""))
                      .join("\n")}
                  </p>
                ))}
              </section>
            ))}
            <ButtonGroup
              gap={3}
              wrap
              justify="end"
              className="ui-actions flex items-center justify-end flex-wrap gap-space-3"
            >
              <Button onClick={() => setRestore(null)}>{t("app.cancel")}</Button>
              <Button
                variant="primary"
                onClick={() => {
                  controller.guardedRestore(restore.draft);
                  setRestore(null);
                }}
              >
                {t("explore.applyReplace")}
              </Button>
            </ButtonGroup>
          </Grid>
        </Modal>
      )}
    </>
  );
}

/** The page is a source browser; its state belongs to the workspace controller. */
export function ExplorePage() {
  useTranslation();
  const { exploreSession } = useWorkbenchContext();
  const source = useStore(exploreSession, (state) => state.source);
  return (
    <Col
      gap={0}
      as="main"
      className="explore-page flex-1 min-w-0 min-h-0 overflow-hidden"
      aria-label={t("explore.title")}
    >
      <ExploreSourceBrowser key={source} source={source} />
    </Col>
  );
}
