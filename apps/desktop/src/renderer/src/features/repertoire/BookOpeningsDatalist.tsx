import type { BookOpening } from "@chaturanga/shared/types/repertoire-practice";

/** The bundled book's opening names, for an Opening field's `list` (each with its ECO). */
export function BookOpeningsDatalist({
  id,
  openings
}: {
  id: string;
  openings: readonly BookOpening[] | undefined;
}) {
  return (
    <datalist id={id}>
      {openings?.map((opening) => (
        <option key={opening.name} value={opening.name}>
          {opening.eco}
        </option>
      ))}
    </datalist>
  );
}
