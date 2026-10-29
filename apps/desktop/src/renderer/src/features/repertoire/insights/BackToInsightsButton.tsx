import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Game review's "Back to Insights" button (BackToInsightsAction shows it). */
export function BackToInsightsButton({ onBack }: { onBack: () => void }) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="[-webkit-app-region:no-drag]"
      onClick={onBack}
    >
      <ArrowLeft />
      Back to Insights
    </Button>
  );
}
