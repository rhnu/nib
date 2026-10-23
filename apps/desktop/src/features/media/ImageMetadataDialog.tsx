import { useEffect, useRef, useState, type ReactNode } from "react";
import type { KnownImageMetadata, MediaAsset, MetadataRestore } from "../../bindings/media";
import type { Draft } from "../../bindings/workbench";
import { errorMessage } from "../../shared/host/error";
import { ActionsMenu, Button, Modal, Notice } from "../../shared/ui";
import { useMediaTools } from "./MediaToolsContext";
import { mediaApi } from "./api";
import { imageName, imageUnavailableReason } from "./model";
import { useMediaQuery } from "./useMediaQuery";
import "./media.css";
import { settingLabels, settingValue, type SettingKey } from "../prompt/settings";

const statusLabels = {
  parsed: "已解析已知生成信息",
  notPresent: "图片未包含可识别的生成信息",
  unsupportedFormat: "此图片格式不支持元信息检查",
  invalid: "图片中的元信息无效",
};
const origins = {
  png_text: "PNG 文本块",
  exif_user_comment: "EXIF UserComment",
  stealth_png_comp: "Stealth PNG",
};

function MetadataField({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value ?? "未记录"}</dd>
    </div>
  );
}

function KnownFields({ metadata }: { metadata: KnownImageMetadata }) {
  return (
    <>
      <dl className="media-metadata-fields">
        <MetadataField
          label="元信息载体"
          value={
            metadata.origin === null ? null : `${origins[metadata.origin]} (${metadata.origin})`
          }
        />
        <MetadataField label="模型" value={metadata.model} />
        <MetadataField label="种子" value={metadata.seed} />
        <MetadataField
          label="尺寸"
          value={metadata.size && `${metadata.size.width} × ${metadata.size.height}`}
        />
        <MetadataField label="步数" value={metadata.steps} />
        <MetadataField label="采样器" value={metadata.sampler} />
        <MetadataField label="Guidance" value={metadata.scale} />
        <MetadataField label="Noise Schedule" value={metadata.noiseSchedule} />
        <MetadataField label="CFG Rescale" value={metadata.cfgRescale} />
        <MetadataField label="旧版 UC 索引" value={metadata.ucPreset} />
        <MetadataField
          label="质量标签开关"
          value={metadata.qualityToggle === null ? null : String(metadata.qualityToggle)}
        />
        <MetadataField label="来源" value={metadata.source} />
        <MetadataField label="软件" value={metadata.software} />
        <MetadataField label="嵌入 Vibe 条目数" value={metadata.embeddedVibeCount} />
      </dl>
      <section className="media-literal-content">
        <h3>图片记录的正面提示词</h3>
        <pre>{metadata.prompt ?? "（未记录）"}</pre>
        <h3>图片记录的负面提示词</h3>
        <pre>{metadata.negativePrompt ?? "（未记录）"}</pre>
      </section>
      {metadata.characters.length > 0 && (
        <section className="media-literal-content">
          <h3>角色文字</h3>
          <p className="muted">保留图片中的角色索引。文字不代表完整角色位置或可恢复的参考材料。</p>
          {metadata.characters.map((character, index) => (
            <div key={index}>
              <h4>源角色索引 {character.sourceIndex}</h4>
              <span className="muted">正面</span>
              <pre>{character.prompt ?? "（未记录）"}</pre>
              <span className="muted">负面</span>
              <pre>{character.negativePrompt ?? "（未记录）"}</pre>
            </div>
          ))}
        </section>
      )}
    </>
  );
}

function RestorePreview({
  restore,
  confirm,
  cancel,
}: {
  restore: MetadataRestore;
  confirm: () => void;
  cancel: () => void;
}) {
  const { draft, notices } = restore;
  return (
    <section className="metadata-restore-preview" aria-label="恢复替换预览">
      <h3>恢复到当前创作</h3>
      <p>将替换当前提示词、配方、设置、角色和图像/参考输入，并自动保存。此操作不会发起生成。</p>
      <ul className="media-notices">
        {notices.map((notice, index) => (
          <li key={index}>{notice}</li>
        ))}
      </ul>
      <details open className="media-literal-content">
        <summary>即将使用的内容</summary>
        <h4>正面提示词</h4>
        <pre>
          {draft.composition.positive
            .map((node) =>
              node.kind === "text" ? node.text : (node.overrideText ?? `Chunk ${node.resourceId}`),
            )
            .join("\n") || "（空）"}
        </pre>
        <h4>负面提示词</h4>
        <pre>
          {draft.composition.negative
            .map((node) =>
              node.kind === "text" ? node.text : (node.overrideText ?? `Chunk ${node.resourceId}`),
            )
            .join("\n") || "（空）"}
        </pre>
        <h4>已知设置</h4>
        <dl className="media-metadata-fields">
          {Object.entries(draft.settings)
            .filter(([, value]) => value !== null)
            .map(([key, value]) => (
              <MetadataField
                key={key}
                label={settingLabels[key as SettingKey]}
                value={settingValue(key as SettingKey, value)}
              />
            ))}
        </dl>
        <p className="muted">
          配方 {draft.presets.length} 项 · 角色 {draft.characters.length} 项 · 操作{" "}
          {draft.inputs.operation.kind === "textToImage" ? "文生图" : "图片操作"}
        </p>
      </details>
      <div className="media-dialog-actions">
        <Button onClick={cancel}>保留当前创作</Button>
        <Button className="primary" onClick={confirm}>
          替换当前创作
        </Button>
      </div>
    </section>
  );
}

function MetadataDialogContent({
  asset,
  onClose,
  onRestore,
  onOpenTool,
}: {
  asset: MediaAsset;
  onClose: () => void;
  onRestore?: (draft: Draft) => void;
  onOpenTool?: () => void;
}) {
  const tools = useMediaTools();
  const unavailable = imageUnavailableReason(asset);
  const report = useMediaQuery(unavailable ? null : asset.id, mediaApi.metadata);
  const [restore, setRestore] = useState<MetadataRestore | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const current = useRef({ active: true, locked: false });
  useEffect(() => {
    const state = current.current;
    state.active = true;
    return () => {
      state.active = false;
    };
  }, []);
  const prepareRestore = async () => {
    if (current.current.locked) return;
    current.current.locked = true;
    setRestoring(true);
    setRestoreError(null);
    try {
      const preview = await mediaApi.restoreMetadata(asset.id);
      if (current.current.active) setRestore(preview);
    } catch (cause) {
      if (current.current.active) setRestoreError(errorMessage(cause));
    } finally {
      current.current.locked = false;
      if (current.current.active) setRestoring(false);
    }
  };
  return (
    <Modal open onClose={onClose} title="图片元信息" wide>
      <div className="media-metadata-dialog">
        <p className="media-asset-heading">
          {imageName(asset)} · {asset.mimeType}
        </p>
        {tools && asset.mimeType === "image/png" && (
          <ActionsMenu
            label="图片高级操作"
            items={[
              {
                label: "PNG 文本",
                disabled: Boolean(unavailable),
                action: () => {
                  onClose();
                  onOpenTool?.();
                  tools.onPngText(asset);
                },
              },
            ]}
          />
        )}
        {unavailable && <Notice>{unavailable}</Notice>}
        {report.loading && <output>正在检查 PNG / JPEG / WebP 元信息…</output>}
        {report.error && (
          <Notice actions={<Button onClick={report.retry}>重试检查</Button>}>{report.error}</Notice>
        )}
        {report.value && (
          <>
            <output>{statusLabels[report.value.status]}</output>
            {report.value.warnings.length > 0 && (
              <ul className="media-notices" aria-label="元信息提示">
                {report.value.warnings.map((warning, index) => (
                  <li key={index}>{warning}</li>
                ))}
              </ul>
            )}
            {report.value.generation && <KnownFields metadata={report.value.generation} />}
            {onRestore && report.value.status === "parsed" && !restore && (
              <Button disabled={restoring || !!unavailable} onClick={() => void prepareRestore()}>
                {restoring
                  ? "正在读取恢复预览…"
                  : restoreError
                    ? "重试读取恢复预览"
                    : "预览恢复已知生成内容"}
              </Button>
            )}
          </>
        )}
        {restoreError && <Notice>{restoreError}</Notice>}
        {restore && onRestore && (
          <RestorePreview
            restore={restore}
            cancel={() => {
              setRestore(null);
              setRestoreError(null);
            }}
            confirm={() => {
              onRestore(restore.draft);
              onClose();
            }}
          />
        )}
      </div>
    </Modal>
  );
}

export function ImageMetadataDialog(props: {
  asset: MediaAsset;
  onClose: () => void;
  onRestore?: (draft: Draft) => void;
  onOpenTool?: () => void;
}) {
  return <MetadataDialogContent key={props.asset.id} {...props} />;
}
