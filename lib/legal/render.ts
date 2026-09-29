import { createHash } from "node:crypto";

export type LegalBlock = { type: "h1" | "h2" | "p" | "li"; text: string };
export type RenderedLegal = { version: string; title: string; text: string; blocks: LegalBlock[]; sha256: string };

/** Parses a legal markdown file, fills {{VARS}} and hashes the exact resulting text. */
export function renderLegalSource(source: string, vars: Record<string, string>): RenderedLegal {
  const match = source.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) throw new Error("Legal text is missing its frontmatter");
  const meta = Object.fromEntries(
    match[1].split("\n").map((line) => {
      const i = line.indexOf(":");
      return [line.slice(0, i).trim(), line.slice(i + 1).trim()];
    }),
  );
  if (!meta.version || !meta.title) throw new Error("Legal text needs version and title");

  const text = match[2]
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/\{\{([A-Z_]+)\}\}/g, (whole, key: string) => vars[key] ?? whole)
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  const blocks: LegalBlock[] = text
    .split("\n")
    .filter((line) => line.trim())
    .map((line) =>
      line.startsWith("## ")
        ? { type: "h2", text: line.slice(3) }
        : line.startsWith("# ")
          ? { type: "h1", text: line.slice(2) }
          : line.startsWith("- ")
            ? { type: "li", text: line.slice(2) }
            : { type: "p", text: line },
    );

  return {
    version: meta.version,
    title: meta.title,
    text,
    blocks,
    sha256: createHash("sha256").update(text, "utf8").digest("hex"),
  };
}
