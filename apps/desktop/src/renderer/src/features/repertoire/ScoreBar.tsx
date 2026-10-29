/**
 * Your games' W/D/L as one meter (wins, draws, losses), then the score; the counts are its title.
 * Study's Explorer and Insights' rows share it.
 */
export function ScoreBar({
  wins,
  draws,
  losses,
  score
}: {
  wins: number;
  draws: number;
  losses: number;
  /** The score as shown ("62%"; "—" when there is none). */
  score: string;
}) {
  const decided = wins + draws + losses;
  const width = (count: number) => `${decided ? (count / decided) * 100 : 0}%`;
  return (
    <span
      className="flex min-w-0 items-center gap-1.5"
      title={`${wins} won · ${draws} drawn · ${losses} lost`}
    >
      <span
        aria-hidden="true"
        className="flex h-1.5 w-14 shrink-0 overflow-hidden rounded-full bg-control"
      >
        <span className="bg-accent" style={{ width: width(wins) }} />
        <span className="bg-fg-subtle" style={{ width: width(draws) }} />
        <span className="bg-danger" style={{ width: width(losses) }} />
      </span>
      <span className="w-8 text-right tabular-nums">{score}</span>
    </span>
  );
}
