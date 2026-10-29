import { useId, useMemo, useState } from "react";
import type { RepertoireChapterSummary } from "@chaturanga/shared/types/repertoire";
import type { ChapterOpening } from "@chaturanga/shared/types/repertoire-practice";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { useBookOpeningsQuery } from "../../queries/repertoire-practice";
import { BookOpeningsDatalist } from "./BookOpeningsDatalist";

/**
 * A chapter's opening (Edit opening…): a name from the bundled book (suggested as you type, its
 * ECO following) or your own. A typed opening is kept as it is; "Detect from the moves" hands it
 * back to detection, which follows the chapter's mainline from then on.
 */
export function ChapterOpeningDialog({
  chapter,
  onSave,
  onClose
}: {
  chapter: Pick<RepertoireChapterSummary, "title" | "opening">;
  onSave: (opening: ChapterOpening | null) => void;
  onClose: () => void;
}) {
  const id = useId();
  const listId = useId();
  const openings = useBookOpeningsQuery();
  const ecoByName = useMemo(
    () => new Map(openings.data?.map((opening) => [opening.name, opening.eco])),
    [openings.data]
  );
  const [name, setName] = useState(chapter.opening?.name ?? "");
  const eco = ecoByName.get(name.trim()) ?? null;
  return (
    <Dialog
      size="sm"
      title="Chapter opening"
      description={chapter.title}
      onClose={onClose}
      footer={
        <>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="mr-auto"
            onClick={() => onSave({ name: "", eco: null, edited: false })}
          >
            Detect from the moves
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="primary"
            size="sm"
            onClick={() => onSave({ name: name.trim(), eco, edited: true })}
          >
            Save
          </Button>
        </>
      }
    >
      <Field label="Opening" htmlFor={id} hint={eco ? <Badge>{eco}</Badge> : null}>
        <Input
          id={id}
          list={listId}
          autoFocus
          placeholder="Opening not detected"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </Field>
      <BookOpeningsDatalist id={listId} openings={openings.data} />
    </Dialog>
  );
}
