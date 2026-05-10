import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const engines = sqliteTable("engines", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  executablePath: text("executable_path").notNull(),
  workingDirectory: text("working_directory"),
  args: text("args"),
  protocol: text("protocol").notNull(),
  isDefault: integer("is_default", { mode: "boolean" }).notNull(),
  isEnabled: integer("is_enabled", { mode: "boolean" }).notNull(),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull()
});

export const games = sqliteTable("games", {
  id: text("id").primaryKey(),
  source: text("source").notNull(),
  white: text("white"),
  black: text("black"),
  event: text("event"),
  site: text("site"),
  round: text("round"),
  result: text("result"),
  date: text("date"),
  initialFen: text("initial_fen"),
  pgn: text("pgn").notNull(),
  currentFen: text("current_fen").notNull(),
  moveTreeJson: text("move_tree_json").notNull(),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull()
});

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: integer("updated_at").notNull()
});
