import { Field, FilePicker, IconButton, TagInput, Grid, Row, Textarea } from "@/shared/ui";

import { useId, useState, useRef, useLayoutEffect } from "react";
import type { Resource, ResourceFolder } from "@/bindings/workbench";
import { t, useTranslation } from "@/shared/i18n";

import { ClipboardPaste, Image, X } from "lucide-react";
import { ImagePickerDialog } from "@/features/media/image-picker-dialog";
import { libraryApi } from "./api";
import { trackPendingWork } from "@/shared/host/pending-work";
import { ResourceModelSelect } from "./resource-model-select";
import { ResourceCover } from "./resource-cover";
import { folderAncestry } from "./resource-location";

/** Metadata is edited with the same draft and explicit save as the prompt content. */
export function ResourceMetadata({
  resource,
  models,
  folders,
  tags,
  onChange,
  onError,
  onCoverChange,
}: {
  resource: Resource;
  models: string[];
  folders: ResourceFolder[];
  tags: string[];
  onChange: (resource: Resource) => void;
  onError: (cause: unknown) => void;
  onCoverChange: (assetId: string, pending: boolean) => void;
}) {
  useTranslation();
  const fieldId = useId();
  const latest = useRef({ resource, onChange, onCoverChange, active: true, operation: 0 });
  useLayoutEffect(() => {
    Object.assign(latest.current, { resource, onChange, onCoverChange });
  }, [resource, onChange, onCoverChange]);
  useLayoutEffect(() => {
    const current = latest.current;
    current.active = true;
    return () => {
      current.active = false;
    };
  }, []);
  const [gallery, setGallery] = useState(false);
  const [busy, setBusy] = useState(false);

  const beginCover = () => {
    const current = latest.current;
    current.operation += 1;
    setBusy(true);
    return { id: resource.id, operation: current.operation };
  };

  const isCurrent = (request: { id: string; operation: number }) =>
    latest.current.active &&
    latest.current.resource.id === request.id &&
    latest.current.operation === request.operation;

  const importCover = async (file: Blob, request: { id: string; operation: number }) => {
    const asset = await libraryApi.importCover(
      request.id,
      Array.from(new Uint8Array(await file.arrayBuffer())),
    );
    if (isCurrent(request)) latest.current.onCoverChange(asset.id, true);
    else await libraryApi.discardCover(request.id, asset.id);
  };

  const coverWork = (action: (request: { id: string; operation: number }) => Promise<void>) => {
    const request = beginCover();
    void trackPendingWork(
      action(request)
        .catch((cause) => {
          if (isCurrent(request)) onError(cause);
        })
        .finally(() => {
          if (isCurrent(request)) setBusy(false);
        }),
    );
  };

  const paste = async (request: { id: string; operation: number }) => {
    const items = await navigator.clipboard.read();
    if (!isCurrent(request)) return;
    const item = items.find((item) => item.types.some((type) => type.startsWith("image/")));
    const type = item?.types.find((type) => type.startsWith("image/"));
    if (!item || !type) throw new Error(t("library.noClipboardImage"));
    const blob = await item.getType(type);
    if (isCurrent(request)) await importCover(blob, request);
  };

  const supersedeCover = () => {
    latest.current.operation += 1;
    setBusy(false);
  };

  return (
    <Grid
      gap={0}
      className="resource-metadata grid grid-cols-[160px_minmax(0,_1fr)] gap-space-5 items-start"
    >
      <div className="resource-metadata-cover [&_.resource-cover]:aspect-[4/3] [&_.resource-cover]:border [&_.resource-cover]:border-line-subtle [&_.resource-cover]:rounded-control relative">
        <ResourceCover
          assetId={resource.coverAssetId}
          name={resource.name}
          kind={resource.content.kind}
        />
        <Row
          gap={0}
          className="resource-cover-actions [&_.file-picker_button]:text-caption [&_.file-picker_button]:w-[28px] [&_.file-picker_button]:min-w-[28px] [&_.file-picker_button]:p-0 [&_.file-picker_button]:text-[0] [&_.file-picker_button]:gap-0 [&_.icon-button]:w-[28px] [&_.icon-button]:min-w-[28px] flex items-center flex-nowrap gap-[1px] mt-space-2 absolute left-[5px] bottom-[5px] right-auto p-[2px] m-0 bg-raised border border-line-subtle rounded-control"
        >
          <FilePicker
            label={t("library.coverFile")}
            title={t("library.coverFile")}
            accept="image/png,image/jpeg,image/webp"
            disabled={busy}
            onChoose={(file) => coverWork((request) => importCover(file, request))}
          />
          <IconButton
            label={t("library.coverGallery")}
            onClick={() => {
              supersedeCover();
              setGallery(true);
            }}
          >
            <Image size={15} />
          </IconButton>
          <IconButton
            label={t("library.coverClipboard")}
            disabled={busy}
            onClick={() => coverWork(paste)}
          >
            <ClipboardPaste size={15} />
          </IconButton>
          {resource.coverAssetId && (
            <IconButton
              label={t("library.removeCover")}
              onClick={() => {
                supersedeCover();
                onChange({ ...resource, coverAssetId: null });
              }}
            >
              <X size={15} />
            </IconButton>
          )}
        </Row>
      </div>
      <Grid
        gap={0}
        align="stretch"
        columns={1}
        className="resource-metadata-fields [&_textarea]:[resize:vertical] [&_textarea]:min-h-[54px] grid gap-[10px]"
      >
        <Field label={t("library.description")}>
          <Textarea
            autoComplete="off"
            rows={2}
            value={resource.description}
            onChange={(event) => onChange({ ...resource, description: event.target.value })}
          />
        </Field>
        <Grid
          gap={0}
          align="stretch"
          className="resource-metadata-grid grid grid-cols-2 gap-[10px] max-[1050px]:grid-cols-1"
        >
          <Field label={t("library.aliases")} htmlFor={`${fieldId}-aliases`}>
            <TagInput
              id={`${fieldId}-aliases`}
              value={resource.aliases}
              onValueChange={(aliases) => onChange({ ...resource, aliases })}
              removeLabel={(value) => t("common.removeTag", { value })}
              placeholder={t("common.tagInputPlaceholder")}
            />
          </Field>
          <Field label={t("library.tags")} htmlFor={`${fieldId}-tags`}>
            <TagInput
              id={`${fieldId}-tags`}
              value={resource.tags}
              suggestions={tags}
              onValueChange={(tags) => onChange({ ...resource, tags })}
              removeLabel={(value) => t("common.removeTag", { value })}
              placeholder={t("common.tagInputPlaceholder")}
            />
          </Field>
        </Grid>
        <Row
          gap={0}
          align="stretch"
          className="resource-saved-location [&_>_:last-child]:wrap-anywhere flex gap-space-3 min-w-0 text-muted text-caption"
        >
          <span>{t("library.folder")}</span>
          <span title={folderPath(resource.folderId, folders)}>
            {folderPath(resource.folderId, folders)}
          </span>
        </Row>
        <ResourceModelSelect
          models={models}
          value={resource.models}
          onChange={(models) => onChange({ ...resource, models })}
        />
      </Grid>
      <ImagePickerDialog
        open={gallery}
        title={t("library.coverGallery")}
        onClose={() => setGallery(false)}
        onSelect={(asset) => {
          supersedeCover();
          const current = latest.current;
          if (current.active && current.resource.id === resource.id)
            current.onCoverChange(asset.id, false);
        }}
      />
    </Grid>
  );
}

/** Display directory ancestry without exposing internal identities. */
export function folderPath(id: string | null, folders: ResourceFolder[]): string {
  return [
    t("library.rootFolder"),
    ...folderAncestry(id, folders).map((folder) => folder.name),
  ].join(" / ");
}
