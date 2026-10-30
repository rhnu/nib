import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Popover } from "@base-ui/react/popover";
import { Circle, LoaderCircle } from "lucide-react";
import { errorMessage } from "@/shared/host/error";
import { useDebouncedValue } from "@/shared/query/use-debounced-value";
import { promptApi } from "./api";
import "./text-assist.css";

/** Literal prompt text uses the actual model and shares local counts across editors and readers. */
export function PromptTextEditor({
  value,
  onChange,
  label,
  placeholder,
  model,
  disabled = false,
  readOnly = false,
  tokenUnavailableLabel = "等待实际模型",
}: {
  value: string;
  onChange?: (text: string) => void;
  label: string;
  placeholder?: string;
  model?: string;
  disabled?: boolean;
  readOnly?: boolean;
  tokenUnavailableLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const key = JSON.stringify([model, value]);
  const settledKey = useDebouncedValue(key, 160);
  const ready = settledKey === key;
  const query = useQuery({
    queryKey: ["prompt-tokens", model, value, "content_only"],
    queryFn: () => promptApi.inspectTokens(model!, value, "content_only"),
    enabled: Boolean(model) && ready,
    staleTime: Infinity,
    gcTime: 60_000,
    retry: false,
    refetchOnWindowFocus: false,
  });
  const count = ready ? query.data?.count.used : undefined;
  const error = ready && query.error ? errorMessage(query.error) : "";
  const pending = Boolean(model) && (!ready || query.isPending);
  const status = !model
    ? tokenUnavailableLabel
    : error
      ? `Token 计算失败：${error}`
      : count === undefined
        ? "正在计算 Token…"
        : `${count.toLocaleString()} Token`;
  return (
    <div className={`prompt-text-editor${readOnly ? " prompt-text-readonly" : ""}`}>
      <textarea
        aria-label={label}
        spellCheck={false}
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        readOnly={readOnly}
        onChange={onChange ? (event) => onChange(event.target.value) : undefined}
      />
      <Popover.Root open={open} onOpenChange={setOpen}>
        <Popover.Trigger
          className={`prompt-token-indicator icon-button${error ? " danger" : ""}`}
          aria-label={`${label} · ${status}`}
          openOnHover
          onFocus={(event) => {
            if (event.currentTarget.matches(":focus-visible")) setOpen(true);
          }}
        >
          {pending ? (
            <LoaderCircle size={13} className="spin" aria-hidden />
          ) : (
            <Circle size={13} aria-hidden />
          )}
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Positioner side="top" align="end" sideOffset={5} className="help-positioner">
            <Popover.Popup className="prompt-token-popup" initialFocus={false}>
              <Popover.Description>{status}</Popover.Description>
              {error && (
                <button type="button" onClick={() => void query.refetch()}>
                  重试
                </button>
              )}
            </Popover.Popup>
          </Popover.Positioner>
        </Popover.Portal>
      </Popover.Root>
    </div>
  );
}
