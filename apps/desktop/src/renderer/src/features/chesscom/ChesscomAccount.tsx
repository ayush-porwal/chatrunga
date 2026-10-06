import { useId, useState, type FormEvent } from "react";
import { Link, Loader2, LogOut, RefreshCw } from "lucide-react";
import {
  CHESSCOM_IMPORT_WINDOWS,
  CHESSCOM_USERNAME,
  DEFAULT_CHESSCOM_IMPORT_WINDOW,
  type ChesscomAccount,
  type ChesscomImportWindow,
  type ChesscomRatingKey
} from "@chaturanga/shared/types/chesscom";
import { isOneOf } from "@chaturanga/shared/types/guards";
import { useGameFacetsQuery, useRefreshGames } from "../../queries/api";
import { useChesscomStore } from "../../stores/chesscom-store";
import { useGameStore } from "../../stores/game-store";
import { useReviewStore } from "../../stores/review-store";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, SettingRow } from "@/components/ui/field";
import { Input, Select } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { SectionHeader } from "@/components/ui/page";
import { Switch } from "@/components/ui/switch";
import { ipcErrorMessage } from "@/lib/ipc-error";
import { cardPadded } from "@/lib/ui";
import { cn } from "@/lib/utils";

const IMPORT_WINDOW_LABELS: Record<ChesscomImportWindow, string> = {
  "3months": "Last 3 months",
  year: "Last year",
  all: "All games"
};

const RATING_LABELS: Record<ChesscomRatingKey, string> = {
  rapid: "Rapid",
  blitz: "Blitz",
  bullet: "Bullet",
  daily: "Daily"
};

/** Badge order: the most relevant first, as Lichess's. */
const RATING_ORDER: readonly ChesscomRatingKey[] = ["rapid", "blitz", "bullet", "daily"];

function errorText(reason: unknown, fallback: string): string {
  return ipcErrorMessage(reason) || fallback;
}

/** The account's ratings, one badge per kind of game it has a rating for. */
export function ChesscomRatings({ account }: { account: ChesscomAccount }) {
  const ratings = RATING_ORDER.flatMap((key) => {
    const rating = account.ratings[key];
    return rating === undefined ? [] : [{ key, rating }];
  });
  if (!ratings.length) return null;
  return (
    <span className="flex flex-wrap gap-1.5">
      {ratings.map(({ key, rating }) => (
        <Badge key={key} className="tabular-nums">
          {RATING_LABELS[key]} {rating}
        </Badge>
      ))}
    </span>
  );
}

/** Settings → Chess.com: connect a username, import games, disconnect. */
export function ChesscomAccountSection() {
  const account = useChesscomStore((state) => state.status.account);
  return (
    <section className={cn(cardPadded, "grid content-start gap-4")}>
      <SectionHeader
        title="Chess.com"
        description="Review your chess.com games here. Play stays on lichess.org: chess.com games can’t be played from the app."
      />
      {account ? <ConnectedAccount account={account} /> : <ConnectForm />}
    </section>
  );
}

/** A username and how far back the first import goes; Connect checks the player exists. */
function ConnectForm() {
  const connecting = useChesscomStore((state) => state.status.connecting);
  const [username, setUsername] = useState("");
  const [firstImport, setFirstImport] = useState<ChesscomImportWindow>(
    DEFAULT_CHESSCOM_IMPORT_WINDOW
  );
  const [error, setError] = useState<string | null>(null);
  const id = useId();
  const api = window.chaturanga?.chesscom;
  const name = username.trim();

  function connect(event: FormEvent) {
    event.preventDefault();
    if (!api || connecting) return;
    if (!CHESSCOM_USERNAME.test(name)) {
      setError("Chess.com usernames have letters, digits, _ and - only.");
      return;
    }
    setError(null);
    api.connect({ username: name, firstImport }).then(
      (status) => useChesscomStore.getState().setStatus(status),
      (reason: unknown) => setError(errorText(reason, "Couldn’t connect to chess.com."))
    );
  }

  return (
    <form className="grid max-w-xl gap-3" onSubmit={connect}>
      <Field label="Chess.com username" htmlFor={`${id}-username`}>
        <div className="flex items-center gap-2">
          <Input
            id={`${id}-username`}
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            placeholder="Your chess.com username"
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            maxLength={50}
            disabled={connecting}
          />
          <Button type="submit" variant="primary" disabled={!api || connecting || !name}>
            {connecting ? <Loader2 className="animate-spin" /> : <Link />}
            Connect
          </Button>
        </div>
      </Field>
      <SettingRow
        label="First import"
        htmlFor={`${id}-first-import`}
        description="How far back the first import goes. After that, new games are imported when you open the app."
        control={
          <Select
            id={`${id}-first-import`}
            className="w-38"
            value={firstImport}
            disabled={connecting}
            onChange={(event) => {
              const value = event.target.value;
              if (isOneOf(CHESSCOM_IMPORT_WINDOWS, value)) setFirstImport(value);
            }}
          >
            {CHESSCOM_IMPORT_WINDOWS.map((option) => (
              <option key={option} value={option}>
                {IMPORT_WINDOW_LABELS[option]}
              </option>
            ))}
          </Select>
        }
      />
      {error ? <Notice tone="danger">{error}</Notice> : null}
      <p className="text-xs leading-5 text-fg-subtle">
        No password: the app reads your public games and ratings from chess.com.
      </p>
    </form>
  );
}

function ConnectedAccount({ account }: { account: ChesscomAccount }) {
  const sync = useChesscomStore((state) => state.sync);
  const games = useGameFacetsQuery(null).data?.tabs.chesscom.games ?? null;
  const refreshGames = useRefreshGames();
  const [syncError, setSyncError] = useState<string | null>(null);
  const [disconnectOpen, setDisconnectOpen] = useState(false);
  const api = window.chaturanga?.chesscom;

  function importGames() {
    if (!api) return;
    setSyncError(null);
    api.syncGames().then(
      () => refreshGames(),
      (reason: unknown) => setSyncError(errorText(reason, "Couldn’t import your games."))
    );
  }

  const count = games === null ? "" : `${games} ${games === 1 ? "game" : "games"}. `;
  return (
    <div className="grid max-w-xl gap-3">
      <div className="grid gap-1.5">
        <span className="text-sm font-medium text-fg">
          {account.title ? `${account.title} ` : ""}
          {account.username}
        </span>
        <ChesscomRatings account={account} />
      </div>
      <SettingRow
        label="Your games"
        description={
          sync.running
            ? `Importing… ${sync.imported} so far`
            : account.lastSyncAt
              ? `${count}New games are imported when you open the app. Last import ${new Date(account.lastSyncAt).toLocaleString()}.`
              : `${count}New games are imported when you open the app.`
        }
        control={
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={sync.running}
            onClick={importGames}
          >
            {sync.running ? <Loader2 className="animate-spin" /> : <RefreshCw />}
            Import now
          </Button>
        }
      />
      {syncError || sync.error ? <Notice tone="danger">{syncError ?? sync.error}</Notice> : null}
      <div>
        <Button
          type="button"
          variant="ghost-destructive"
          size="sm"
          onClick={() => setDisconnectOpen(true)}
        >
          <LogOut />
          Disconnect
        </Button>
      </div>
      {disconnectOpen ? (
        <DisconnectDialog username={account.username} onClose={() => setDisconnectOpen(false)} />
      ) : null}
    </div>
  );
}

function DisconnectDialog({ username, onClose }: { username: string; onClose: () => void }) {
  const [removeGames, setRemoveGames] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refreshGames = useRefreshGames();

  function disconnect() {
    const api = window.chaturanga?.chesscom;
    if (!api) return;
    setBusy(true);
    api.disconnect({ removeGames }).then(
      (status) => {
        useChesscomStore.getState().setStatus(status);
        if (removeGames) {
          // Its row is gone (and saves of it are refused): take the removed game off the board.
          if (useGameStore.getState().source === "chesscom") {
            useGameStore.getState().reset();
            useReviewStore.getState().reset();
          }
          refreshGames();
        }
        onClose();
      },
      (reason: unknown) => {
        setBusy(false);
        setError(errorText(reason, "Couldn’t disconnect."));
      }
    );
  }

  return (
    <Dialog
      title={`Disconnect ${username}?`}
      description="Chaturanga stops importing this account’s games and ratings. Nothing changes on chess.com."
      size="sm"
      onClose={onClose}
      footer={
        <>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" variant="ghost-destructive" disabled={busy} onClick={disconnect}>
            Disconnect
          </Button>
        </>
      }
    >
      <SettingRow
        label="Also remove imported Chess.com games"
        description="Imported games stay in your library unless you remove them."
        control={
          <Switch
            checked={removeGames}
            onCheckedChange={setRemoveGames}
            aria-label="Also remove imported Chess.com games"
          />
        }
      />
      {error ? <Notice tone="danger">{error}</Notice> : null}
    </Dialog>
  );
}
