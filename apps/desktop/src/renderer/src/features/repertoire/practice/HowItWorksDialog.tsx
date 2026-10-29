import { Dialog } from "@/components/ui/dialog";

/** The Practice tab's terms, each in a sentence or two (docs/repertoire-games-and-practice.md §4). */
const TERMS: readonly [string, string][] = [
  ["Due", "Scheduled for today or earlier."],
  ["Learning", "New or missed recently; a missed move comes back within 20 minutes."],
  ["New", "Moves of yours you haven't practised yet."],
  ["Review", "Practise the moves that are due."],
  ["Practice early", "Today's learning moves without waiting for them to fall due."],
  [
    "Learn new",
    "Moves you haven't practised, nearest the start of each line first, up to the daily limit."
  ],
  ["Mastered", "Next review 21 or more days away."],
  [
    "Perfect line",
    "A line from its chapter's start to its end where your latest answer to every move of yours was right."
  ]
];

/** How practice works: the schedule in a sentence, then the Practice tab's terms. */
export function HowItWorksDialog({ onClose }: { onClose: () => void }) {
  return (
    <Dialog size="sm" title="How practice works" onClose={onClose}>
      <div className="grid gap-3 text-sm text-fg-secondary">
        <p>
          Every move of yours is practised on its own. Right answers push its next review further
          out (1, 3, 7, 14, 30, 60 days); a miss — in practice or in a recent game — brings it back
          to the start.
        </p>
        <dl className="grid gap-2">
          {TERMS.map(([term, text]) => (
            <div key={term} className="grid gap-0.5">
              <dt className="font-medium text-fg">{term}</dt>
              <dd>{text}</dd>
            </div>
          ))}
        </dl>
      </div>
    </Dialog>
  );
}
