import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "@lichess-org/chessground/assets/chessground.base.css";
import "@lichess-org/chessground/assets/chessground.brown.css";
import "@lichess-org/chessground/assets/chessground.cburnett.css";
import "./styles/app.css";
import { pieceThemeCss } from "./styles/generated-piece-themes";
import { TooltipProvider } from "./components/ui/tooltip";
import { Router } from "./app/Router";
import { initWindowGlass, initWindowZoom } from "./lib/window-glass";

initWindowGlass();
initWindowZoom();

// Everything here is local (SQLite, files, engines over IPC), so queries and saves must run while
// the OS reports no network — TanStack's default "online" mode would pause them. Remote work
// (downloads, Lichess) happens in the main process, which reports its own network errors.
// A local failure is deterministic: one retry is enough.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: { networkMode: "always", retry: 1 },
    mutations: { networkMode: "always" }
  }
});

const pieceStyles = document.createElement("style");
pieceStyles.textContent = await pieceThemeCss();
document.head.appendChild(pieceStyles);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Router />
      </TooltipProvider>
    </QueryClientProvider>
  </React.StrictMode>
);
