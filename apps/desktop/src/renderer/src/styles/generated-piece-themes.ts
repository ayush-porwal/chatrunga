// The drawings ship as a gzip file, not a base64 string, and are inflated before first paint.
import gzUrl from "./generated-piece-themes.css.gz?url";

export async function pieceThemeCss(): Promise<string> {
  const response = await fetch(gzUrl);
  if (!response.ok || !response.body) throw new Error("Piece theme drawings did not load");
  const stream = response.body.pipeThrough(new DecompressionStream("gzip"));
  return new Response(stream).text();
}
