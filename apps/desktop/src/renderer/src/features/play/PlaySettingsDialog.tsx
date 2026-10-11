import {
  useCallback,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode
} from "react";
import { Bot, Check, ChevronDown, Globe, SquareDashed, UserPlus } from "lucide-react";
import { engineDisplayName } from "@chaturanga/shared/engine/managed";
import type { EngineConfig } from "@chaturanga/shared/types/engine";
import type { PlayOpponent } from "@chaturanga/shared/types/settings";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { settingsListboxPositionClass, settingsListboxSurfaceClass } from "@/lib/settings-listbox";
import { frost } from "@/lib/ui";
import { EngineAvatar } from "../analysis/EngineAvatar";
import { playEngineOrder } from "./play-layout";
import { useDismiss } from "@/lib/use-dismiss";
import { useListboxKeyboard } from "@/lib/use-listbox-keyboard";
import { cn } from "@/lib/utils";

const OPTIONS: readonly PlayOpponent[] = ["engine", "pool", "friend", "ai", "board"];

const NAMES: Record<Exclude<PlayOpponent, "engine">, string> = {
  pool: "Quick pairing",
  friend: "Challenge a friend",
  ai: "Play the Lichess AI",
  board: "Free board"
};

/**
 * Play settings (the Play card's cog): which opponent the Play card opens with, and which engine.
 * One radio group across Engines / Lichess / Other; the engine row's dropdown lists the installed
 * engines (choosing in it selects that row). Save writes the choice and switches the card to it.
 */
export function PlaySettingsDialog({
  mode,
  engines,
  engineId,
  lichess,
  onConnectLichess,
  onSave,
  onOpenEngineSettings,
  onClose
}: {
  mode: PlayOpponent;
  engines: readonly EngineConfig[];
  /** The engine the card plays now (null: none installed). */
  engineId: string | null;
  /** The Lichess account (null when not connected) and your quick-pairing rating. */
  lichess: { username: string; rating: number | null } | null;
  onConnectLichess: (() => void) | null;
  onSave: (choice: { opponent: PlayOpponent; engineId: string | null }) => void;
  onOpenEngineSettings: () => void;
  onClose: () => void;
}) {
  const orderedEngines = useMemo(() => playEngineOrder(engines), [engines]);
  const [pick, setPick] = useState<PlayOpponent>(mode);
  const [pickedEngine, setPickedEngine] = useState<string | null>(engineId);
  const rows = useRef(new Map<PlayOpponent, HTMLElement>());
  const usable = (option: PlayOpponent) =>
    option === "engine" ? engines.length > 0 : option === "board" || Boolean(lichess);
  // Arrow keys move the choice through the usable rows (the radio group pattern).
  const onGroupKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const delta =
      event.key === "ArrowDown" || event.key === "ArrowRight"
        ? 1
        : event.key === "ArrowUp" || event.key === "ArrowLeft"
          ? -1
          : 0;
    if (!delta || !(event.target instanceof HTMLElement) || event.target.role !== "radio") return;
    const enabled = OPTIONS.filter(usable);
    const next = enabled.at((enabled.indexOf(pick) + delta + enabled.length) % enabled.length);
    if (!next) return;
    event.preventDefault();
    setPick(next);
    rows.current.get(next)?.focus();
  };
  const register = (option: PlayOpponent) => (element: HTMLElement | null) => {
    if (element) rows.current.set(option, element);
    else rows.current.delete(option);
  };

  return (
    <Dialog
      title="Play settings"
      size="sm"
      onClose={onClose}
      footer={
        <div className="-mx-5 -mb-5 flex flex-1 items-center gap-2 border-t border-line-subtle px-4 py-3">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="mr-auto"
            onClick={() => {
              onClose();
              onOpenEngineSettings();
            }}
          >
            <Bot />
            Engine settings
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="primary"
            size="sm"
            disabled={!usable(pick)}
            onClick={() => onSave({ opponent: pick, engineId: pickedEngine })}
          >
            Save
          </Button>
        </div>
      }
    >
      <div className="grid gap-4">
        <div className="grid gap-1">
          <span className="text-xs font-medium text-fg-muted">Open Play with</span>
          <span className="text-[0.78125rem] text-fg-subtle">
            The Play card starts on this opponent each time.
          </span>
        </div>
        <div
          role="radiogroup"
          aria-label="Open Play with"
          // Focus sits on its radios (one in the Tab order); arrow keys move the choice.
          tabIndex={-1}
          className="grid gap-4"
          onKeyDown={onGroupKeyDown}
        >
          <Group title="Engines">
            <EngineRow
              ref={register("engine")}
              engines={orderedEngines}
              engineId={pickedEngine}
              checked={pick === "engine"}
              onPick={() => setPick("engine")}
              onEngine={(id) => {
                setPickedEngine(id);
                setPick("engine");
              }}
            />
          </Group>
          <Group
            title={lichess ? `Lichess · ${lichess.username}` : "Lichess"}
            action={
              !lichess && onConnectLichess ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  className="h-5.5 px-1.5 text-2xs"
                  onClick={onConnectLichess}
                >
                  Connect
                </Button>
              ) : null
            }
          >
            {(["pool", "friend", "ai"] as const).map((option) => (
              <OptionRow
                key={option}
                ref={register(option)}
                icon={option === "pool" ? <Globe /> : option === "friend" ? <UserPlus /> : <Bot />}
                name={NAMES[option]}
                checked={pick === option}
                disabled={!lichess}
                extra={
                  option === "pool" && lichess?.rating ? (
                    <small className="mr-2.5 text-xs tabular-nums text-fg-subtle">
                      {lichess.rating}
                    </small>
                  ) : null
                }
                onPick={() => setPick(option)}
              />
            ))}
          </Group>
          <Group title="Other">
            <OptionRow
              ref={register("board")}
              icon={<SquareDashed />}
              name={NAMES.board}
              checked={pick === "board"}
              onPick={() => setPick("board")}
            />
          </Group>
        </div>
      </div>
    </Dialog>
  );
}

function Group({
  title,
  action,
  children
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="grid gap-1">
      <span className="flex min-h-4 items-center gap-2 px-0.5 pb-0.5 text-2xs text-fg-subtle">
        {title}
        {action}
      </span>
      {children}
    </div>
  );
}

const optionRow =
  "flex w-full items-center gap-3 rounded-[10px] border border-line bg-surface px-3 py-2.25 text-left outline-none transition-colors duration-micro hover:border-line-strong focus-visible:ring-2 focus-visible:ring-accent/70 aria-checked:border-accent-strong aria-checked:bg-accent-soft/50 disabled:pointer-events-none disabled:opacity-50";

/** The row's small logo tile (an engine row shows the engine's image slot instead). */
function Logo({ children }: { children: ReactNode }) {
  return (
    <span
      aria-hidden="true"
      className="grid size-6.5 shrink-0 place-items-center rounded-[7px] bg-control text-fg-secondary [&>svg]:size-3.5"
    >
      {children}
    </span>
  );
}

/** The radio's ring, filled when chosen. */
function RadioMark({ checked }: { checked: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "size-4 shrink-0 rounded-full",
        checked
          ? "bg-accent shadow-[inset_0_0_0_1.5px_var(--color-accent),inset_0_0_0_4.5px_var(--color-surface-raised)]"
          : "shadow-[inset_0_0_0_1.5px_var(--color-line-strong)]"
      )}
    />
  );
}

function OptionRow({
  ref,
  icon,
  name,
  checked,
  disabled = false,
  extra,
  onPick
}: {
  ref: (element: HTMLElement | null) => void;
  icon: ReactNode;
  name: string;
  checked: boolean;
  disabled?: boolean;
  extra?: ReactNode;
  onPick: () => void;
}) {
  return (
    <button
      ref={ref}
      type="button"
      role="radio"
      aria-checked={checked}
      tabIndex={checked ? 0 : -1}
      disabled={disabled}
      className={optionRow}
      onClick={onPick}
    >
      <Logo>{icon}</Logo>
      <b className="min-w-0 flex-1 truncate text-[0.84375rem] font-medium text-fg">{name}</b>
      {extra}
      <RadioMark checked={checked} />
    </button>
  );
}

/**
 * The engine row: the dropdown of installed engines (display names; unavailable ones can't be
 * chosen) and the radio. Opening or choosing in the dropdown selects the row.
 */
function EngineRow({
  ref,
  engines,
  engineId,
  checked,
  onPick,
  onEngine
}: {
  ref: (element: HTMLElement | null) => void;
  engines: readonly EngineConfig[];
  engineId: string | null;
  checked: boolean;
  onPick: () => void;
  onEngine: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const listId = useId();
  const selectedIndex = Math.max(
    0,
    engines.findIndex((engine) => engine.id === engineId)
  );
  const { triggerRef, highlightedIndex, setHighlightedIndex, optionId, commit, onTriggerKeyDown } =
    useListboxKeyboard({
      id: listId,
      count: engines.length,
      selectedIndex,
      isDisabled: (index) => !engines[index]?.isAvailable,
      open,
      setOpen: (next) => {
        if (next) onPick();
        setOpen(next);
      },
      onCommit: (index) => {
        const engine = engines.at(index);
        if (engine) onEngine(engine.id);
      }
    });
  const close = useCallback(() => setOpen(false), []);
  useDismiss(rootRef, open, close);

  if (!engines.length) {
    return (
      <button type="button" role="radio" aria-checked={false} disabled className={optionRow}>
        <EngineAvatar size="sm" />
        <b className="min-w-0 flex-1 truncate text-[0.84375rem] font-medium text-fg">
          No engine installed
        </b>
        <RadioMark checked={false} />
      </button>
    );
  }

  const selected = engines[selectedIndex];
  return (
    <div
      ref={rootRef}
      className={cn(
        optionRow,
        "relative py-2",
        checked && "border-accent-strong bg-accent-soft/50"
      )}
    >
      <EngineAvatar imagePath={selected.imagePath} size="sm" />
      <button
        ref={triggerRef}
        type="button"
        role="combobox"
        aria-label="Engine"
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={open ? `${listId}-listbox` : undefined}
        aria-activedescendant={open ? optionId(highlightedIndex) : undefined}
        className={cn(
          "flex h-10 min-w-0 flex-1 items-center gap-2 rounded-[9px] border border-line-strong bg-surface-sunken pl-3 pr-2.5 text-left outline-none transition-colors duration-micro hover:border-accent focus-visible:ring-2 focus-visible:ring-accent/70",
          open && "border-accent"
        )}
        onClick={() => {
          onPick();
          setOpen((value) => !value);
        }}
        onKeyDown={onTriggerKeyDown}
      >
        <b className="min-w-0 flex-1 truncate text-[0.84375rem] font-medium text-fg">
          {engineDisplayName(selected.name)}
        </b>
        <ChevronDown
          className={cn(
            "size-3.75 shrink-0 text-fg-muted transition-transform duration-standard",
            open && "rotate-180"
          )}
          aria-hidden="true"
        />
      </button>
      <button
        ref={ref}
        type="button"
        role="radio"
        aria-checked={checked}
        aria-label={`Engine: ${engineDisplayName(selected.name)}`}
        tabIndex={checked ? 0 : -1}
        className="-m-1 grid place-items-center rounded-full p-1 outline-none focus-visible:ring-2 focus-visible:ring-accent/70"
        onClick={onPick}
      >
        <RadioMark checked={checked} />
      </button>
      {open ? (
        <div className={cn(settingsListboxPositionClass, "left-12 right-9.5 top-[calc(100%+4px)]")}>
          {/* The frosted layer under the list (glass), as in the piece-set listbox. */}
          <span aria-hidden="true" className={cn(frost, "rounded-lg")} />
          <div
            id={`${listId}-listbox`}
            role="listbox"
            aria-label="Engines"
            className={settingsListboxSurfaceClass}
          >
            {engines.map((engine, index) => {
              const active = engine.id === selected.id;
              return (
                <button
                  key={engine.id}
                  id={optionId(index)}
                  type="button"
                  role="option"
                  aria-selected={active}
                  aria-disabled={!engine.isAvailable || undefined}
                  tabIndex={-1}
                  disabled={!engine.isAvailable}
                  className={cn(
                    "flex items-center gap-2.5 rounded-[7px] px-2 py-1.5 text-left outline-none transition-colors duration-micro hover:bg-control disabled:cursor-not-allowed disabled:opacity-50",
                    index === highlightedIndex && "bg-control"
                  )}
                  onMouseEnter={() => setHighlightedIndex(index)}
                  onClick={() => commit(index)}
                >
                  <EngineAvatar imagePath={engine.imagePath} size="sm" />
                  <b className="min-w-0 flex-1 truncate text-[0.84375rem] font-medium text-fg">
                    {engineDisplayName(engine.name)}
                  </b>
                  {active ? (
                    <Check className="size-4 shrink-0 text-accent" aria-hidden="true" />
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}
