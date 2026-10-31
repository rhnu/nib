import { memo, type ComponentProps } from "react";
import { Streamdown } from "streamdown";
import { cjk } from "@streamdown/cjk";
import { openUrl } from "@tauri-apps/plugin-opener";
import { notify } from "@/shared/ui";
import { errorMessage } from "@/shared/host/error";

const plugins = { cjk };

/** Desktop links use the platform opener; generated media keeps its typed asset viewer. */
function MarkdownLink({ href, children, title, className }: ComponentProps<"a">) {
  return (
    <a
      href={href}
      title={title}
      className={className}
      onClick={(event) => {
        event.preventDefault();
        if (href && /^https?:\/\//i.test(href))
          void openUrl(href).catch((cause: unknown) =>
            notify(() => errorMessage(cause), "agent-open-link", true),
          );
      }}
    >
      {children}
    </a>
  );
}

const components = { a: MarkdownLink };
const disallowedElements = ["img"];

/** Stable completed messages avoid repeated Markdown work while the last answer streams. */
export const AgentMarkdown = memo(function AgentMarkdown({
  content,
  streaming,
}: {
  content: string;
  streaming: boolean;
}) {
  return (
    <Streamdown
      className="agent-markdown"
      plugins={plugins}
      components={components}
      mode={streaming ? "streaming" : "static"}
      isAnimating={streaming}
      controls={false}
      skipHtml
      disallowedElements={disallowedElements}
    >
      {content}
    </Streamdown>
  );
});
