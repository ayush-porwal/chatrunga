import { ExternalLink, Trash2 } from "lucide-react";
import { IconButton } from "@/components/ui/icon-button";
import { Notice } from "@/components/ui/notice";
import { SectionHeader } from "@/components/ui/page";
import { ipcErrorMessage } from "@/lib/ipc-error";
import { listRow } from "@/lib/ui";
import { cn } from "@/lib/utils";
import { useGameLinksQuery, useRemoveGameLinkMutation } from "../../queries/repertoire";
import { gameLinkLabel } from "./add-from-game";

/**
 * The games a chapter's material came from (design §5.2 / §6.5): who played, the copied route,
 * "Open game" at the linked move while the game is still in the library, and Remove (the copied
 * moves stay). A deleted game keeps its link with a note, and only Remove.
 */
export function StudySourcesSection({
  repertoireId,
  chapterId,
  onOpenGame
}: {
  repertoireId: string;
  chapterId: string;
  onOpenGame?: (gameId: string, nodeId: string | null) => void;
}) {
  const links = useGameLinksQuery(repertoireId, chapterId);
  const remove = useRemoveGameLinkMutation();

  if (!links.data?.length && !links.isError) return null;

  return (
    <section className="grid gap-2" aria-label="Sources">
      <SectionHeader
        as="h3"
        title="Sources"
        description="Games this chapter's moves were added from."
      />
      {links.isError ? (
        <Notice tone="danger">
          {ipcErrorMessage(links.error) || "The chapter's sources couldn't be read."}
        </Notice>
      ) : null}
      {remove.error ? (
        <Notice tone="danger">
          {ipcErrorMessage(remove.error) || "Couldn't remove that source."}
        </Notice>
      ) : null}
      <ul className="grid gap-1.5">
        {links.data?.map((link) => (
          <li key={link.id} className={cn(listRow, "gap-1 py-1.5 pl-3 pr-1")}>
            <div className="grid min-w-0 flex-1 gap-0.5">
              <span className="truncate text-sm text-fg-secondary">
                {gameLinkLabel(link.headers)}
              </span>
              <span className="truncate font-mono text-2xs text-fg-muted" title={link.capturedPath}>
                {link.capturedPath || "Start"}
              </span>
              {/* Its own line: in the narrow panel a long path would truncate it away. */}
              {link.gameId ? null : (
                <span className="text-2xs text-fg-muted">(game no longer in library)</span>
              )}
            </div>
            {link.gameId && onOpenGame ? (
              <IconButton
                label="Open game"
                icon={<ExternalLink />}
                size="icon-xs"
                tooltipSide="left"
                onClick={() => onOpenGame(link.gameId!, link.gameNodeId)}
              />
            ) : null}
            <IconButton
              label="Remove source"
              icon={<Trash2 />}
              variant="ghost-destructive"
              size="icon-xs"
              tooltipSide="left"
              disabled={remove.isPending}
              onClick={() => {
                if (
                  window.confirm(
                    "Remove this source link? The moves copied from the game stay in the chapter."
                  )
                ) {
                  remove.mutate({ repertoireId, linkId: link.id });
                }
              }}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}
