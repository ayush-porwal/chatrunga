import { useMemo, useState } from "react";
import type { Color } from "@chaturanga/shared/types/chess";
import { cn } from "@/lib/utils";
import { useYourPictureQuery } from "../../queries/api";
import { useChesscomStore } from "../../stores/chesscom-store";
import { useLichessStore } from "../../stores/lichess-store";
import { avatarSlotClass, type AvatarSize } from "../analysis/EngineAvatar";
import { yourSideOf } from "../play/recent-games";

/** Your picture where one place shows it: its src, and what to call when it fails to load. */
export type YourPictureView = { src: string; onError: () => void };

/**
 * Your picture (main/profile-picture: your photo, else an account's) for one place that shows it;
 * null when you have none, or it failed to load there (the side's colour shows instead). Another
 * picture tries again.
 */
export function useYourPicture(): YourPictureView | null {
  const src = useYourPictureQuery().data?.src ?? null;
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  return useMemo(
    () => (src && src !== failedSrc ? { src, onError: () => setFailedSrc(src) } : null),
    [src, failedSrc]
  );
}

/**
 * The side you played in a game with these players: the "You" side, else the side named after a
 * connected account (Lichess, Chess.com); null when neither (someone else's game).
 */
export function useYourSide(
  white: string | null | undefined,
  black: string | null | undefined
): Color | null {
  const lichess = useLichessStore((state) => state.status.account?.username ?? null);
  const chesscom = useChesscomStore((state) => state.status.account?.username ?? null);
  return yourSideOf({ white: white ?? null, black: black ?? null }, [lichess, chesscom]);
}

/** Your picture in the image slot engines use (EngineAvatar's sizes and edge); decorative. */
export function YourAvatar({
  picture,
  size = "sm",
  className
}: {
  picture: YourPictureView;
  size?: AvatarSize;
  className?: string;
}) {
  return (
    <span aria-hidden="true" className={cn(avatarSlotClass(size), className)}>
      <img
        className="size-full object-cover"
        src={picture.src}
        onError={picture.onError}
        alt=""
        decoding="async"
        draggable={false}
      />
    </span>
  );
}
