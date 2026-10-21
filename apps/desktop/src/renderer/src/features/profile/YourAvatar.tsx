import { useMemo, useState } from "react";
import type { Color, GameSource } from "@chaturanga/shared/types/chess";
import { cn } from "@/lib/utils";
import { useYourPictureQuery } from "../../queries/api";
import { useChesscomStore } from "../../stores/chesscom-store";
import { useLichessStore } from "../../stores/lichess-store";
import { avatarSlotClass, type AvatarSize } from "../analysis/EngineAvatar";
import { accountUsernames, yourSideOf } from "../play/recent-games";

/** Your picture where one place shows it: its src, and what to call when it fails to load. */
export type YourPictureView = { src: string; onError: () => void };

/**
 * Your picture (main/profile-picture: your photo, else an account's) for one place that shows it;
 * null when you have none, or it failed to load there (the side's colour shows instead). Another
 * picture, or the next read of it (a copy restored keeps its src), tries again; a load that fails
 * never reads it again itself.
 */
export function useYourPicture(): YourPictureView | null {
  const { data, dataUpdatedAt } = useYourPictureQuery();
  const src = data?.src ?? null;
  // The src that failed, and the read it came from: a later read is a new try.
  const [failed, setFailed] = useState<{ src: string; read: number } | null>(null);
  return useMemo(
    () =>
      src && (failed?.src !== src || failed.read !== dataUpdatedAt)
        ? { src, onError: () => setFailed({ src, read: dataUpdatedAt }) }
        : null,
    [src, dataUpdatedAt, failed]
  );
}

/**
 * The side you played in a game with these players: the "You" side, else the side named after a
 * connected account (a Lichess or Chess.com game's own site's, any other game's either); null when
 * neither (someone else's game).
 */
export function useYourSide(
  white: string | null | undefined,
  black: string | null | undefined,
  source: GameSource | null | undefined
): Color | null {
  const lichess = useLichessStore((state) => state.status.account?.username ?? null);
  const chesscom = useChesscomStore((state) => state.status.account?.username ?? null);
  return yourSideOf(
    { white: white ?? null, black: black ?? null },
    accountUsernames(source, { lichess, chesscom })
  );
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
