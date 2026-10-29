import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { errorMessage } from "../../shared/host/error";
import { Button, Field, Modal } from "../../shared/ui";
import { libraryApi } from "../library/api";

export function ChunkPicker({
  onChoose,
  onClose,
}: {
  onChoose: (resourceId: string) => void;
  onClose: () => void;
}) {
  const [selected, setSelected] = useState("");
  const query = useQuery({
    queryKey: ["resource-search", "", "chunk"],
    queryFn: () => libraryApi.search({ text: "", kind: "chunk" }),
    staleTime: 0,
  });
  const loading = query.isPending;
  const chunks = query.data ?? [];
  const error = query.error ? errorMessage(query.error) : "";
  const valid = chunks.some((chunk) => chunk.id === selected);
  return (
    <Modal open onClose={onClose} title="添加 Chunk">
      {loading && <output aria-live="polite">正在读取 Chunk 列表…</output>}
      {error && (
        <div className="inline-warning" role="alert">
          {error}
          <Button onClick={() => void query.refetch()}>重试读取</Button>
        </div>
      )}
      <Field label="资源">
        <select
          value={selected}
          disabled={loading || !!error}
          onChange={(event) => setSelected(event.target.value)}
        >
          <option value="">选择 Chunk…</option>
          {chunks.map((chunk) => (
            <option key={chunk.id} value={chunk.id}>
              {chunk.name}
            </option>
          ))}
        </select>
      </Field>
      {!loading && !error && chunks.length === 0 && (
        <p className="help-note">还没有 Chunk。请先在资源库中创建。</p>
      )}
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
