import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import type { SkillConfig } from "@/bindings/agent";
import { Button, Col, Field, HelpMarker, Input, Modal, Notice, Row } from "@/shared/ui";
import { t } from "@/shared/i18n";
import { errorMessage } from "@/shared/host/error";
import { agentApi } from "./api";

/** Read only the selected skill document or an explicitly requested relative reference. */
export function SkillViewer({ skill, onClose }: { skill: SkillConfig; onClose: () => void }) {
  const [path, setPath] = useState("");
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const document = useQuery({
    queryKey: ["agent-skill-document", skill.id, selectedPath],
    queryFn: () => agentApi.readSkill(skill.id, selectedPath),
    retry: false,
  });
  return (
    <Modal open wide title={t("agent.viewSkill")} onClose={onClose}>
      <Col gap={4} className="min-h-0">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const next = path.trim() || null;
            if (next === selectedPath) void document.refetch();
            else setSelectedPath(next);
          }}
        >
          <Field
            label={t("agent.skillReference")}
            help={
              <HelpMarker label={t("agent.skillReference")}>
                {t("agent.skillReferenceHelp")}
              </HelpMarker>
            }
          >
            <Row gap={2} className="w-full">
              <Input
                value={path}
                onChange={(event) => setPath(event.target.value)}
                placeholder="SKILL.md"
                spellCheck={false}
              />
              <Button type="submit" disabled={document.isFetching}>
                {t("agent.readDocument")}
              </Button>
            </Row>
          </Field>
        </form>
        {document.isPending ? (
          <p>{t("agent.loadingSettings")}</p>
        ) : document.error ? (
          <Notice
            actions={<Button onClick={() => void document.refetch()}>{t("app.reload")}</Button>}
          >
            {errorMessage(document.error)}
          </Notice>
        ) : (
          <>
            <span className="text-label text-muted break-all">{document.data.path}</span>
            <pre className="m-0 whitespace-pre-wrap break-words overflow-auto max-h-[60vh] text-body select-text">
              {document.data.content}
            </pre>
          </>
        )}
      </Col>
    </Modal>
  );
}
