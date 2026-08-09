import { appendFileSync, existsSync, readFileSync } from "fs";
import { createRequire } from "module";
import { join } from "path";
import { codexHome } from "./discover.js";

export interface CodexThreadRegistration {
  sessionId: string;
  rolloutPath: string;
  cwd: string;
  title: string;
  firstUserMessage: string;
  createdAt?: string;
  updatedAt?: string;
  model?: string;
  cliVersion?: string;
}

export interface RegistrationResult {
  sessionIndex: "added" | "existing";
  stateDatabase: "added" | "existing" | "unavailable";
  warning?: string;
}

interface Statement {
  get(...values: unknown[]): Record<string, unknown> | undefined;
  all(...values: unknown[]): Array<Record<string, unknown>>;
  run(...values: unknown[]): unknown;
}

interface Database {
  prepare(sql: string): Statement;
  close(): void;
}

export function registerCodexThread(input: CodexThreadRegistration): RegistrationResult {
  const sessionIndex = registerSessionIndex(input.sessionId, input.title);
  const statePath = join(codexHome(), "state_5.sqlite");
  if (!existsSync(statePath)) return { sessionIndex, stateDatabase: "unavailable" };

  let DatabaseSync: new (path: string) => Database;
  try {
    const require = createRequire(import.meta.url);
    DatabaseSync = (require("node:sqlite") as { DatabaseSync: new (path: string) => Database }).DatabaseSync;
  } catch {
    return {
      sessionIndex,
      stateDatabase: "unavailable",
      warning: "Codex state database registration requires Node.js 22.5+; session_index.jsonl was updated as a fallback.",
    };
  }

  const db = new DatabaseSync(statePath);
  try {
    if (db.prepare("SELECT 1 AS found FROM threads WHERE id = ?").get(input.sessionId)) {
      return { sessionIndex, stateDatabase: "existing" };
    }

    const base = db.prepare("SELECT * FROM threads ORDER BY updated_at DESC LIMIT 1").get();
    if (!base) {
      return {
        sessionIndex,
        stateDatabase: "unavailable",
        warning: "Codex state database has no existing thread whose defaults can be reused.",
      };
    }

    const columns = db.prepare("PRAGMA table_info(threads)").all().map((row) => String(row.name));
    const row: Record<string, unknown> = { ...base };
    const createdAt = Math.floor(Date.parse(input.createdAt || new Date().toISOString()) / 1000);
    const updatedAt = Math.floor(Date.parse(input.updatedAt || new Date().toISOString()) / 1000);
    Object.assign(row, {
      id: input.sessionId,
      rollout_path: input.rolloutPath,
      created_at: createdAt,
      updated_at: updatedAt,
      source: "cli",
      model_provider: "openai",
      cwd: input.cwd,
      title: input.title,
      tokens_used: 0,
      has_user_event: 1,
      archived: 0,
      cli_version: input.cliVersion || "ai-session-bridge",
      first_user_message: input.firstUserMessage,
      preview: input.firstUserMessage.slice(0, 4000),
      history_mode: "legacy",
      thread_source: "user",
    });
    if (input.model) row.model = input.model;

    const insertColumns = columns.filter((column) => Object.hasOwn(row, column));
    const quoted = insertColumns.map((column) => `"${column.replaceAll('"', '""')}"`);
    const placeholders = insertColumns.map(() => "?");
    db.prepare(`INSERT INTO threads (${quoted.join(", ")}) VALUES (${placeholders.join(", ")})`)
      .run(...insertColumns.map((column) => row[column]));
    return { sessionIndex, stateDatabase: "added" };
  } finally {
    db.close();
  }
}

function registerSessionIndex(sessionId: string, title: string): "added" | "existing" {
  const indexPath = join(codexHome(), "session_index.jsonl");
  if (existsSync(indexPath)) {
    const existing = readFileSync(indexPath, "utf8");
    if (existing.includes(`"id":"${sessionId}"`) || existing.includes(`"id": "${sessionId}"`)) return "existing";
  }
  appendFileSync(indexPath, JSON.stringify({ id: sessionId, thread_name: title, updated_at: new Date().toISOString() }) + "\n");
  return "added";
}
