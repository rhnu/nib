import { Button, IconButton, Col, Row } from "@/shared/ui";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, X } from "lucide-react";
import type { ResourceSummary, ResourceFolder } from "@/bindings/workbench";
import { t, useTranslation, formatDate } from "@/shared/i18n";

import { errorMessage } from "@/shared/host/error";
import { PromptTextEditor } from "@/features/prompt/prompt-text-editor";
import { settingValue } from "@/features/prompt/settings";
import { ResourceCover } from "./resource-cover";
import { resourceQuery } from "./resource-queries";
import { folderPath } from "./resource-metadata";

export function ResourceInspector({
  item,
  count,
  folders,
  onClose,
  onEdit,
}: {
  item: ResourceSummary | undefined;
  count: number;
  folders: ResourceFolder[];
  onClose: () => void;
  onEdit: (id: string) => void;
}) {
  useTranslation();
  const client = useQueryClient();
  const query = useQuery({
    ...resourceQuery(client, item?.id ?? ""),
    enabled: !!item && count === 1,
  });
  const resource = query.data;
  return (
    <Col
      gap={0}
      align="stretch"
      as="aside"
      className="resource-inspector [&_.tag]:text-[10px] [&_.tag]:py-[1px] [&_.tag]:px-[5px] [&_.tag]:max-w-full [&_.tag]:overflow-hidden [&_.tag]:text-ellipsis [&_>_header]:mb-0 [&_.resource-cover]:aspect-[4/3] [&_.resource-cover]:shrink-0 [&_.resource-cover]:rounded-control [&_h3]:my-[1px] [&_h3]:mx-0 [&_h3]:text-title [&_h3]:wrap-anywhere [&_dl]:my-space-2 [&_dl]:mx-0 [&_dl]:text-caption [&_dt]:text-muted [&_dt]:mt-[11px] [&_dd]:my-[3px] [&_dd]:mx-0 [&_dd]:wrap-anywhere [&_dd]:flex-wrap [&_dd]:flex [&_dd]:gap-space-1 flex flex-col gap-space-3 min-w-0 py-[10px] px-[14px] border-l border-line-subtle overflow-auto max-[1050px]:absolute max-[1050px]:z-[5] max-[1050px]:right-0 max-[1050px]:top-0 max-[1050px]:bottom-0 max-[1050px]:w-[270px] max-[1050px]:bg-background max-[1050px]:[box-shadow:-5px_0_15px_#0003]"
    >
      <Row
        align="center"
        justify="between"
        gap={3}
        as="header"
        className="ui-heading flex items-center justify-between gap-space-3 min-w-0 min-h-control [&_>_:is(h2,_h3)]:m-0 [&_>_:is(h2,_h3)]:min-w-0 [&_>_:is(h2,_h3)]:text-section [&_>_:is(h2,_h3)]:font-semibold"
      >
        <strong>{t("library.inspector")}</strong>
        <IconButton label={t("library.closeInspector")} onClick={onClose}>
          <X size={15} />
        </IconButton>
      </Row>
      {count > 1 ? (
        <p className="empty-note text-muted text-label leading-[1.75] m-[3px_0]">
          {t("library.selectedCount", { count })}
        </p>
      ) : !item ? (
        <p className="empty-note text-muted text-label leading-[1.75] m-[3px_0]">
          {t("library.inspectHint")}
        </p>
      ) : (
        <>
          <ResourceCover assetId={item.coverAssetId} name={item.name} kind={item.kind} />
          <h3>{item.name}</h3>
          <Button onClick={() => onEdit(item.id)}>
            <Pencil size={14} />
            {t("library.edit")}
          </Button>
          {query.error && (
            <p className="inline-warning text-danger text-label leading-[1.7]" role="alert">
              {errorMessage(query.error)}
              <Button onClick={() => void query.refetch()}>{t("library.retryQuery")}</Button>
            </p>
          )}
          <p className="resource-description whitespace-pre-wrap wrap-anywhere text-label text-muted m-0">
            {item.description}
          </p>
          <dl>
            <dt>{t("library.folder")}</dt>
            <dd>{folderPath(item.folderId, folders)}</dd>
            {item.aliases.length > 0 && (
              <>
                <dt>{t("library.aliases")}</dt>
                <dd>{item.aliases.join(", ")}</dd>
              </>
            )}
            <dt>{t("library.tags")}</dt>
            <dd>
              {item.tags.length
                ? item.tags.map((tag) => (
                    <span
                      key={tag}
                      className="tag inline-flex items-center p-[1px_5px] leading-[19px] text-[10px] rounded-control bg-accent-soft text-accent whitespace-nowrap"
                    >
                      {tag}
                    </span>
                  ))
                : "—"}
            </dd>
            <dt>{t("library.models")}</dt>
            <dd>
              {item.models.length
                ? item.models.map((model) => settingValue("model", model)).join(", ")
                : t("library.unrestricted")}
            </dd>
            <dt>{t("library.updated")}</dt>
            <dd>{formatDate(item.updatedAt)}</dd>
          </dl>
          {resource?.content.kind === "chunk" && (
            <PromptTextEditor
              label={t("library.promptContent")}
              value={resource.content.text}
              readOnly
            />
          )}
          {resource?.content.kind === "preset" && (
            <div className="resource-preset-summary text-caption text-muted">
              <h4>{t("library.preset")}</h4>
              <p>
                {t("library.presetSummary", {
                  positive: resource.content.composition.positive.length,
                  negative: resource.content.composition.negative.length,
                  characters: resource.content.characters.length,
                })}
              </p>
            </div>
          )}
        </>
      )}
    </Col>
  );
}
