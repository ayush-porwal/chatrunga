import { useId, useState } from "react";
import { Upload } from "lucide-react";
import type {
  AddFromGameSource,
  RepertoireColor,
  RepertoireDetail
} from "@chaturanga/shared/types/repertoire";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { fieldHint } from "@/lib/ui";
import { ipcErrorMessage } from "@/lib/ipc-error";
import { useCreateRepertoireMutation } from "../../queries/repertoire";
import { useAddToRepertoireStore } from "../../stores/add-to-repertoire-store";
import { useGameStore } from "../../stores/game-store";
import { hasMoves, newRepertoireRootFen } from "./add-from-game";
import { ADD_NEEDS_SAVE, captureBoardSource } from "./board-source";
import { fenError, sortedChapters } from "./repertoire-chapters";
import { nameError } from "./repertoire-metadata";

type StartFrom = "initial" | "fen" | "game";

/** What happens after creating: study it, import a PGN into it, or add the board's game to it. */
export type CreateNext = "study" | "import" | "add-game";

const colorOptions = [
  { value: "white" as const, label: "White" },
  { value: "black" as const, label: "Black" }
];

const startOptions = [
  { value: "initial" as const, label: "Initial position" },
  { value: "fen" as const, label: "From FEN" },
  { value: "game" as const, label: "Current game" }
];

/**
 * New repertoire (§5.1): name and the side you train, starting from the initial position or a
 * validated FEN. "Create and import PGN" creates it and goes straight to the import preview.
 * With a game on the board, "Current game" starts from that game's position and, once created,
 * opens "Add to repertoire" for the whole game into the first chapter (`next` is "add-game");
 * "Create and import PGN" ignores it and starts from the initial position.
 */
export function CreateRepertoireDialog({
  onClose,
  onCreated
}: {
  onClose: () => void;
  onCreated: (detail: RepertoireDetail, next: CreateNext) => void;
}) {
  const ids = { name: useId(), fen: useId() };
  const create = useCreateRepertoireMutation();
  const [name, setName] = useState("");
  const [color, setColor] = useState<RepertoireColor>("white");
  const [startFrom, setStartFrom] = useState<StartFrom>("initial");
  const [fen, setFen] = useState("");
  const boardHasGame = useGameStore((state) => hasMoves(state.moveTree));
  const fromGame = startFrom === "game" && boardHasGame;
  const invalidFen = startFrom === "fen" ? fenError(fen) : null;
  const [capturing, setCapturing] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const invalidName = nameError(name);
  const canCreate =
    !invalidName &&
    !invalidFen &&
    !create.isPending &&
    !capturing &&
    (startFrom !== "game" || fromGame);

  const submit = async (next: "study" | "import") => {
    if (!canCreate) return;
    setSaveError(null);
    // The game as it is now (saved first): the dialog that follows adds this snapshot, whatever
    // the board does.
    let source: AddFromGameSource | null = null;
    if (fromGame) {
      setCapturing(true);
      source = await captureBoardSource();
      setCapturing(false);
      if (!source) {
        setSaveError(ADD_NEEDS_SAVE);
        return;
      }
    }
    const rootFen = newRepertoireRootFen(startFrom, fen, source?.rootFen ?? null, next);
    create.mutate(
      { name: name.trim(), color, ...(rootFen ? { rootFen } : {}) },
      {
        onSuccess: (detail) => {
          if (!source || next === "import") {
            onCreated(detail, next);
            return;
          }
          useAddToRepertoireStore.getState().open({
            source,
            initialScope: { kind: "whole-game" },
            entry: "new-repertoire",
            preselect: {
              repertoireId: detail.id,
              chapterId: sortedChapters(detail.chapters)[0]?.id ?? null
            }
          });
          onCreated(detail, "add-game");
        }
      }
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
            onClick={() => void submit("import")}
          >
            <Upload />
            Create and import PGN
          </Button>
          <Button
            type="button"
            variant="primary"
            size="sm"
            disabled={!canCreate}
            onClick={() => void submit("study")}
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
          void submit("study");
        }}
      >
        <Field label="Name" htmlFor={ids.name}>
          <Input
            id={ids.name}
            autoFocus
            placeholder="My 1.e4 repertoire"
            aria-invalid={Boolean(name.trim() && invalidName) || undefined}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          {name.trim() && invalidName ? (
            <p className="text-2xs text-danger">{invalidName}</p>
          ) : null}
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
            options={boardHasGame ? startOptions : startOptions.slice(0, 2)}
          />
          {startFrom === "game" ? (
            <p className={fieldHint}>
              Starts from the board game's position; next, choose what of the game to add. Create
              and import PGN starts from the initial position instead.
            </p>
          ) : null}
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
        <button type="submit" hidden aria-label="Create repertoire" />
      </form>
      {saveError ? <Notice tone="danger">{saveError}</Notice> : null}
      {create.error ? (
        <Notice tone="danger">{ipcErrorMessage(create.error) || "Couldn't create it."}</Notice>
      ) : null}
    </Dialog>
  );
}
