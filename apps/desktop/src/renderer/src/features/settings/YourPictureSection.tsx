import { useState } from "react";
import { Crop, ImagePlus, Loader2 } from "lucide-react";
import type { YourPicture } from "@chaturanga/shared/ipc/chaturanga-api";
import type { PictureCrop, PictureFile } from "@chaturanga/shared/types/pictures";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { SectionHeader } from "@/components/ui/page";
import { SideDot } from "@/components/ui/side-dot";
import { ipcErrorMessage } from "@/lib/ipc-error";
import { cardPadded } from "@/lib/ui";
import { cn } from "@/lib/utils";
import {
  usePictureFileMutation,
  useYourPictureMutation,
  useYourPictureQuery
} from "../../queries/api";
import { useYourPicture, YourAvatar } from "../profile/YourAvatar";
import { PictureCropDialog } from "./PictureCropDialog";

const SOURCE_TEXT: Record<NonNullable<YourPicture["source"]> | "none", string> = {
  upload: "Your photo",
  chesscom: "From Chess.com",
  lichess: "From Lichess (your flair)",
  none: "None: your colour shows"
};

/**
 * Settings → Your picture: the picture beside "You" everywhere (main/profile-picture), where it
 * comes from, Choose picture… (then cropped in PictureCropDialog) and, for your own photo, Adjust
 * (cropped again from its original, when it is kept) and Remove.
 */
export function YourPictureSection() {
  const picture = useYourPictureQuery().data;
  const source = picture?.source ?? null;
  const yours = useYourPicture();
  const flow = usePictureCropFlow();
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
        <PictureActions
          own={source === "upload"}
          adjustable={picture?.adjustable ?? false}
          flow={flow}
        />
      </div>
      {flow.error ? (
        <Notice tone="danger">
          {ipcErrorMessage(flow.error) || "Couldn’t change your picture."}
        </Notice>
      ) : null}
      {flow.cropping ? (
        <PictureCropDialog
          file={flow.cropping.file}
          saving={flow.saving}
          error={flow.saveError}
          onCancel={flow.cancel}
          onSave={flow.save}
        />
      ) : null}
    </section>
  );
}

/**
 * Choose picture… or Adjust opens the file to crop; Save stores the crop (with the file as the new
 * original, or re-cut from the kept one); Remove forgets the photo.
 */
function usePictureCropFlow() {
  const change = useYourPictureMutation();
  const open = usePictureFileMutation();
  /** The file being cropped, and whether it is a new original (else your photo's, re-cut). */
  const [cropping, setCropping] = useState<{ file: PictureFile; fresh: boolean } | null>(null);
  return {
    cropping,
    busy: change.isPending || open.isPending,
    choosing: open.isPending && open.variables === "choose",
    saving: change.isPending,
    /** Why opening the file, or Remove, failed (a failed save shows in the dialog). */
    error: open.error ?? (cropping ? null : change.error),
    saveError:
      cropping && change.error
        ? ipcErrorMessage(change.error) || "Couldn’t save your picture."
        : null,
    open: (from: "choose" | "adjust") => {
      change.reset();
      open.mutate(from, {
        onSuccess: (file) => {
          if (file) setCropping({ file, fresh: from === "choose" });
        }
      });
    },
    save: (cropped: Uint8Array, crop: PictureCrop) => {
      if (!cropping) return;
      change.mutate(
        { cropped, original: cropping.fresh ? cropping.file.bytes : null, crop },
        { onSuccess: () => setCropping(null) }
      );
    },
    cancel: () => {
      change.reset();
      setCropping(null);
    },
    remove: () => change.mutate(null)
  };
}

function PictureActions({
  own,
  adjustable,
  flow
}: {
  /** Your own photo is shown (not an account's picture). */
  own: boolean;
  adjustable: boolean;
  flow: ReturnType<typeof usePictureCropFlow>;
}) {
  return (
    <span className="flex shrink-0 items-center gap-1.5">
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={flow.busy}
        onClick={() => flow.open("choose")}
      >
        {flow.choosing ? <Loader2 className="animate-spin" /> : <ImagePlus />}
        Choose picture…
      </Button>
      {own && adjustable ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={flow.busy}
          onClick={() => flow.open("adjust")}
        >
          <Crop />
          Adjust
        </Button>
      ) : null}
      {own ? (
        <Button type="button" variant="ghost" size="sm" disabled={flow.busy} onClick={flow.remove}>
          Remove
        </Button>
      ) : null}
    </span>
  );
}
