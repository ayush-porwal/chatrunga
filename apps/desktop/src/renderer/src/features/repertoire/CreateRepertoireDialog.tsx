import { useId, useState } from "react";
import { Upload } from "lucide-react";
import type { RepertoireColor, RepertoireDetail } from "@chaturanga/shared/types/repertoire";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { fieldHint } from "@/lib/ui";
import { ipcErrorMessage } from "@/lib/ipc-error";
import { useCreateRepertoireMutation } from "../../queries/repertoire";
import { fenError } from "./repertoire-chapters";

type StartFrom = "initial" | "fen";

const colorOptions = [
  { value: "white" as const, label: "White" },
  { value: "black" as const, label: "Black" }
];

const startOptions = [
  { value: "initial" as const, label: "Initial position" },
  { value: "fen" as const, label: "From FEN" }
];

/**
 * New repertoire (§5.1): name and the side you train, starting from the initial position or a
 * validated FEN. "Create and import PGN" creates it and goes straight to the import preview.
 */
export function CreateRepertoireDialog({
  onClose,
  onCreated
}: {
  onClose: () => void;
  onCreated: (detail: RepertoireDetail, next: "study" | "import") => void;
}) {
  const ids = { name: useId(), fen: useId() };
  const create = useCreateRepertoireMutation();
  const [name, setName] = useState("");
  const [color, setColor] = useState<RepertoireColor>("white");
  const [startFrom, setStartFrom] = useState<StartFrom>("initial");
  const [fen, setFen] = useState("");
  const invalidFen = startFrom === "fen" ? fenError(fen) : null;
  const canCreate = Boolean(name.trim()) && !invalidFen && !create.isPending;

  const submit = (next: "study" | "import") => {
    if (!canCreate) return;
    create.mutate(
      {
        name: name.trim(),
        color,
        ...(startFrom === "fen" ? { rootFen: fen.trim() } : {})
      },
      { onSuccess: (detail) => onCreated(detail, next) }
    );
  };

  return (
    <Dialog
      size="sm"
      title="New repertoire"
      onClose={onClose}
      footer={
        <>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!canCreate}
            onClick={() => submit("import")}
          >
            <Upload />
            Create and import PGN
          </Button>
          <Button
            type="button"
            variant="primary"
            size="sm"
            disabled={!canCreate}
            onClick={() => submit("study")}
          >
            {create.isPending ? "Creating…" : "Create"}
          </Button>
        </>
      }
      bodyClassName="grid gap-4"
    >
      <form
        className="grid gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          submit("study");
        }}
      >
        <Field label="Name" htmlFor={ids.name}>
          <Input
            id={ids.name}
            autoFocus
            placeholder="My 1.e4 repertoire"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </Field>
        <div className="grid gap-1.5">
          <p className="text-xs font-medium text-fg-secondary">You play</p>
          <SegmentedControl
            ariaLabel="Repertoire colour"
            value={color}
            onChange={setColor}
            options={colorOptions}
          />
          <p className={fieldHint}>Flipping the board later never changes this.</p>
        </div>
        <div className="grid gap-1.5">
          <p className="text-xs font-medium text-fg-secondary">Start from</p>
          <SegmentedControl
            ariaLabel="Starting position"
            value={startFrom}
            onChange={setStartFrom}
            options={startOptions}
          />
        </div>
        {startFrom === "fen" ? (
          <Field label="FEN" htmlFor={ids.fen}>
            <Input
              id={ids.fen}
              className="font-mono text-xs"
              placeholder="rnbqkbnr/pp1ppppp/8/2p5/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2"
              aria-invalid={Boolean(fen.trim() && invalidFen) || undefined}
              value={fen}
              onChange={(event) => setFen(event.target.value)}
            />
            {fen.trim() && invalidFen ? <p className="text-2xs text-danger">{invalidFen}</p> : null}
          </Field>
        ) : null}
        <button type="submit" hidden />
      </form>
      {create.error ? (
        <Notice tone="danger">{ipcErrorMessage(create.error) || "Couldn't create it."}</Notice>
      ) : null}
    </Dialog>
  );
}
