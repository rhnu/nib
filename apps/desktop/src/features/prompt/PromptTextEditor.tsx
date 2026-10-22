import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import type {
  FramingPolicy,
  SuggestTagsRequest,
  SuggestTagsResult,
  TokenInspection,
} from "../../bindings/workbench";
import { Button, Modal } from "../../shared/ui";
import { promptApi } from "./api";
import { insertAtSelection } from "./text-assist";
import { useAssistRequest } from "./useAssistRequest";
import "./text-assist.css";

function ModelSelect({
  models,
  model,
  onChange,
}: {
  models: string[];
  model: string;
  onChange: (model: string) => void;
}) {
  return (
    <label className="field">
      <span>检视 / 建议模型</span>
      <select value={model} onChange={(event) => onChange(event.target.value)}>
        {!model && <option value="">模型尚未加载</option>}
        {models.map((item) => (
          <option key={item} value={item}>
            {item}
          </option>
        ))}
      </select>
    </label>
  );
}

function TagSuggestions({
  models,
  model,
  onModelChange,
  initialQuery,
  insert,
  close,
}: {
  models: string[];
  model: string;
  onModelChange: (model: string) => void;
  initialQuery: string;
  insert: (tag: string) => void;
  close: () => void;
}) {
  const [query, setQuery] = useState(initialQuery);
  const [language, setLanguage] = useState<SuggestTagsRequest["language"]>("en");
  const input = useRef<HTMLInputElement>(null);
  const results = useRef<HTMLUListElement>(null);
  const request = useAssistRequest<SuggestTagsResult>(JSON.stringify([model, query, language]));
  useLayoutEffect(() => input.current?.focus(), []);
  const search = () => {
    if (model && query.trim() && !request.pending)
      void request.run(() => promptApi.suggestTags({ model, prompt: query, language }));
  };
  const choices =
    request.value === null
      ? null
      : Array.isArray(request.value)
        ? request.value.map((tag) => ({
            text: tag.en_tag,
            label: `${tag.jp_tag} → ${tag.en_tag}`,
            ranking: `power: ${tag.power}`,
          }))
        : request.value.tags.map((tag) => ({
            text: tag.tag,
            label: tag.tag,
            ranking: `count: ${tag.count} · confidence: ${tag.confidence}`,
          }));
  const navigateResults = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const buttons = results.current?.querySelectorAll<HTMLButtonElement>("button");
    if (!buttons?.length) return;
    const next =
      event.key === "ArrowDown"
        ? (index + 1) % buttons.length
        : event.key === "ArrowUp"
          ? (index + buttons.length - 1) % buttons.length
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? buttons.length - 1
              : null;
    if (next !== null) {
      event.preventDefault();
      buttons[next]?.focus();
    }
  };
  return (
    <section
      className="tag-assistance"
      aria-label="标签建议"
      onKeyDownCapture={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          close();
        }
      }}
    >
      <ModelSelect models={models} model={model} onChange={onModelChange} />
      <div className="tag-query-row">
        <label className="field">
          <span>建议语言</span>
          <select
            value={language}
            onChange={(event) => setLanguage(event.target.value as SuggestTagsRequest["language"])}
          >
            <option value="en">English</option>
            <option value="jp">日本語</option>
          </select>
        </label>
        <label className="field tag-query-field">
          <span>标签关键字</span>
          <input
            ref={input}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                search();
              } else if (event.key === "ArrowDown" && choices?.length) {
                event.preventDefault();
                results.current?.querySelector<HTMLButtonElement>("button")?.focus();
              }
            }}
          />
        </label>
      </div>
      <div className="button-group">
        <Button disabled={!model || !query.trim() || request.pending} onClick={search}>
          {request.pending ? "查询中…" : request.error ? "重试查询" : "查询标签"}
        </Button>
        <Button className="quiet" onClick={close}>
          关闭建议
        </Button>
      </div>
      <p className="muted tag-assist-help">
        查询需要 NovelAI
        凭据和网络。保持服务端顺序；日文建议插入对应英文标签。选择后替换原文本选区或插入原光标位置。
      </p>
      {request.error && (
        <p role="alert" className="inline-warning">
          {request.error}
        </p>
      )}
      <div aria-live="polite" className="tag-query-status">
        {request.pending && "正在获取标签建议…"}
        {choices?.length === 0 && "没有匹配的标签。可修改关键字后重试。"}
      </div>
      {choices && choices.length > 0 && (
        <ul className="tag-suggestions" ref={results} aria-label="服务端顺序的标签建议">
          {choices.map((choice, index) => (
            <li key={index}>
              <button
                type="button"
                onClick={() => insert(choice.text)}
                onKeyDown={(event) => navigateResults(event, index)}
              >
                <span>{choice.label}</span>
                <small>{choice.ranking}</small>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function TokenInspector({
  text,
  models,
  model,
  onModelChange,
}: {
  text: string;
  models: string[];
  model: string;
  onModelChange: (model: string) => void;
}) {
  const [framing, setFraming] = useState<FramingPolicy>("content_only");
  const { run, value, pending, error } = useAssistRequest<TokenInspection>(
    JSON.stringify([model, text, framing]),
  );
  useEffect(() => {
    if (model) void run(() => promptApi.inspectTokens(model, text, framing));
  }, [model, text, framing, run]);
  return (
    <div className="token-inspector">
      <p className="muted">
        本地检视当前片段的字面文本，无需凭据或生成任务。未展开其他片段、配方，也未追加质量或 UC
        标签；生成栏显示实际提交文本的用量。
      </p>
      <ModelSelect models={models} model={model} onChange={onModelChange} />
      <label className="field">
        <span>Framing</span>
        <select
          value={framing}
          onChange={(event) => setFraming(event.target.value as FramingPolicy)}
        >
          <option value="content_only">content_only · 仅文本内容</option>
          <option value="model_input">model_input · 含模型 framing</option>
        </select>
      </label>
      <label className="field">
        <span>检视的字面文本</span>
        <textarea readOnly value={text} spellCheck={false} />
      </label>
      <div aria-live="polite">{pending && "正在本地计算 Token…"}</div>
      {error && (
        <div className="inline-warning" role="alert">
          <p>{error}</p>
          <Button onClick={() => void run(() => promptApi.inspectTokens(model, text, framing))}>
            重试检视
          </Button>
        </div>
      )}
      {value && (
        <>
          <dl className="token-inspection-summary">
            <dt>模型</dt>
            <dd>{value.model}</dd>
            <dt>Tokenizer</dt>
            <dd>{value.tokenizer}</dd>
            <dt>Framing</dt>
            <dd>{value.framing}</dd>
            <dt>Token 数 / 上限</dt>
            <dd>
              {value.count.used} / {value.count.limit}
            </dd>
          </dl>
          <label className="field">
            <span>Token IDs（原顺序）</span>
            <textarea readOnly value={value.tokenIds.join(", ")} spellCheck={false} />
          </label>
        </>
      )}
    </div>
  );
}

/** Shared literal-text entry for direct prompt nodes, Chunk content and instance overrides. */
export function PromptTextEditor({
  value,
  onChange,
  label,
  placeholder,
  models = [],
  model,
  disabled = false,
}: {
  value: string;
  onChange: (text: string) => void;
  label: string;
  placeholder?: string;
  models?: string[];
  model?: string;
  disabled?: boolean;
}) {
  const textarea = useRef<HTMLTextAreaElement>(null);
  const selection = useRef({ start: 0, end: 0 });
  const [tagsOpen, setTagsOpen] = useState(false);
  const [tokensOpen, setTokensOpen] = useState(false);
  const [chosenModel, setChosenModel] = useState<string | null>(null);
  const selectedModel = chosenModel ?? model ?? models[0] ?? "";
  const [initialQuery, setInitialQuery] = useState("");
  const id = useId();
  const focusText = () => requestAnimationFrame(() => textarea.current?.focus());
  const closeTags = () => {
    setTagsOpen(false);
    focusText();
  };
  const insert = (tag: string) => {
    const result = insertAtSelection(value, selection.current.start, selection.current.end, tag);
    onChange(result.text);
    setTagsOpen(false);
    requestAnimationFrame(() => {
      textarea.current?.focus();
      textarea.current?.setSelectionRange(result.caret, result.caret);
      selection.current = { start: result.caret, end: result.caret };
    });
  };
  return (
    <div className="prompt-text-editor">
      <textarea
        ref={textarea}
        aria-label={label}
        spellCheck={false}
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        onSelect={(event) => {
          selection.current = {
            start: event.currentTarget.selectionStart,
            end: event.currentTarget.selectionEnd,
          };
        }}
        onChange={(event) => onChange(event.target.value)}
      />
      <div className="prompt-assist-toolbar">
        <Button
          className="quiet"
          disabled={disabled}
          aria-expanded={tagsOpen}
          aria-controls={`${id}-tags`}
          onClick={() => {
            if (tagsOpen) closeTags();
            else {
              setInitialQuery(value.slice(selection.current.start, selection.current.end));
              setTagsOpen(true);
            }
          }}
        >
          标签建议
        </Button>
        <Button className="quiet" disabled={disabled} onClick={() => setTokensOpen(true)}>
          本地 Token
        </Button>
      </div>
      {tagsOpen && (
        <div id={`${id}-tags`}>
          <TagSuggestions
            models={models}
            model={selectedModel}
            onModelChange={setChosenModel}
            initialQuery={initialQuery}
            insert={insert}
            close={closeTags}
          />
        </div>
      )}
      <Modal
        open={tokensOpen}
        title="本地 Token 检视"
        onClose={() => {
          setTokensOpen(false);
          focusText();
        }}
      >
        {tokensOpen && (
          <TokenInspector
            text={value}
            models={models}
            model={selectedModel}
            onModelChange={setChosenModel}
          />
        )}
      </Modal>
    </div>
  );
}
