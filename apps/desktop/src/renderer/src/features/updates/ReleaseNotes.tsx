import { useMemo } from "react";
import { parseReleaseNotes, type InlinePart } from "@/lib/app-update";
import { cn } from "@/lib/utils";

/**
 * Release notes as text: headings, bulleted lists and paragraphs from the Markdown-ish notes. Never
 * renders markup from the feed; http(s) links open in the browser (the window's open handler sends
 * `target=_blank` links to the OS).
 */
export function ReleaseNotes({ notes, className }: { notes: string; className?: string }) {
  const groups = useMemo(() => {
    const result: Array<
      | { type: "list"; items: InlinePart[][] }
      | { type: "heading"; text: string }
      | { type: "paragraph"; parts: InlinePart[] }
    > = [];
    for (const block of parseReleaseNotes(notes)) {
      const last = result[result.length - 1];
      if (block.type === "bullet") {
        if (last?.type === "list") last.items.push(block.parts);
        else result.push({ type: "list", items: [block.parts] });
      } else result.push(block);
    }
    return result;
  }, [notes]);

  if (!groups.length)
    return (
      <p className={cn("text-sm text-fg-muted", className)}>No release notes for this version.</p>
    );
  return (
    <div className={cn("grid gap-2 text-sm leading-6 text-fg-secondary", className)}>
      {groups.map((group, index) =>
        group.type === "heading" ? (
          <h3
            key={index}
            className="pt-1 text-2xs font-semibold uppercase tracking-wide text-fg-muted first:pt-0"
          >
            {group.text}
          </h3>
        ) : group.type === "list" ? (
          <ul key={index} className="grid list-disc gap-1 pl-5 marker:text-fg-subtle">
            {group.items.map((parts, itemIndex) => (
              <li key={itemIndex}>
                <Inline parts={parts} />
              </li>
            ))}
          </ul>
        ) : (
          <p key={index}>
            <Inline parts={group.parts} />
          </p>
        )
      )}
    </div>
  );
}

function Inline({ parts }: { parts: InlinePart[] }) {
  return parts.map((part, index) =>
    part.href ? (
      <a
        key={index}
        href={part.href}
        target="_blank"
        rel="noreferrer"
        className="rounded-sm text-accent-fg underline decoration-accent/40 underline-offset-2 outline-none hover:decoration-accent focus-visible:ring-2 focus-visible:ring-accent/70"
      >
        {part.text}
      </a>
    ) : (
      <span key={index}>{part.text}</span>
    )
  );
}
