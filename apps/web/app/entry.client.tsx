// One recovery boundary for obsolete public documents, including route metadata in <Meta>.
import { startTransition, StrictMode } from "react";
import { hydrateRoot } from "react-dom/client";
import { HydratedRouter } from "react-router/dom";
import { createRenderErrorHandler } from "./lib/render-recovery";
import { installPageTransitions } from "./components/shell/transitions";

// Capture once before hydration; this belongs to the document, not later navigation responses.
const documentRelease = document.querySelector('meta[name="aihot-release"]')?.getAttribute("content") ?? null;
const onError = createRenderErrorHandler(documentRelease);
installPageTransitions();

startTransition(() => {
  hydrateRoot(
    document,
    <StrictMode>
      <HydratedRouter />
    </StrictMode>,
    { onCaughtError: onError },
  );
});
