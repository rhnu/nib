import { t, useTranslation } from "@/shared/i18n";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { errorMessage } from "@/shared/host/error";
import { Button, Field, Modal } from "@/shared/ui";
import { libraryApi } from "@/features/library/api";

export function ChunkPicker({
  onChoose,
  onClose,
}: {
  onChoose: (resourceId: string) => void;
  onClose: () => void;
}) {
  useTranslation();

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
    <Modal open onClose={onClose} title={t("prompt.addChunk")}>
      {loading && <output aria-live="polite">{t("prompt.loadingChunks")}</output>}
      {error && (
        <div className="inline-warning" role="alert">
          {error}
          <Button onClick={() => void query.refetch()}>{t("prompt.retryRead")}</Button>
        </div>
      )}
      <Field label={t("prompt.resource")}>
        <select
          value={selected}
          disabled={loading || !!error}
          onChange={(event) => setSelected(event.target.value)}
        >
          <option value="">{t("prompt.chooseChunk")}</option>
          {chunks.map((chunk) => (
            <option key={chunk.id} value={chunk.id}>
              {chunk.name}
            </option>
          ))}
        </select>
      </Field>
      {!loading && !error && chunks.length === 0 && (
        <p className="help-note">{t("prompt.noChunks")}</p>
      )}
      <div className="dialog-actions">
        <Button onClick={onClose}>{t("prompt.cancel")}</Button>
        <Button
          className="primary"
          disabled={!valid}
          onClick={() => {
            if (valid) onChoose(selected);
          }}
        >
          {t("prompt.add")}
        </Button>
      </div>
    </Modal>
  );
}
