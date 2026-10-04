import { useState } from "react";
import { Globe, Loader2, LogOut, RefreshCw } from "lucide-react";
import type { LichessAccount, LichessSpeed } from "@chaturanga/shared/types/lichess";
import { useRefreshGames } from "../../queries/api";
import { useGameStore } from "../../stores/game-store";
import { useReviewStore } from "../../stores/review-store";
import { useLichessStore } from "../../stores/lichess-store";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { SettingRow } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { SectionHeader } from "@/components/ui/page";
import { Switch } from "@/components/ui/switch";
import { cardPadded } from "@/lib/ui";
import { cn } from "@/lib/utils";
import { lichessErrorMessage, speedLabel } from "./lichess-game";

/** Sign in with Lichess (in the browser), with the error of the last attempt. */
function useLichessConnect() {
  const connecting = useLichessStore((state) => state.status.connecting);
  const [error, setError] = useState<string | null>(null);
  const api = window.chaturanga?.lichess;
  return {
    available: Boolean(api),
    connecting,
    error,
    connect: () => {
      if (!api) return;
      setError(null);
      api.connect().then(
        (status) => useLichessStore.getState().setStatus(status),
        (reason: unknown) => setError(lichessErrorMessage(reason, "Couldn’t connect to Lichess."))
      );
    },
    cancel: () => void api?.cancelConnect()
  };
}

/** "Connect Lichess account", or the waiting-for-the-browser state with Cancel. */
export function LichessConnectButton({ label = "Connect Lichess account" }: { label?: string }) {
  const { available, connecting, error, connect, cancel } = useLichessConnect();
  return (
    <div className="grid justify-items-start gap-2">
      {connecting ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="flex items-center gap-2 text-sm text-fg-secondary">
            <Loader2 className="size-4 animate-spin text-accent" aria-hidden="true" />
            Approve Chaturanga on lichess.org in your browser…
          </span>
          <Button type="button" variant="ghost" size="sm" onClick={cancel}>
            Cancel
          </Button>
        </div>
      ) : (
        <Button type="button" variant="primary" disabled={!available} onClick={connect}>
          <Globe />
          {label}
        </Button>
      )}
      {error ? <Notice tone="danger">{error}</Notice> : null}
    </div>
  );
}

const RATING_SPEEDS: readonly LichessSpeed[] = ["rapid", "classical", "blitz", "bullet"];

/** The account's ratings for the speeds it has played, most relevant first. */
export function LichessRatings({
  account,
  className
}: {
  account: LichessAccount;
  className?: string;
}) {
  const perfs = RATING_SPEEDS.flatMap((speed) => {
    const perf = account.perfs[speed];
    return perf && perf.games > 0 ? [{ speed, perf }] : [];
  });
  if (!perfs.length) return null;
  return (
    <span className={cn("flex flex-wrap gap-1.5", className)}>
      {perfs.map(({ speed, perf }) => (
        <Badge key={speed} className="tabular-nums">
          {speedLabel(speed)} {perf.rating}
          {perf.provisional ? "?" : ""}
        </Badge>
      ))}
    </span>
  );
}

/** Settings → Lichess: connect, import games, disconnect. */
export function LichessAccountSection() {
  const status = useLichessStore((state) => state.status);
  const sync = useLichessStore((state) => state.sync);
  const refreshGames = useRefreshGames();
  const [disconnectOpen, setDisconnectOpen] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const account = status.account;
  const api = window.chaturanga?.lichess;

  function importGames() {
    if (!api) return;
    setSyncError(null);
    api.syncGames().then(
      () => refreshGames(),
      (reason: unknown) => setSyncError(lichessErrorMessage(reason, "Couldn’t import your games."))
    );
  }

  return (
    <section className={cn(cardPadded, "grid gap-4")}>
      <SectionHeader
        title="Lichess"
        description="Play on lichess.org from the Play page, and review your Lichess games here."
      />
      {!account ? (
        <LichessConnectButton />
      ) : (
        <div className="grid max-w-xl gap-3">
          {status.tokenRejected ? (
            <Notice
              tone="warn"
              title="Lichess signed Chaturanga out"
              action={<LichessConnectButton label="Reconnect" />}
            >
              The access was revoked or has expired. Reconnect to keep playing and importing games.
            </Notice>
          ) : null}
          <div className="grid gap-1.5">
            <span className="text-sm font-medium text-fg">
              {account.title ? `${account.title} ` : ""}
              {account.username}
            </span>
            <LichessRatings account={account} />
          </div>
          <SettingRow
            label="Your games"
            description={
              sync.running
                ? `Importing… ${sync.imported} so far`
                : account.lastSyncAt
                  ? `New games are imported when you open the app. Last import ${new Date(account.lastSyncAt).toLocaleString()}.`
                  : "The first import brings in the last year of games."
            }
            control={
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={sync.running || status.tokenRejected}
                onClick={importGames}
              >
                {sync.running ? <Loader2 className="animate-spin" /> : <RefreshCw />}
                Import now
              </Button>
            }
          />
          {syncError || sync.error ? (
            <Notice tone="danger">{syncError ?? sync.error}</Notice>
          ) : null}
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
        </div>
      )}
      {disconnectOpen && account ? (
        <DisconnectDialog username={account.username} onClose={() => setDisconnectOpen(false)} />
      ) : null}
    </section>
  );
}

function DisconnectDialog({ username, onClose }: { username: string; onClose: () => void }) {
  const [removeGames, setRemoveGames] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refreshGames = useRefreshGames();

  function disconnect() {
    const api = window.chaturanga?.lichess;
    if (!api) return;
    setBusy(true);
    api.disconnect({ removeGames }).then(
      (status) => {
        useLichessStore.getState().setStatus(status);
        if (removeGames) {
          // Its row is gone (and saves of it are refused): take the removed game off the board.
          if (useGameStore.getState().source === "lichess") {
            useGameStore.getState().reset();
            useReviewStore.getState().reset();
          }
          refreshGames();
        }
        onClose();
      },
      (reason: unknown) => {
        setBusy(false);
        setError(lichessErrorMessage(reason, "Couldn’t disconnect."));
      }
    );
  }

  return (
    <Dialog
      title={`Disconnect ${username}?`}
      description="Chaturanga signs out and gives up its access on lichess.org."
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
        label="Also remove imported Lichess games"
        description="Games you played or imported stay in your library unless you remove them."
        control={
          <Switch
            checked={removeGames}
            onCheckedChange={setRemoveGames}
            aria-label="Also remove imported Lichess games"
          />
        }
      />
      {error ? <Notice tone="danger">{error}</Notice> : null}
    </Dialog>
  );
}
