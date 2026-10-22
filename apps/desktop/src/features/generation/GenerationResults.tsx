import { RotateCw } from "lucide-react";
import type { Draft } from "../../bindings/workbench";
import { Button, Notice } from "../../shared/ui";
import { useGeneration } from "./generation-context";
import { JobQueue } from "./JobQueue";
import { ResultGallery } from "./ResultGallery";

export function GenerationResults({
  onRestore,
  onUseSeed,
}: {
  onRestore: (draft: Draft) => void;
  onUseSeed: (seed: number) => void;
}) {
  const { results, queryError, refreshing, refresh } = useGeneration();
  return (
    <section className="generation-results" aria-label="生成任务与结果">
      <header className="generation-results-heading">
        <h2>生成结果</h2>
        <Button className="quiet" disabled={refreshing} onClick={() => void refresh()}>
          <RotateCw size={13} />
          {refreshing ? "正在刷新…" : "刷新"}
        </Button>
      </header>
      {queryError && (
        <Notice
          actions={
            <Button disabled={refreshing} onClick={() => void refresh()}>
              重试查询
            </Button>
          }
        >
          {queryError}
        </Notice>
      )}
      <div className="generation-results-content">
        <ResultGallery
          results={results?.filter((result) => result.kind === "image") ?? null}
          onRestore={onRestore}
          onUseSeed={onUseSeed}
          queryFailed={queryError !== null}
        />
        <JobQueue />
      </div>
    </section>
  );
}
