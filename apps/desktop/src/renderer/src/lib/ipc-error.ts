/**
 * The main process's error message. `ipcRenderer.invoke` wraps it as
 * "Error invoking remote method 'channel': Error: message", so compare and show this instead.
 */
export function ipcErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  return message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "");
}
