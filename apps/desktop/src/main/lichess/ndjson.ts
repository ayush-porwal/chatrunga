/**
 * Newline-delimited JSON from a fetch response body (Lichess streams: events, games, exports).
 * A line may arrive split across chunks; empty lines are Lichess's keep-alives and are skipped,
 * as is a line that isn't valid JSON (one bad line shouldn't end a long-lived stream).
 */
export async function* readNdjson(
  body: ReadableStream<Uint8Array>,
  onChunk?: () => void
): AsyncGenerator<unknown> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      onChunk?.();
      buffer += decoder.decode(value, { stream: true });
      let newline = buffer.indexOf("\n");
      while (newline !== -1) {
        const parsed = parseLine(buffer.slice(0, newline));
        buffer = buffer.slice(newline + 1);
        if (parsed !== undefined) yield parsed;
        newline = buffer.indexOf("\n");
      }
    }
    const last = parseLine(buffer + decoder.decode());
    if (last !== undefined) yield last;
  } finally {
    // Stopping early (a `break`, an abort) must release the connection.
    await reader.cancel().catch(() => undefined);
  }
}

function parseLine(line: string): unknown {
  const text = line.trim();
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
