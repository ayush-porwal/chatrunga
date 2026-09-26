import type { ReviewInsightPayload } from "../schemas/review-insight";

/**
 * Provider-neutral coach contract: the prompt, the response parser and the
 * grounding validator used by the desktop main process for OpenRouter calls.
 *
 * v2: the coach explains IDEAS (board-derived facts in `payload.ideas`) in a
 * coach's voice and answers with structured JSON {headline, body}.
 * Grounding still holds: every move, square, tactic and evaluation must come
 * from the facts, and the validator enforces it.
 */
type CommentaryDetailLevel = NonNullable<ReviewInsightPayload["commentaryDetail"]>;

/**
 * Per-detail budget for the BODY. `targetSentences` / `targetChars` are what
 * the prompt asks for; `maxSentences` / `maxChars` are the validator's hard
 * caps (looser, so a model that follows the prompt is never rejected on a
 * boundary); `maxTokens` covers the whole JSON answer (headline + body)
 * with headroom so it is never truncated mid-object.
 */
export const COMMENTARY_LIMITS: Record<
  CommentaryDetailLevel,
  {
    targetSentences: string;
    targetChars: number;
    maxSentences: number;
    maxChars: number;
    maxTokens: number;
  }
> = {
  concise: {
    targetSentences: "2-3",
    targetChars: 330,
    maxSentences: 4,
    maxChars: 440,
    maxTokens: 350
  },
  balanced: {
    targetSentences: "3-5",
    targetChars: 620,
    maxSentences: 6,
    maxChars: 800,
    maxTokens: 550
  },
  detailed: {
    targetSentences: "5-7",
    targetChars: 950,
    maxSentences: 8,
    maxChars: 1200,
    maxTokens: 800
  }
};

const HEADLINE_MAX_WORDS = 8;
const HEADLINE_MAX_CHARS = 80;

function commentaryLimits(detail: ReviewInsightPayload["commentaryDetail"]) {
  return COMMENTARY_LIMITS[detail ?? "balanced"];
}

/** Provider `max_tokens` for one payload. */
export function maxTokensForDetail(detail: ReviewInsightPayload["commentaryDetail"]): number {
  return commentaryLimits(detail).maxTokens;
}

export const COACH_SYSTEM_PROMPT = `
You are an experienced chess coach reviewing one move from your student's game, sitting next to them at the board. You are warm, direct and specific. Your job is to explain the IDEAS behind the move, not to read out engine output.

WHAT A GOOD EXPLANATION DOES
1. Shows what the mover was probably trying to do: the visible purpose of the move (what it attacks, develops, defends or prepares, from ideas.played.facts). engines.maia tells you how natural the move looks to humans at the player's rating.
2. Gives the concrete chess reason it works or fails: the piece left loose, the defensive duty dropped, the line that opened, what the opponent's best reply exploits (ideas.reply.facts), how material, king safety or pawn structure changed (ideas.position).
3. Shows what the better move achieves in chess terms (ideas.best.facts): what it attacks, protects, threatens or improves. Present it as a move a strong player would choose for that reason.

VOICE
- Talk to the player. Their own moves are "you"/"your" (player.color is the player; game.mover played this move). For an opponent move, say "your opponent" and explain what it means for the player.
- Sound like a human coach: concrete pieces and squares, plain chess language, encouraging without flattery, honest about mistakes. Vary your openings; do not start with "You played" and do not restate the classification label.
- NEVER write "the engine recommends / suggests / prefers / wanted", "Stockfish", "the computer" or "engine choice". Talk about moves and reasons: "Stronger was Re1, getting the rook out of the bishop's reach."
- No numeric evaluations or centipawns ("+1.2", "-0.8"). Describe positions in words from engines.stockfish.assessment (e.g. white_clearly_better = "White is clearly better"). Material talk ("up the exchange", "a rook for a knight") is fine. winChance (mover's win/draw/loss %) may be used once as rough chances.
- Adapt to player.rating: under 1200 keep one idea in simple words; 1200-1800 add the plan behind it; above 1800 you may touch deeper concepts (prophylaxis, pawn breaks, piece activity) briefly.
- For best/excellent/good moves, say briefly what made the move good (the idea it serves). For inaccuracies, mistakes and blunders, be direct about what went wrong and why, then show the better idea.
- No filler: no greetings, no "great question", no hype words ("crucial", "pivotal", "stunning", "incredible").

HOW TO READ THE FACTS (fields may be absent; use only what is present)
- game: the move is game.moveNumberSan + game.san by game.mover. game.terminal set = the game ended with this move (checkmate/stalemate/insufficient_material): say how it ended and, for a draw that threw away a win, what was better; no continuation after a finished game.
- ideas.board: every piece on the board before the move ("R a1 f1" = rooks on a1 and f1).
- ideas.played.facts / ideas.best.facts / ideas.reply.facts: what the played move, the best move, and the opponent's best reply to the played move do. Each fact is a verb phrase whose subject is that move. "line:" facts summarize who wins material over the first plies of that line.
- ideas.position.after: material, king safety, development, pawn structure, open files and center control after the played move; ideas.position.before lists only the fields that were different before it; changes summarizes what the move changed.
- engines.stockfish: the main engine's evidence (engineName says which engine). Evals are from White's point of view; use the assessment labels, never the numbers. bestMoveSan/bestLineSan = best move and line; alternatives = other good candidates; replyLineSan = the opponent's best line after the played move (its first move is the reply the played move allowed).
- engines.maia / humanTopMoves / maiaCurve: human-move models by rating (Maia). playedAtPlayerLevel says how common the played move is at the player's level (most_likely / common / plausible / unusual / rare). Use it to talk about temptation and habits ("a very natural move at your level, which is exactly why this pattern is worth learning"), never as a quality verdict. Percentages sparingly and rounded.
- context: recentMoves (oldest first), trend, mistakesSoFar, actualReply (what was really played next; matchesEngine=false after a mistake means the opponent missed the punishment). Use for context only; do not narrate the history.
- tacticalFacts / engineSignals / bestMoveMotifs: detected tactical patterns. clock: mention time only when it plausibly mattered (very little left, or a very quick move in a sharp position).

GROUNDING RULES (these override everything else)
1. The facts are the only source of truth. Evaluations, lines, tactics, threats and piece locations come ONLY from the facts. Never invent a tactic, a threat, a move or a piece. If the facts say little, say less.
2. Write moves only in SAN exactly as they appear in the facts: game.san, engines.stockfish.bestMoveSan / bestLineSan / alternatives[].san / alternatives[].lineSan / replyLineSan, context.recentMoves[].san / actualReply.san, engines.humanTopMoves / engines.maia SAN, and SAN inside ideas.*. Never write any other move.
3. Refer to pieces in words with their square ("the rook on f1", "your knight on e3"), using squares from ideas.board or the facts. Do not use SAN-like labels such as "Rf1" for a piece that is merely standing somewhere.
4. Only recommend moves from bestMoveSan, bestLineSan or alternatives. Moves from replyLineSan, recentMoves and actualReply describe what happened or what the opponent could do.

OUTPUT FORMAT
Return ONLY a JSON object, with no markdown fences and no text before or after it:
{"headline": "...", "body": "..."}
- headline: at most ${HEADLINE_MAX_WORDS} words naming the idea, no move number, no final period.
- body: plain prose, no markdown, no lists. Length per commentaryDetail: concise = ${COMMENTARY_LIMITS.concise.targetSentences} sentences (under ${COMMENTARY_LIMITS.concise.targetChars} characters), balanced = ${COMMENTARY_LIMITS.balanced.targetSentences} sentences (under ${COMMENTARY_LIMITS.balanced.targetChars} characters), detailed = ${COMMENTARY_LIMITS.detailed.targetSentences} sentences (under ${COMMENTARY_LIMITS.detailed.targetChars} characters); default balanced.

EXAMPLES (facts abbreviated; your answer must use the real facts you are given)

Example 1 - blunder. Facts: player 1400 White; game 20. Qb3 by White, classification blunder; assessment white_winning -> black_winning. ideas.played.facts: "attacks the pawn on b7 (undefended)", "stops protecting the rook on f1 (the queen used to guard it; attacked by the knight on e3, undefended)". ideas.reply: Nxf1, "takes the rook on f1, which Qb3 stopped defending", "reply line: over 2 plies Black wins a rook for nothing". ideas.best: Rf2, "moves the rook out of danger from the knight on e3". maia playedAtPlayerLevel: common.
{"headline": "Grabbing b7 left the f1 rook behind", "body": "The idea behind Qb3 is easy to see: the pawn on b7 was undefended and your queen went after it. The trouble is what the queen was doing on d1, where it was the only guard of the rook on f1 while the knight on e3 was already hitting that rook. After Qb3, Nxf1 simply wins a whole rook and your winning position becomes a losing one. Rf2 first takes the rook out of the knight's reach and keeps you firmly on top."}

Example 2 - positional inaccuracy. Facts: player 1700 White; game 14. h3 by White, classification inaccuracy; assessment equal -> black_slightly_better. ideas.played.facts: none. ideas.best: d4, "attacks the knight on e5 (defended once)". ideas.position.changes: none; center control after d4 would rise.
{"headline": "A quiet move lets the e5 knight settle", "body": "h3 is a calm, useful-looking move, but it leaves the knight on e5 undisturbed in the middle of the board. d4 was the principled reaction: the pawn hits the knight at once and claims central space, so Black has to spend a move relocating it. After h3 Black keeps the knight where it is and the balance tips slightly toward Black."}

Example 3 - good move. Facts: player 1100 Black; game 9... Nxe5 by Black, classification best. ideas.played.facts: "captures the pawn on e5 (it was undefended)", "attacks the pawn on f3 (defended once)".
{"headline": "Collecting a free pawn", "body": "Well spotted: the pawn on e5 had no defenders, so Nxe5 simply wins it, and your knight now also eyes the pawn on f3."}
`.trim();

export function buildUserMessage(payload: ReviewInsightPayload): string {
  const detail = payload.commentaryDetail ?? "balanced";
  const limits = commentaryLimits(detail);
  const { moveNumberSan, san } = payload.game;
  const label = `${moveNumberSan}${moveNumberSan.endsWith(".") ? " " : ""}${san}`;
  return [
    "FACTS:",
    JSON.stringify(payload, null, 1),
    "",
    `Write the coach commentary for ${label} now. Body: ${detail}, ${limits.targetSentences} sentences, under ${limits.targetChars} characters.`,
    'Return only the JSON object {"headline": "...", "body": "..."}.'
  ].join("\n");
}

/** SAN tokens like Nf3+ / Rxe1# / O-O / O-O-O / exd5 / e8=Q / Nbd2 / Qa1#. */
const SAN_TOKEN_REGEX =
  /\b(O-O-O|O-O|[KQRBN]?[a-h]?[1-8]?x?[a-h][1-8](?:=[QRBN])?[+#]?)(?![A-Za-z0-9])/g;
/** Bare squares not inside SAN tokens. */
const BARE_SQUARE_REGEX = /(?<![a-zA-Z=])[a-h][1-8](?![+#=])/g;
const SQUARE_REGEX = /[a-h][1-8]/g;
const SENTENCE_DELIM = /[.!?]+(?:\s|$)/g;
/** "14. Nf3" / "14... Nf3" are move numbers, not sentence ends. */
const MOVE_NUMBER_REGEX = /\b\d+\.(?:\.\.)?\s*(?=O-O|[KQRBN]|[a-h])/g;

/**
 * Phrases the coach must not use: engine-as-authority narration (the reason
 * v1 read like a line printout) and empty hype. Plain words like "good" or
 * "strong" are allowed.
 */
const BANNED_PATTERNS: RegExp[] = [
  /\b(?:the\s+)?(?:engine|stockfish|computer|lc0|leela)(?:'s)?\s+(?:recommend|suggest|prefer|want|like|say|think|propos|choos|chose|favou?r|consider)\w*/i,
  /\b(?:engine|stockfish|computer)(?:'s)?\s+(?:top\s+|first\s+|preferred\s+)?(?:choice|recommendation|suggestion|preference|pick|move)s?\b/i,
  /\b(?:crucial|pivotal|game-changing|masterful|masterclass|stunning|incredible|amazing|phenomenal|breathtaking)\b/i,
  /\b(?:key|critical)\s+moment\b/i
];
const RAW_EVAL_PATTERNS: RegExp[] = [
  /(?<![\w.])[+\-−]\d+(?:\.\d+)?(?![\w%]|\.\d)/,
  /\bcentipawns?\b/i
];

export type CoachParts = { headline?: string; body: string };

export type CommentaryValidationReason =
  | "EMPTY"
  | "BAD_SAN"
  | "BAD_SQUARE"
  | "TOO_LONG"
  | "TOO_MANY_SENTENCES"
  | "BANNED_PHRASE"
  | "RAW_EVAL"
  | "BAD_HEADLINE";

export type CommentaryValidationFailure = {
  ok: false;
  reason: CommentaryValidationReason;
  details?: string;
  /** Which part of the structured answer failed. */
  part?: "headline" | "body";
};

export type CommentaryValidationResult =
  | { ok: true; prose: string; headline?: string }
  | CommentaryValidationFailure;

function stripPunctuation(value: string): string {
  return value.replace(/[.,!?;:]+$/g, "");
}

function squaresIn(text: string): string[] {
  return text.match(SQUARE_REGEX) ?? [];
}

function extractFactSquares(fact: ReviewInsightPayload["tacticalFacts"][number]): string[] {
  switch (fact.kind) {
    case "hanging":
      return [fact.piece.square, ...fact.attackedBy, ...fact.defendedBy];
    case "fork":
      return [fact.attacker.square, ...fact.targets.map((target) => target.square)];
    case "pin":
      return [fact.pinned.square, fact.pinner.square, fact.behind.square];
    case "skewer":
      return [fact.attacker.square, fact.front.square, fact.behind.square];
    default:
      return [];
  }
}

/** All free-text idea statements (they are generated from legal positions). */
function ideaTexts(payload: ReviewInsightPayload): string[] {
  const ideas = payload.ideas;
  if (!ideas) return [];
  const texts: string[] = [ideas.board.white, ideas.board.black];
  for (const move of [ideas.played, ideas.best, ideas.reply]) {
    if (!move) continue;
    texts.push(move.san, ...move.facts);
  }
  const position = ideas.position;
  if (position) {
    for (const snapshot of [position.before, position.after]) {
      texts.push(
        snapshot.material ?? "",
        snapshot.white ?? "",
        snapshot.black ?? "",
        snapshot.files ?? "",
        snapshot.center ?? ""
      );
    }
    texts.push(...(position.changes ?? []));
  }
  return texts;
}

/** Every SAN token the payload grounds, i.e. that the prose may mention. */
export function groundedSanTokens(payload: ReviewInsightPayload): Set<string> {
  const stockfish = payload.engines.stockfish;
  const tokens = new Set<string>([
    payload.game.san,
    stockfish.bestMoveSan,
    ...stockfish.bestLineSan
  ]);
  for (const alternative of stockfish.alternatives ?? []) {
    tokens.add(alternative.san);
    for (const san of alternative.lineSan) tokens.add(san);
  }
  for (const san of stockfish.replyLineSan ?? []) tokens.add(san);
  for (const recent of payload.context?.recentMoves ?? []) tokens.add(recent.san);
  if (payload.context?.actualReply) tokens.add(payload.context.actualReply.san);
  for (const human of payload.engines.humanTopMoves?.moves ?? []) tokens.add(human.san);
  for (const level of payload.engines.maia?.levels ?? []) {
    for (const top of level.top) tokens.add(top.san);
  }
  for (const signal of payload.engineSignals ?? []) {
    if (signal.kind === "quiet_threat") tokens.add(signal.threatSan);
  }
  for (const text of ideaTexts(payload)) {
    for (const match of text.matchAll(SAN_TOKEN_REGEX)) {
      const token = stripPunctuation(match[1] ?? match[0]);
      if (/[KQRBN]|O-O|x|=/.test(token)) tokens.add(token);
    }
  }
  return tokens;
}

/** Check/mate suffixes are cosmetic for grounding: "Rd8" and "Rd8#" are the same move. */
function normalizeSan(token: string): string {
  return token.replace(/[+#]+$/, "");
}

/** square -> FEN piece char, read leniently (invalid FEN yields an empty board). */
function boardFromFen(fen: string): Map<string, string> {
  const board = new Map<string, string>();
  const placement = fen.split(" ")[0] ?? "";
  const ranks = placement.split("/");
  if (ranks.length !== 8) return board;
  ranks.forEach((rank, index) => {
    let file = 0;
    for (const char of rank) {
      if (/\d/.test(char)) {
        file += Number(char);
      } else if (/[pnbrqkPNBRQK]/.test(char) && file < 8) {
        board.set(`${"abcdefgh"[file]}${8 - index}`, char);
        file += 1;
      } else {
        return;
      }
    }
  });
  return board;
}

type Grounding = {
  san: Set<string>;
  squares: Set<string>;
  boards: Map<string, string>[];
};

function grounding(payload: ReviewInsightPayload): Grounding {
  const san = new Set(Array.from(groundedSanTokens(payload), normalizeSan));
  const squares = new Set<string>();
  for (const token of san) for (const square of squaresIn(token)) squares.add(square);
  for (const fact of payload.tacticalFacts ?? []) {
    for (const square of extractFactSquares(fact)) squares.add(square);
  }
  for (const text of ideaTexts(payload)) for (const square of squaresIn(text)) squares.add(square);
  const boards = [boardFromFen(payload.game.fenBefore), boardFromFen(payload.game.fenAfter)];
  for (const board of boards) for (const square of board.keys()) squares.add(square);
  return { san, squares, boards };
}

/** "Rf1" naming a rook that actually stands on f1 is a piece reference, not a move. */
function isPieceReference(token: string, boards: Map<string, string>[]): boolean {
  const match = /^([KQRBN])([a-h][1-8])$/.exec(token);
  if (!match) return false;
  const [, letter, square] = match;
  return boards.some((board) => board.get(square ?? "")?.toUpperCase() === letter);
}

function sentenceCount(text: string): number {
  return text
    .replace(MOVE_NUMBER_REGEX, "")
    .split(SENTENCE_DELIM)
    .filter((sentence) => sentence.trim().length > 0).length;
}

function checkText(
  text: string,
  part: "headline" | "body",
  ground: Grounding
): CommentaryValidationFailure | null {
  for (const pattern of BANNED_PATTERNS) {
    const match = pattern.exec(text);
    if (match) return { ok: false, reason: "BANNED_PHRASE", details: match[0], part };
  }
  for (const pattern of RAW_EVAL_PATTERNS) {
    const match = pattern.exec(text);
    if (match) return { ok: false, reason: "RAW_EVAL", details: match[0], part };
  }
  const sanMatches = Array.from(text.matchAll(SAN_TOKEN_REGEX), (match) => match[1] ?? match[0]);
  const sanTokens = sanMatches
    .map(stripPunctuation)
    .filter((token) => /[KQRBN]|O-O|x|=/.test(token));
  for (const token of sanTokens) {
    if (ground.san.has(normalizeSan(token))) continue;
    if (isPieceReference(token, ground.boards)) continue;
    return { ok: false, reason: "BAD_SAN", details: token, part };
  }
  for (const match of text.matchAll(BARE_SQUARE_REGEX)) {
    if (!ground.squares.has(match[0]))
      return { ok: false, reason: "BAD_SQUARE", details: match[0], part };
  }
  return null;
}

function cleanText(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.replace(/\s+/g, " ").trim();
  return text || undefined;
}

/**
 * Parse a provider answer. Accepts the requested JSON object (optionally in a
 * ```json fence or surrounded by stray text); anything else is taken as a
 * plain-text body.
 */
export function parseCoachResponse(raw: string): CoachParts {
  const text = raw.trim();
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const candidates = [fenced?.[1], text];
  for (const candidate of candidates) {
    if (!candidate) continue;
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start < 0 || end <= start) continue;
    try {
      const parsed = JSON.parse(candidate.slice(start, end + 1)) as Record<string, unknown>;
      const body = cleanText(parsed.body ?? parsed.prose ?? parsed.commentary ?? parsed.text);
      if (!body) continue;
      const headline = cleanText(parsed.headline ?? parsed.title)?.replace(/[.!]+$/, "");
      return { body, ...(headline ? { headline } : {}) };
    } catch {
      // Not JSON; fall through to plain text.
    }
  }
  const plain = (fenced?.[1] ?? text).replace(/^["']|["']$/g, "").trim();
  return { body: plain.replace(/\s+/g, " ") };
}

/** Validate structured coach output against the grounded facts. */
export function validateCommentary(
  parts: CoachParts,
  payload: ReviewInsightPayload
): CommentaryValidationResult {
  const body = parts.body.trim();
  if (!body) return { ok: false, reason: "EMPTY", part: "body" };
  const limits = commentaryLimits(payload.commentaryDetail);
  if (body.length > limits.maxChars) {
    return { ok: false, reason: "TOO_LONG", details: `len=${body.length}`, part: "body" };
  }
  const sentences = sentenceCount(body);
  if (sentences > limits.maxSentences) {
    return { ok: false, reason: "TOO_MANY_SENTENCES", details: `count=${sentences}`, part: "body" };
  }
  const headline = parts.headline?.trim();
  if (headline !== undefined) {
    const words = headline.split(/\s+/).filter(Boolean).length;
    if (
      !headline ||
      words > HEADLINE_MAX_WORDS ||
      headline.length > HEADLINE_MAX_CHARS ||
      sentenceCount(headline) > 1
    ) {
      return { ok: false, reason: "BAD_HEADLINE", details: `words=${words}`, part: "headline" };
    }
  }

  const ground = grounding(payload);
  const checks: Array<[string | undefined, "headline" | "body"]> = [
    [headline, "headline"],
    [body, "body"]
  ];
  for (const [text, part] of checks) {
    if (!text) continue;
    const failure = checkText(text, part, ground);
    if (failure) return failure;
  }
  return { ok: true, prose: body, ...(headline ? { headline } : {}) };
}

/**
 * Parse + validate a raw provider answer (JSON or plain text). `prose` is the
 * body; `headline` is present when the model returned one.
 */
export function validateProse(
  raw: string,
  payload: ReviewInsightPayload
): CommentaryValidationResult {
  return validateCommentary(parseCoachResponse(raw), payload);
}

/** A specific correction for the retry turn ("You wrote Nd5, which is not in the facts."). */
function describeValidationFailure(
  failure: CommentaryValidationFailure,
  payload?: ReviewInsightPayload
): string {
  const where = failure.part && failure.part !== "body" ? ` in the ${failure.part}` : "";
  const limits = commentaryLimits(payload?.commentaryDetail);
  const count = failure.details?.split("=")[1];
  switch (failure.reason) {
    case "BAD_SAN":
      return `You wrote the move ${failure.details}${where}, which is not in the facts. Only write moves that appear in the facts, exactly as written there; to mention a piece that is just standing on a square, use words ("the rook on f1").`;
    case "BAD_SQUARE":
      return `You mentioned the square ${failure.details}${where}, which is empty and not named in the facts. Only name squares from ideas.board or the facts.`;
    case "TOO_LONG":
      return `The body was ${count ?? "too many"} characters; keep it under ${limits.targetChars} characters.`;
    case "TOO_MANY_SENTENCES":
      return `The body had ${count ?? "too many"} sentences; use ${limits.targetSentences}.`;
    case "BANNED_PHRASE":
      return `You wrote "${failure.details}"${where}. Explain moves by their chess reasons (what they attack, defend or allow) instead of engine preferences or hype words.`;
    case "RAW_EVAL":
      return `You quoted a numeric evaluation ("${failure.details}")${where}. Describe the position in words instead.`;
    case "BAD_HEADLINE":
      return `The headline must be at most ${HEADLINE_MAX_WORDS} words and a single phrase.`;
    case "EMPTY":
      return "The answer had no body text.";
  }
}

/** User-turn text for the single retry after a rejected answer. */
export function buildRetryMessage(
  failure: CommentaryValidationFailure,
  payload?: ReviewInsightPayload
): string {
  return `PREVIOUS RESPONSE WAS INVALID. Fix the problem described below and answer again with only the JSON object.\nProblem: ${describeValidationFailure(failure, payload)}\nRewrite the whole answer with that fixed, keeping the same facts, and return only the JSON object {"headline": "...", "body": "..."}.`;
}
