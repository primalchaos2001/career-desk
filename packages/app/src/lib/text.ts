/**
 * Job-board descriptions arrive as Markdown (JobSpy's default), often with
 * escaped punctuation: "**Experience:** 4 to 10 Years", "\- UVM", "R\&D".
 * Turn them into plain, readable text with bullets and paragraphs kept.
 * Plain text passes through unchanged apart from tidied spacing.
 */
export function plainText(md: string): string {
  return (
    md
      .replace(/\r\n?/g, "\n")
      // Escaped punctuation: \- \+ \& \( \) \. \# \* \_ \[ \]
      .replace(/\\([\\`*_{}[\]()#+\-.!&|>~<=])/g, "$1")
      // Images, then links: [text](url) -> text (url), or just url when they match.
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/\[([^\]]+)\]\(([^)\s]+)[^)]*\)/g, (_, label: string, url: string) =>
        label.trim() === url ? url : `${label} (${url})`,
      )
      // Headings and quotes.
      .replace(/^\s{0,3}#{1,6}\s+/gm, "")
      .replace(/^\s{0,3}>\s?/gm, "")
      // Bold / italic / code markers (keep inner text; leave lone * bullets alone).
      .replace(/(\*\*|__)(?=\S)([\s\S]*?\S)\1/g, "$2")
      .replace(/(^|[^\w*])\*(?=\S)([^*\n]*?\S)\*(?!\w)/g, "$1$2")
      .replace(/(^|[^\w_])_(?=\S)([^_\n]*?\S)_(?!\w)/g, "$1$2")
      .replace(/`([^`]+)`/g, "$1")
      // Bullets -> "• ", horizontal rules removed.
      .replace(/^\s*[*+-]\s+/gm, "• ")
      .replace(/^\s*(?:[-*_]\s*){3,}$/gm, "")
      // Leftover HTML line breaks and entities some boards keep.
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/[ \t]{2,}/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  );
}
