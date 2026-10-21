import { useState } from "react";
import type { Resource } from "../../bindings/workbench";
import { Button, Field, Modal } from "../../shared/ui";
export function ChunkPicker({
  resources,
  onChoose,
  onClose,
}: {
  resources: Map<string, Resource>;
  onChoose: (resourceId: string) => void;
  onClose: () => void;
}) {
  const [selected, setSelected] = useState("");
  const chunks = [...resources.values()].filter((resource) => resource.content.kind === "chunk");
  const valid = chunks.some((chunk) => chunk.id === selected);
  return (
    <Modal open onClose={onClose} title="添加 Chunk">
      <Field label="资源">
        <select value={selected} onChange={(event) => setSelected(event.target.value)}>
          <option value="">选择 Chunk…</option>
          {chunks.map((chunk) => (
            <option key={chunk.id} value={chunk.id}>
              {chunk.name}
            </option>
          ))}
        </select>
      </Field>
      {chunks.length === 0 && <p className="help-note">还没有 Chunk。请先在资源库中创建。</p>}
      <div className="dialog-actions">
        <Button onClick={onClose}>取消</Button>
        <Button
          className="primary"
          disabled={!valid}
          onClick={() => {
            if (valid) onChoose(selected);
          }}
        >
          添加
        </Button>
      </div>
    </Modal>
  );
}
