import { RotateCw } from "lucide-react";
import type { Draft } from "../../bindings/workbench";
import { Button, Notice } from "../../shared/ui";
import { useGeneration } from "./GenerationProvider";
import { JobQueue } from "./JobQueue";
import { ResultGallery } from "./ResultGallery";

export function GenerationResults({ onRestore }: { onRestore: (draft: Draft) => void }) {
  const { results, queryError, refreshing, refresh } = useGeneration();
  return (
    <section className="generation-results" aria-label="生成任务与结果">
      <header className="generation-results-heading">
        <h2>任务与结果</h2>
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
        <JobQueue />
        <ResultGallery results={results} onRestore={onRestore} queryFailed={queryError !== null} />
      </div>
    </section>
  );
}
