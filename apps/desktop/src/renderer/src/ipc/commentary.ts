import type {
  GenerateCommentaryInput,
  GenerateCommentaryResult
} from "@chaturanga/shared/ipc/chaturanga-api";

export async function requestRendererCommentary(
  input: GenerateCommentaryInput
): Promise<GenerateCommentaryResult> {
  const bridge = window.chaturanga?.commentary;
  if (!bridge?.generate) throw new Error("Desktop commentary bridge unavailable");
  return bridge.generate(input);
}

/** Keep provider/IPC details out of the UI; error text must never echo secrets. */
export function rendererCommentaryError(error: unknown): string {
  void error;
  return "Commentary couldn't be requested. Try again in a moment.";
}
