import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * Renders article body as Markdown (safe — react-markdown does not render raw HTML by default).
 * Supports bold, italics, lists, links (autolinked via GFM), headings, code, tables.
 */
export function SafeArticleBody({ body }: { body: string | null | undefined }) {
  if (!body) {
    return <p className="text-sm text-muted-foreground italic">No content yet.</p>;
  }
  return (
    <div className="prose prose-sm max-w-none break-words text-foreground prose-headings:text-foreground prose-strong:text-foreground prose-a:text-primary prose-a:underline-offset-2 hover:prose-a:opacity-80 prose-code:text-foreground prose-p:my-2 prose-li:my-0.5">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ node, ...props }) => (
            <a {...props} target="_blank" rel="noopener noreferrer" />
          ),
        }}
      >
        {body}
      </ReactMarkdown>
    </div>
  );
}
