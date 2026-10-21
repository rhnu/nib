import { useState } from "react";
import type { Draft, Resource, ResolvedDraft } from "../../bindings/workbench";
import { Library, PanelLeftClose, PanelLeftOpen, ScanText } from "lucide-react";
import { Button, IconButton } from "../../shared/ui";
import { CompositionEditor } from "../prompt/CompositionEditor";
import { ResolutionInspector } from "../prompt/ResolutionInspector";
import { promptApi } from "../prompt/api";
import { errorMessage } from "../../shared/host/error";
import type { InsertTarget } from "../library/ResourceLibrary";
export function PromptWorkspace({
  draft,
  resources,
  resolved,
  resolving,
  resolveError,
  contextOpen,
  toggleContext,
  openLibrary,
  edit,
  setError,
}: {
  draft: Draft;
  resources: Map<string, Resource>;
  resolved: ResolvedDraft | null;
  resolving: boolean;
  resolveError: string;
  contextOpen: boolean;
  toggleContext: () => void;
  openLibrary: (target: InsertTarget) => void;
  edit: (draft: Draft) => void;
  setError: (message: string) => void;
}) {
  const [inspector, setInspector] = useState(false);
  return (
    <>
      <header className="editor-toolbar">
        <div className="button-group">
          <IconButton label={contextOpen ? "收起上下文" : "显示上下文"} onClick={toggleContext}>
            {contextOpen ? <PanelLeftClose size={17} /> : <PanelLeftOpen size={17} />}
          </IconButton>
          <span className="editor-label">提示词组合</span>
        </div>
        <div className="button-group">
          <Button onClick={() => openLibrary("positive")}>
            <Library size={15} />
            资源库
          </Button>
          <Button
            className={inspector ? "active-button" : ""}
            aria-pressed={inspector}
            onClick={() => setInspector(!inspector)}
          >
            <ScanText size={15} />
            解析
          </Button>
        </div>
      </header>
      <div className={`editing-area ${inspector ? "with-inspector" : ""}`}>
        <div className="editor-scroll">
          <CompositionEditor
            value={draft.composition}
            resources={resources}
            onChange={(composition) => edit({ ...draft, composition })}
            addChunk={openLibrary}
            expandChunk={async (node) => {
              try {
                return await promptApi.expandChunk(node);
              } catch (cause) {
                setError(errorMessage(cause));
                return node;
              }
            }}
          />
        </div>
        {inspector && (
          <ResolutionInspector
            resolved={resolved}
            pending={resolving}
            error={resolveError}
            draft={draft}
            resources={resources}
          />
        )}
      </div>
    </>
  );
}
