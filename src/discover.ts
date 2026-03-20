import { readdirSync, statSync, existsSync } from "fs";
import { join, basename } from "path";
import { homedir } from "os";

const HOME = homedir();

// ============================================================
// Codex session discovery
// ============================================================

export function codexSessionsDir(): string {
  return join(HOME, ".codex", "sessions");
}

export function findCodexSession(sessionId: string): string | null {
  const base = codexSessionsDir();
  if (!existsSync(base)) return null;

  // Walk year/month/day directories
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
            return join(dp, file);
          }
        }
      }
    }
  }
  return null;
}

export function listCodexSessions(limit = 20): Array<{ id: string; file: string; date: string; size: number }> {
  const base = codexSessionsDir();
  if (!existsSync(base)) return [];

  const sessions: Array<{ id: string; file: string; date: string; size: number; mtime: number }> = [];

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
          // Extract session ID from filename: rollout-DATETIME-SESSIONID.jsonl
          const match = file.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/);
          if (match) {
            sessions.push({
              id: match[1],
              file: fp,
              date: `${year}-${month}-${day}`,
              size: st.size,
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
  return join(HOME, ".claude", "projects");
}

export function findClaudeSession(sessionId: string): string | null {
  const base = claudeProjectsDir();
  if (!existsSync(base)) return null;

  for (const project of safeReaddir(base)) {
    const pp = join(base, project);
    if (!isDir(pp)) continue;
    for (const file of safeReaddir(pp)) {
      if (file === `${sessionId}.jsonl`) {
        return join(pp, file);
      }
    }
  }
  return null;
}

export function listClaudeSessions(limit = 20): Array<{ id: string; file: string; project: string; size: number }> {
  const base = claudeProjectsDir();
  if (!existsSync(base)) return [];

  const sessions: Array<{ id: string; file: string; project: string; size: number; mtime: number }> = [];

  for (const project of safeReaddir(base)) {
    const pp = join(base, project);
    if (!isDir(pp)) continue;
    // Check for memory dir — skip it
    if (project === "memory") continue;
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
    // Codex always has {timestamp, type, payload} wrapper
    if (obj.type === "session_meta" && obj.payload?.originator) return "codex";
    if (obj.type === "response_item" || obj.type === "event_msg" || obj.type === "turn_context") return "codex";
    // Claude Code has {type:"user"|"assistant"|"progress"|"file-history-snapshot", sessionId, ...}
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
