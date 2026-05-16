export function hasDesktopApi(): boolean {
  return Boolean(window.chaturanga?.environment?.isElectron);
}

export function isElectronMac(): boolean {
  return window.chaturanga?.environment?.platform === "darwin";
}
