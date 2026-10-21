import { useState } from "react";
import { ImageOff } from "lucide-react";
import type { Draft } from "../../bindings/workbench";
import type { GenerationResult } from "../../bindings/generation";
import { Button } from "../../shared/ui";
import { ResultDetail } from "./ResultDetail";
import { useResultImage } from "./use-result-image";

function ResultTile({ result, onOpen }: { result: GenerationResult; onOpen: () => void }) {
  const image = useResultImage(result.id, result.mimeType, result.available);
  return (
    <div className="generation-result-tile">
      <Button
        className="generation-result-open"
        onClick={onOpen}
        aria-label={`查看结果：${new Date(result.createdAt).toLocaleString()}，种子 ${result.seed}`}
      >
        <span className="generation-result-preview">
          {!result.available ? (
            <span className="generation-muted">
              <ImageOff size={22} />
              媒体缺失
            </span>
          ) : image.error ? (
            <span className="generation-danger">
              <ImageOff size={22} />
              读取失败
            </span>
          ) : image.url ? (
            <img src={image.url} alt="" loading="lazy" onError={image.failed} />
          ) : (
            <span className="generation-muted">读取中…</span>
          )}
        </span>
        <span className="generation-result-caption">
          <span>种子 {result.seed}</span>
          <small>{new Date(result.createdAt).toLocaleString()}</small>
        </span>
      </Button>
      {image.error && (
        <Button className="quiet" onClick={image.retry}>
          重试读取
        </Button>
      )}
    </div>
  );
}

export function ResultGallery({
  results,
  onRestore,
  queryFailed,
}: {
  results: GenerationResult[] | null;
  onRestore: (draft: Draft) => void;
  queryFailed: boolean;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [visibleCount, setVisibleCount] = useState(12);
  const selected = results?.find((result) => result.id === selectedId);
  return (
    <section className="generation-gallery" aria-label="已保存的生成结果">
      <div className="generation-section-heading">
        <h3>已保存结果</h3>
        {results && <span className="generation-muted">{results.length} 张</span>}
      </div>
      {results === null ? (
        <output className="generation-muted">
          {queryFailed ? "尚未读取结果，请重试查询。" : "正在读取结果…"}
        </output>
      ) : results.length === 0 ? (
        <p className="generation-muted">完成后的最终图像会保留在这里，重新打开应用后仍可查看。</p>
      ) : (
        <>
          <div className="generation-result-grid">
            {results.slice(0, visibleCount).map((result) => (
              <ResultTile key={result.id} result={result} onOpen={() => setSelectedId(result.id)} />
            ))}
          </div>
          {results.length > visibleCount && (
            <Button
              className="generation-show-more"
              onClick={() => setVisibleCount((value) => value + 12)}
            >
              显示更多结果（还有 {results.length - visibleCount} 张）
            </Button>
          )}
        </>
      )}
      {selected && (
        <ResultDetail
          key={selected.id}
          result={selected}
          onClose={() => setSelectedId(null)}
          onRestore={onRestore}
        />
      )}
    </section>
  );
}
