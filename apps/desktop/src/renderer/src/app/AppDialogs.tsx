import { Suspense } from "react";
import { PromotionDialog } from "../features/board/PromotionDialog";
import { PgnImportDialog } from "../features/game/PgnImportDialog";
import { useAddToRepertoireStore } from "../stores/add-to-repertoire-store";
import { AddToRepertoireDialog, GameReviewPicker, OnboardingFlow } from "./AppPages";
import type { AppCommands } from "./useAppCommands";

/** The dialogs over the app frame: promotion, the welcome, PGN import, Add to repertoire, the review picker. */
export function AppDialogs({
  onboarding,
  importOpen,
  reviewPickerOpen,
  on
}: {
  onboarding: { open: boolean; finish: () => void };
  importOpen: boolean;
  reviewPickerOpen: boolean;
  on: Pick<
    AppCommands,
    | "play"
    | "closeImportDialog"
    | "importedGame"
    | "closeAddToRepertoire"
    | "addedToRepertoire"
    | "closeReviewPicker"
    | "reviewGame"
    | "openImportDialog"
  >;
}) {
  const addToRepertoire = useAddToRepertoireStore((state) => state.request);
  return (
    <>
      <PromotionDialog />
      <Suspense fallback={null}>
        {onboarding.open ? (
          <OnboardingFlow onFinish={onboarding.finish} onGoPlay={on.play} />
        ) : null}
        {importOpen ? (
          <PgnImportDialog onClose={on.closeImportDialog} onImported={on.importedGame} />
        ) : null}
        {addToRepertoire ? (
          <AddToRepertoireDialog
            source={addToRepertoire.source}
            initialScope={addToRepertoire.initialScope}
            preselect={addToRepertoire.preselect}
            onClose={on.closeAddToRepertoire}
            onDone={on.addedToRepertoire}
          />
        ) : null}
        {reviewPickerOpen ? (
          <GameReviewPicker
            onClose={on.closeReviewPicker}
            onSelect={on.reviewGame}
            onImport={on.openImportDialog}
          />
        ) : null}
      </Suspense>
    </>
  );
}
