/** The tournament page's tabs. */
export type TournamentTab = "boards" | "players" | "about";

/** What opening a tournament asks for: its round (null: Lichess's default) and a board to outline. */
export type TournamentTarget = {
  tourId: string;
  roundId: string | null;
  focusGameId: string | null;
};

/** The tournament screen shown (Back / Forward bring it back as it was). */
export type BroadcastScreen = TournamentTarget & { tab: TournamentTab };
