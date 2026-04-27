import { readdirSync, statSync, existsSync } from "fs";
import { join, basename } from "path";
import { homedir } from "os";

const HOME = homedir();

// ============================================================
// Home directory resolution (respect env var overrides)
// ============================================================

/**
 * Resolve Codex home directory. Respects $CODEX_HOME (set by official Codex CLI
 * to redirect config/sessions away from the default $HOME/.codex location —
 * common on Windows where users separate Codex Windows-native from WSL2 setups).
 */
export function codexHome(): string {
  const override = process.env.CODEX_HOME;
  if (override && override.trim()) return override;
  return join(HOME, ".codex");
}

/**
 * Resolve Claude Code home directory. Respects $CLAUDE_CONFIG_DIR (the env var
 * Claude Code itself reads to relocate the entire .claude directory).
 */
export function claudeHome(): string {
  const override = process.env.CLAUDE_CONFIG_DIR;
  if (override && override.trim()) return override;
  return join(HOME, ".claude");
}

// ============================================================
// Codex session discovery
// ============================================================

export function codexSessionsDir(): string {
  return join(codexHome(), "sessions");
}

/**
 * Find an original (non-converted) Codex session by full or partial ID.
 * Prioritizes "rollout-" files over "converted-" files.
 */
export function findCodexSession(sessionId: string): string | null {
  const base = codexSessionsDir();
  if (!existsSync(base)) return null;

  let originalMatch: string | null = null;
  let convertedMatch: string | null = null;

  for (const year of safeReaddir(base)) {
    const yp = join(base, year);
    if (!isDir(yp)) continue;
    for (const month of safeReaddir(yp)) {
      const mp = join(yp, month);
      if (!isDir(mp)) continue;
      for (const day of safeReaddir(mp)) {
        const dp = join(mp, day);
        if (!isDir(dp)) continue;
        for (const file of safeReaddir(dp)) {
          if (file.includes(sessionId) && file.endsWith(".jsonl")) {
            const fp = join(dp, file);
            if (file.startsWith("converted-")) {
              convertedMatch = fp;
            } else {
              originalMatch = fp;
            }
          }
        }
      }
    }
  }

  return originalMatch || convertedMatch;
}

export interface CodexSessionEntry {
  id: string;
  file: string;
  date: string;
  size: number;
  converted: boolean;
}

export function listCodexSessions(limit = 20): CodexSessionEntry[] {
  const base = codexSessionsDir();
  if (!existsSync(base)) return [];

  const sessions: Array<CodexSessionEntry & { mtime: number }> = [];

  for (const year of safeReaddir(base)) {
    const yp = join(base, year);
    if (!isDir(yp)) continue;
    for (const month of safeReaddir(yp)) {
      const mp = join(yp, month);
      if (!isDir(mp)) continue;
      for (const day of safeReaddir(mp)) {
        const dp = join(mp, day);
        if (!isDir(dp)) continue;
        for (const file of safeReaddir(dp)) {
          if (!file.endsWith(".jsonl")) continue;
          const fp = join(dp, file);
          const st = statSync(fp);
          const uuidMatch = file.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/);
          if (uuidMatch) {
            sessions.push({
              id: uuidMatch[1],
              file: fp,
              date: `${year}-${month}-${day}`,
              size: st.size,
              converted: file.startsWith("converted-"),
              mtime: st.mtimeMs,
            });
          }
        }
      }
    }
  }

  sessions.sort((a, b) => b.mtime - a.mtime);
  return sessions.slice(0, limit).map(({ mtime, ...rest }) => rest);
}

// ============================================================
// Claude Code session discovery
// ============================================================

export function claudeProjectsDir(): string {
  return join(claudeHome(), "projects");
}

/**
 * Find an original (non-converted) Claude Code session by full or partial ID.
 * Skips the "-converted-from-codex" project directory.
 */
export function findClaudeSession(sessionId: string): string | null {
  const base = claudeProjectsDir();
  if (!existsSync(base)) return null;

  let originalMatch: string | null = null;
  let convertedMatch: string | null = null;

  for (const project of safeReaddir(base)) {
    const pp = join(base, project);
    if (!isDir(pp)) continue;
    const isConverted = project === "-converted-from-codex";
    for (const file of safeReaddir(pp)) {
      if (file === `${sessionId}.jsonl`) {
        const fp = join(pp, file);
        if (isConverted) {
          convertedMatch = fp;
        } else {
          originalMatch = fp;
        }
      }
    }
  }

  return originalMatch || convertedMatch;
}

export interface ClaudeSessionEntry {
  id: string;
  file: string;
  project: string;
  size: number;
  converted: boolean;
}

export function listClaudeSessions(limit = 20): ClaudeSessionEntry[] {
  const base = claudeProjectsDir();
  if (!existsSync(base)) return [];

  const sessions: Array<ClaudeSessionEntry & { mtime: number }> = [];

  for (const project of safeReaddir(base)) {
    const pp = join(base, project);
    if (!isDir(pp)) continue;
    if (project === "memory") continue;
    const isConverted = project === "-converted-from-codex";
    for (const file of safeReaddir(pp)) {
      if (!file.endsWith(".jsonl")) continue;
      const fp = join(pp, file);
      const st = statSync(fp);
      const id = basename(file, ".jsonl");
      sessions.push({
        id,
        file: fp,
        project: project.replace(/^-/, "/").replace(/-/g, "/"),
        size: st.size,
        converted: isConverted,
        mtime: st.mtimeMs,
      });
    }
  }

  sessions.sort((a, b) => b.mtime - a.mtime);
  return sessions.slice(0, limit).map(({ mtime, ...rest }) => rest);
}

// ============================================================
// Auto-detect format from file
// ============================================================

export type DetectedFormat = "codex" | "claude" | "unknown";

export function detectFormat(firstLine: string): DetectedFormat {
  try {
    const obj = JSON.parse(firstLine);
    if (obj.type === "session_meta" && obj.payload?.originator) return "codex";
    if (obj.type === "response_item" || obj.type === "event_msg" || obj.type === "turn_context") return "codex";
    if (obj.sessionId && (obj.type === "user" || obj.type === "assistant")) return "claude";
    if (obj.type === "file-history-snapshot") return "claude";
    return "unknown";
  } catch {
    return "unknown";
  }
}

// ============================================================
// Helpers
// ============================================================

function safeReaddir(path: string): string[] {
  try {
    return readdirSync(path);
  } catch {
    return [];
  }
}

function isDir(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}
