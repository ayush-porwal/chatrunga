import { ipcMain, type IpcMainInvokeEvent } from "electron";
import { isTrustedSenderUrl } from "./security";

/**
 * Every `ipcMain.handle` channel answers only the app's own page (Electron's IPC security
 * guidance): a request from any other frame — an injected page, a navigated-away window — is
 * refused before its handler runs. Installed once, before any handler is registered.
 */
export function guardIpcSenders(appUrl: string): void {
  const handle = ipcMain.handle.bind(ipcMain);
  ipcMain.handle = ((
    channel: string,
    listener: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown
  ) =>
    handle(channel, (event, ...args: unknown[]) => {
      if (!isTrustedSenderUrl(event.senderFrame?.url, appUrl)) {
        throw new Error(`${channel} is only available to the app's own page.`);
      }
      return listener(event, ...args);
    })) as typeof ipcMain.handle;
}
