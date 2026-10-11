import { Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";

/** The hub's message about the last action: its outcome, with what can be done next. */
export type HubMessage = {
  tone: "danger" | "success" | "info";
  text: string;
  pgn?: string;
  /** Extra lines under the message (where replaced repertoires were backed up). */
  details?: string[];
  /** Full path behind a shortened one, as a tooltip. */
  path?: string;
  action?: { label: string; onSelect: () => void };
};

/** The message with its action, Copy PGN (an export not saved to a file) and Dismiss. */
export function HubNotice({
  notice,
  onChange
}: {
  notice: HubMessage;
  onChange: (notice: HubMessage | null) => void;
}) {
  const { action, pgn } = notice;
  return (
    <Notice
      tone={notice.tone}
      action={
        <div className="flex gap-2">
          {action ? (
            <Button
              type="button"
              variant="outline"
              size="xs"
              onClick={() => {
                onChange(null);
                action.onSelect();
              }}
            >
              {action.label}
            </Button>
          ) : null}
          {pgn ? (
            <Button
              type="button"
              variant="outline"
              size="xs"
              onClick={() =>
                void navigator.clipboard
                  .writeText(pgn)
                  .then(() => onChange({ tone: "success", text: "PGN copied to the clipboard." }))
                  .catch(() => onChange({ tone: "danger", text: "Couldn't copy the PGN." }))
              }
            >
              <Copy />
              Copy PGN
            </Button>
          ) : null}
          <Button type="button" variant="link" size="xs" onClick={() => onChange(null)}>
            Dismiss
          </Button>
        </div>
      }
    >
      <span title={notice.path}>{notice.text}</span>
      {notice.details?.length ? (
        <ul className="mt-1 grid gap-0.5 text-fg-muted">
          {notice.details.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      ) : null}
    </Notice>
  );
}
