import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { MaiaDownloadPrompt } from "../features/game-review/MaiaDownloadPrompt";
import { useAppNoticeStore } from "../stores/app-notice-store";

/**
 * Above the page: the app's notice (with its action, Maia 3's download when it offers it, and
 * Dismiss), and the web preview's warning.
 */
export function AppNotices({ desktopApiAvailable }: { desktopApiAvailable: boolean }) {
  const appNotice = useAppNoticeStore((state) => state.message);
  const appNoticeTone = useAppNoticeStore((state) => state.tone);
  const appNoticeAction = useAppNoticeStore((state) => state.action);
  const offerMaia3 = useAppNoticeStore((state) => state.maia3Download);
  const dismissAppNotice = useAppNoticeStore((state) => state.dismiss);
  return (
    <>
      {appNotice ? (
        <Notice
          tone={appNoticeTone}
          className="mx-(--page-gutter) mt-(--page-gutter-y) w-auto shrink-0"
          action={
            <div className="flex items-center gap-2">
              {offerMaia3 ? <MaiaDownloadPrompt variant="button" /> : null}
              {appNoticeAction ? (
                <Button
                  type="button"
                  variant="outline"
                  size="xs"
                  onClick={() => {
                    dismissAppNotice();
                    appNoticeAction.onSelect();
                  }}
                >
                  {appNoticeAction.label}
                </Button>
              ) : null}
              <Button type="button" variant="link" size="xs" onClick={dismissAppNotice}>
                Dismiss
              </Button>
            </div>
          }
        >
          {appNotice}
        </Notice>
      ) : null}
      {!desktopApiAvailable ? (
        <Notice
          tone="warn"
          title="Web preview mode"
          className="mx-(--page-gutter) mt-(--page-gutter-y) w-auto shrink-0"
        >
          Engines, file dialogs, saved games, downloads and local databases need the desktop app.
        </Notice>
      ) : null}
    </>
  );
}
