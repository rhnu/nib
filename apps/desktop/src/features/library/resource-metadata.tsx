import { useState, useRef, useLayoutEffect } from "react";
import type { Resource, ResourceFolder } from "@/bindings/workbench";
import { t, useTranslation } from "@/shared/i18n";
import { Field, FilePicker, IconButton } from "@/shared/ui";
import { ClipboardPaste, Image, X } from "lucide-react";
import { ImagePickerDialog } from "@/features/media/image-picker-dialog";
import { libraryApi } from "./api";
import { trackPendingWork } from "@/shared/host/pending-work";
import { settingValue } from "@/features/prompt/settings";
import { splitLabels } from "./resource-edit";
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
    <div className="resource-metadata">
      <div className="resource-metadata-cover">
        <ResourceCover
          assetId={resource.coverAssetId}
          name={resource.name}
          kind={resource.content.kind}
        />
        <div className="resource-cover-actions">
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
        </div>
      </div>
      <div className="resource-metadata-fields">
        <Field label={t("library.description")}>
          <textarea
            rows={2}
            value={resource.description}
            onChange={(event) => onChange({ ...resource, description: event.target.value })}
          />
        </Field>
        <div className="resource-metadata-grid">
          <Field label={t("library.aliases")}>
            <input
              value={resource.aliases.join(", ")}
              onChange={(event) =>
                onChange({
                  ...resource,
                  aliases: event.target.value.split(/[,，]/).map((value) => value.trimStart()),
                })
              }
              onBlur={() =>
                onChange({ ...resource, aliases: splitLabels(resource.aliases.join(",")) })
              }
            />
          </Field>
          <Field label={t("library.tags")}>
            <input
              list="library-shared-tags"
              value={resource.tags.join(", ")}
              onChange={(event) =>
                onChange({
                  ...resource,
                  tags: event.target.value.split(/[,，]/).map((value) => value.trimStart()),
                })
              }
              onBlur={() => onChange({ ...resource, tags: splitLabels(resource.tags.join(",")) })}
            />
            <datalist id="library-shared-tags">
              {tags.map((tag) => (
                <option value={tag} key={tag}>
                  {tag}
                </option>
              ))}
            </datalist>
          </Field>
        </div>
        <div className="resource-saved-location">
          <span>{t("library.folder")}</span>
          <span title={folderPath(resource.folderId, folders)}>
            {folderPath(resource.folderId, folders)}
          </span>
        </div>
        <fieldset className="resource-models">
          <legend>{t("library.models")}</legend>
          <small className="muted">{t("library.modelsHint")}</small>
          <div>
            {[...new Set([...models, ...resource.models])].map((model) => (
              <label key={model}>
                <input
                  type="checkbox"
                  checked={resource.models.includes(model)}
                  onChange={(event) =>
                    onChange({
                      ...resource,
                      models: event.target.checked
                        ? [...resource.models, model]
                        : resource.models.filter((item) => item !== model),
                    })
                  }
                />
                {settingValue("model", model)}
              </label>
            ))}
          </div>
        </fieldset>
      </div>
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
    </div>
  );
}

/** Display directory ancestry without exposing internal identities. */
export function folderPath(id: string | null, folders: ResourceFolder[]): string {
  return [
    t("library.rootFolder"),
    ...folderAncestry(id, folders).map((folder) => folder.name),
  ].join(" / ");
}
