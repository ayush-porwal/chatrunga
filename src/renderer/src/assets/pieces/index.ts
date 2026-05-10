export const pieceAssetPaths = {
  black: {
    bishop: new URL("./black-bishop.svg", import.meta.url).href,
    king: new URL("./black-king.svg", import.meta.url).href,
    knight: new URL("./black-knight.svg", import.meta.url).href,
    pawn: new URL("./black-pawn.svg", import.meta.url).href,
    queen: new URL("./black-queen.svg", import.meta.url).href,
    rook: new URL("./black-rook.svg", import.meta.url).href
  },
  white: {
    bishop: new URL("./white-bishop.svg", import.meta.url).href,
    king: new URL("./white-king.svg", import.meta.url).href,
    knight: new URL("./white-knight.svg", import.meta.url).href,
    pawn: new URL("./white-pawn.svg", import.meta.url).href,
    queen: new URL("./white-queen.svg", import.meta.url).href,
    rook: new URL("./white-rook.svg", import.meta.url).href
  }
} as const;

export type PieceColor = keyof typeof pieceAssetPaths;
export type PieceRole = keyof (typeof pieceAssetPaths)["white"];
