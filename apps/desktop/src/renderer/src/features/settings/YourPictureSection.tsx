import { ImagePlus, Loader2 } from "lucide-react";
import type { YourPicture } from "@chaturanga/shared/ipc/chaturanga-api";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { SectionHeader } from "@/components/ui/page";
import { SideDot } from "@/components/ui/side-dot";
import { ipcErrorMessage } from "@/lib/ipc-error";
import { cardPadded } from "@/lib/ui";
import { cn } from "@/lib/utils";
import { useYourPictureMutation, useYourPictureQuery } from "../../queries/api";
import { useYourPicture, YourAvatar } from "../profile/YourAvatar";

const SOURCE_TEXT: Record<NonNullable<YourPicture["source"]> | "none", string> = {
  upload: "Your photo",
  chesscom: "From Chess.com",
  lichess: "From Lichess (your flair)",
  none: "None: your colour shows"
};

/**
 * Settings → Your picture: the picture beside "You" everywhere (main/profile-picture), where it
 * comes from, Choose picture… and, for your own photo, Remove.
 */
export function YourPictureSection() {
  const source = useYourPictureQuery().data?.source ?? null;
  const yours = useYourPicture();
  const change = useYourPictureMutation();
  return (
    <section className={cn(cardPadded, "grid content-start gap-4")}>
      <SectionHeader
        title="Your picture"
        description="Shown beside “You” on boards and in game lists. Without a photo of your own, your Chess.com picture or Lichess flair is used."
      />
      <div className="flex flex-wrap items-center gap-3">
        {yours ? (
          <YourAvatar picture={yours} size="md" />
        ) : (
          <span className="grid size-9 shrink-0 place-items-center rounded-[9px] bg-control">
            <SideDot color="white" size="md" />
          </span>
        )}
        <span className="min-w-0 flex-1 truncate text-sm text-fg-secondary">
          {SOURCE_TEXT[source ?? "none"]}
        </span>
        <span className="flex shrink-0 items-center gap-1.5">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={change.isPending}
            onClick={() => change.mutate("choose")}
          >
            {change.isPending ? <Loader2 className="animate-spin" /> : <ImagePlus />}
            Choose picture…
          </Button>
          {source === "upload" ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={change.isPending}
              onClick={() => change.mutate("remove")}
            >
              Remove
            </Button>
          ) : null}
        </span>
      </div>
      {change.error ? (
        <Notice tone="danger">
          {ipcErrorMessage(change.error) || "Couldn’t change your picture."}
        </Notice>
      ) : null}
    </section>
  );
}
