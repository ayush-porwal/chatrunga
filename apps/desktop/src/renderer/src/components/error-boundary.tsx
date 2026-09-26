import { Component, type ReactNode } from "react";
import { AlertTriangle, CircleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";

type Props = {
  /** Shown as the fallback heading ("Game review hit an error"). */
  title: string;
  /** Log tag for the error ("app", "game-review"). */
  scope: string;
  /** `window` fills the whole window (top-level boundary); `panel` fills its container. */
  layout?: "window" | "panel";
  children: ReactNode;
};

type State = { error: Error | null };

/**
 * Catches a render error below it and shows a recoverable fallback instead of a blank window.
 * Only the error's name is shown and logged: a provider/IPC message must never be able to echo a
 * credential into the UI or developer logs.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error(`[${this.props.scope}] renderer error`, error.name);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const fullWindow = this.props.layout === "window";
    const fallback = (
      <EmptyState
        icon={fullWindow ? <AlertTriangle /> : <CircleAlert />}
        title={this.props.title}
        description={`Renderer error: ${error.name}`}
        action={
          <Button type="button" variant="outline" size={fullWindow ? "default" : "sm"} onClick={() => this.setState({ error: null })}>
            Try again
          </Button>
        }
      />
    );
    return fullWindow ? (
      <main className="grid min-h-screen place-items-center bg-canvas p-8 text-fg">{fallback}</main>
    ) : (
      <div className="grid h-full place-items-center p-8">{fallback}</div>
    );
  }
}
