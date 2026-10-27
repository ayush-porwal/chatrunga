/** The parts of an Electron `before-input-event` input this check reads. */
type KeyInput = {
  type: string;
  key: string;
  alt: boolean;
  control: boolean;
  meta: boolean;
  shift: boolean;
  isAutoRepeat: boolean;
};

/**
 * F11 toggles full screen on Windows and Linux, where the app has no menu to carry it. macOS gets
 * its own shortcuts (Ctrl+Cmd+F, Fn+F) from the View menu's Enter Full Screen item.
 */
export function isFullScreenShortcut(input: KeyInput, platform: NodeJS.Platform): boolean {
  return (
    platform !== "darwin" &&
    input.type === "keyDown" &&
    input.key === "F11" &&
    !input.isAutoRepeat &&
    !input.alt &&
    !input.control &&
    !input.meta &&
    !input.shift
  );
}
