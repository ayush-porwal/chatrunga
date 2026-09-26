import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "@lichess-org/chessground/assets/chessground.base.css";
import "@lichess-org/chessground/assets/chessground.brown.css";
import "@lichess-org/chessground/assets/chessground.cburnett.css";
import "./styles/generated-piece-themes.css";
import "./styles/app.css";
import { TooltipProvider } from "./components/ui/tooltip";
import { Router } from "./app/Router";
import { initWindowGlass, initWindowZoom } from "./lib/window-glass";

initWindowGlass();
initWindowZoom();

const queryClient = new QueryClient();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Router />
      </TooltipProvider>
    </QueryClientProvider>
  </React.StrictMode>
);
