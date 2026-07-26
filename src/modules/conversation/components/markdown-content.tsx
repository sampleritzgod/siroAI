"use client";

import { useMemo } from "react";
import type { Components } from "react-markdown";
import ReactMarkdown from "react-markdown";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";
import {
  linkifyCitationMarkers,
  parseCitationHref,
} from "@/modules/conversation/citation-markers";
import { useSourceViewer } from "@/modules/conversation/components/source-viewer-provider";
import type { MessageCitation } from "@/modules/rag/citation-types";

type MarkdownContentProps = {
  content: string;
  className?: string;
  /** When provided, inline `[n]` markers become clickable citations. */
  citations?: MessageCitation[];
};

const components: Components = {
  h1: ({ children }) => (
    <h1 className="mb-2 mt-4 text-xl font-semibold first:mt-0">{children}</h1>
  ),
  h2: ({ children }) => (
    <h2 className="mb-2 mt-3 text-lg font-semibold first:mt-0">{children}</h2>
  ),
  h3: ({ children }) => (
    <h3 className="mb-1.5 mt-3 text-base font-semibold first:mt-0">
      {children}
    </h3>
  ),
  p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
  ul: ({ children }) => (
    <ul className="mb-2 list-disc space-y-1 pl-5 last:mb-0">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="mb-2 list-decimal space-y-1 pl-5 last:mb-0">{children}</ol>
  ),
  li: ({ children }) => <li className="leading-relaxed">{children}</li>,
  strong: ({ children }) => (
    <strong className="font-semibold text-[var(--foreground)]">{children}</strong>
  ),
  em: ({ children }) => <em className="italic">{children}</em>,
  a: ({ href, children }) => (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="text-[var(--accent)] underline underline-offset-2 hover:opacity-90"
    >
      {children}
    </a>
  ),
  blockquote: ({ children }) => (
    <blockquote className="mb-2 border-l-2 border-[var(--border)] pl-3 text-[var(--muted)] last:mb-0">
      {children}
    </blockquote>
  ),
  hr: () => <hr className="my-3 border-[var(--border)]" />,
  table: ({ children }) => (
    <div className="mb-2 overflow-x-auto last:mb-0">
      <table className="w-full border-collapse text-sm">{children}</table>
    </div>
  ),
  th: ({ children }) => (
    <th className="border border-[var(--border)] bg-[var(--sidebar)] px-2 py-1 text-left font-medium">
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="border border-[var(--border)] px-2 py-1 align-top">
      {children}
    </td>
  ),
  code: ({ className, children, ...props }) => {
    const match = /language-(\w+)/.exec(className ?? "");
    const code = String(children).replace(/\n$/, "");
    const isBlock = Boolean(match) || code.includes("\n");

    if (isBlock) {
      const language = match?.[1] ?? "text";
      return (
        <div className="my-2 overflow-hidden rounded-xl ring-1 ring-[var(--border)] last:mb-0">
          <div className="flex items-center justify-between border-b border-[var(--border)] bg-[var(--sidebar)] px-3 py-1.5 text-[11px] uppercase tracking-wide text-[var(--muted)]">
            <span>{language}</span>
          </div>
          <SyntaxHighlighter
            style={oneDark}
            language={language}
            PreTag="div"
            customStyle={{
              margin: 0,
              padding: "0.85rem 1rem",
              background: "#0f0f0f",
              fontSize: "0.8125rem",
              lineHeight: 1.55,
            }}
            codeTagProps={{
              style: {
                fontFamily: "var(--font-geist-mono), ui-monospace, monospace",
              },
            }}
          >
            {code}
          </SyntaxHighlighter>
        </div>
      );
    }

    return (
      <code
        className="rounded-md bg-[var(--sidebar)] px-1.5 py-0.5 font-mono text-[0.85em] text-[var(--foreground)] ring-1 ring-[var(--border)]"
        {...props}
      >
        {children}
      </code>
    );
  },
  pre: ({ children }) => <>{children}</>,
};

/**
 * Renders assistant markdown (headings, lists, fenced code with highlighting).
 * Inline `[n]` markers become clickable citations when `citations` is supplied.
 */
export function MarkdownContent({
  content,
  className,
  citations,
}: MarkdownContentProps) {
  const viewer = useSourceViewer();

  const citationByIndex = useMemo(() => {
    const map = new Map<number, MessageCitation>();
    for (const citation of citations ?? []) {
      map.set(citation.index, citation);
    }
    return map;
  }, [citations]);

  // Only linkify markers that resolve to a citation the viewer can open.
  const linkable = useMemo(() => {
    if (!viewer || citationByIndex.size === 0) return new Set<number>();
    return new Set(citationByIndex.keys());
  }, [viewer, citationByIndex]);

  const renderedContent = useMemo(
    () => linkifyCitationMarkers(content, linkable),
    [content, linkable]
  );

  const mergedComponents = useMemo<Components>(() => {
    if (linkable.size === 0) return components;

    return {
      ...components,
      a: ({ href, children }) => {
        const index = parseCitationHref(href);
        const citation = index ? citationByIndex.get(index) : null;

        if (!citation || !viewer) {
          return (
            <a
              href={href}
              target="_blank"
              rel="noreferrer"
              className="text-[var(--accent)] underline underline-offset-2 hover:opacity-90"
            >
              {children}
            </a>
          );
        }

        return (
          <button
            type="button"
            onClick={() => viewer.openCitation(citation)}
            title={`${citation.filename} · chunk ${citation.chunkIndex + 1} · score ${citation.score.toFixed(2)}`}
            aria-label={`Open source ${citation.filename}, chunk ${citation.chunkIndex + 1}`}
            className="mx-0.5 inline-flex min-w-[1.25rem] items-center justify-center rounded-md bg-[var(--accent)]/15 px-1 align-baseline text-[0.75em] font-semibold text-[var(--accent)] transition-colors hover:bg-[var(--accent)]/30"
          >
            {citation.index}
          </button>
        );
      },
    };
  }, [linkable, citationByIndex, viewer]);

  if (!content) return null;

  return (
    <div
      className={cn(
        "markdown-body text-[15px] leading-relaxed break-words",
        className
      )}
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={mergedComponents}>
        {renderedContent}
      </ReactMarkdown>
    </div>
  );
}
