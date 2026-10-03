import type { ReactNode } from "react";
import { ExternalLink, Trash2 } from "lucide-react";
import type { RepertoireGameLink } from "@chaturanga/shared/types/repertoire";
import { Badge } from "@/components/ui/badge";
import { IconButton } from "@/components/ui/icon-button";
import { Notice } from "@/components/ui/notice";
import { SectionHeader } from "@/components/ui/page";
import { ipcErrorMessage } from "@/lib/ipc-error";
import { listRow } from "@/lib/ui";
import { cn } from "@/lib/utils";
import { useGameLinksQuery, useRemoveGameLinkMutation } from "../../queries/repertoire";
import { gameLinkLabel, missingGameNote } from "./add-from-game";

/**
 * The games linked to a chapter (design §5.2 / §6.4 / §6.5), in two lists. Sources: the games its
 * material came from, with the copied route. Played from here: engine games started at one of its
 * positions, with where they started (nothing was copied from them). Each has "Open game" at the
 * linked move while the game is still in the library, and Remove, which drops only the link. A
 * deleted game keeps its link with a note, and only Remove; so does a board game that was never
 * saved, with its own note.
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
  const sources = links.data?.filter((link) => link.kind !== "played") ?? [];
  const played = links.data?.filter((link) => link.kind === "played") ?? [];

  if (!links.data?.length && !links.isError) return null;

  const removeError = remove.error ? (
    <Notice tone="danger">{ipcErrorMessage(remove.error) || "Couldn't remove that link."}</Notice>
  ) : null;
  const rowProps = {
    onOpenGame,
    removing: remove.isPending,
    onRemove: (link: RepertoireGameLink, confirmText: string) => {
      if (window.confirm(confirmText)) remove.mutate({ repertoireId, linkId: link.id });
    }
  };

  return (
    <>
      {sources.length || links.isError ? (
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
          {removeError}
          <ul className="grid gap-1.5">
            {sources.map((link) => (
              <GameLinkRow
                key={link.id}
                link={link}
                path={link.capturedPath || "Start"}
                removeLabel="Remove source"
                confirmText="Remove this source link? The moves copied from the game stay in the chapter."
                {...rowProps}
              />
            ))}
          </ul>
        </section>
      ) : null}
      {played.length ? (
        <section className="grid gap-2" aria-label="Played from here">
          <SectionHeader
            as="h3"
            title="Played from here"
            description="Engine games you started from this chapter's positions."
          />
          {sources.length || links.isError ? null : removeError}
          <ul className="grid gap-1.5">
            {played.map((link) => (
              <GameLinkRow
                key={link.id}
                link={link}
                badge={<Badge tone="info">Played</Badge>}
                path={`From ${link.capturedPath || "the start"}`}
                removeLabel="Remove link"
                confirmText="Remove the link to this game? The game stays in your library."
                {...rowProps}
              />
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}

/** One linked game: who played, the route line, Open game and Remove. */
function GameLinkRow({
  link,
  badge = null,
  path,
  removeLabel,
  confirmText,
  removing,
  onOpenGame,
  onRemove
}: {
  link: RepertoireGameLink;
  badge?: ReactNode;
  path: string;
  removeLabel: string;
  confirmText: string;
  removing: boolean;
  onOpenGame?: (gameId: string, nodeId: string | null) => void;
  onRemove: (link: RepertoireGameLink, confirmText: string) => void;
}) {
  return (
    <li className={cn(listRow, "gap-1 py-1.5 pl-3 pr-1")}>
      <div className="grid min-w-0 flex-1 gap-0.5">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-sm text-fg-secondary">
            {gameLinkLabel(link.headers, link.createdAt)}
          </span>
          {badge}
        </span>
        <span className="truncate font-mono text-2xs text-fg-muted" title={link.capturedPath}>
          {path}
        </span>
        {/* Its own line: in the narrow panel a long path would truncate it away. */}
        {link.gameId ? null : (
          <span className="text-2xs text-fg-muted">{missingGameNote(link)}</span>
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
        label={removeLabel}
        icon={<Trash2 />}
        variant="ghost-destructive"
        size="icon-xs"
        tooltipSide="left"
        disabled={removing}
        onClick={() => onRemove(link, confirmText)}
      />
    </li>
  );
}
