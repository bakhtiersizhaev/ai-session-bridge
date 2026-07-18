import { readdirSync, statSync, existsSync, openSync, readSync, closeSync } from "fs";
import { join, basename } from "path";
import { homedir } from "os";

const HOME = homedir();

// ============================================================
// Home directory resolution (respect env var overrides)
// ============================================================

// Well-known locations, in priority order. The env var always wins; when it is
// absent we pick the first candidate that actually holds sessions, so setups
// with a non-default home (e.g. ~/.codex-win) still resolve without config.
const CODEX_HOME_CANDIDATES = [
  join(HOME, ".codex"),
  join(HOME, ".codex-win"),
  join(HOME, ".config", "codex"),
];
const CLAUDE_HOME_CANDIDATES = [
  join(HOME, ".claude"),
  join(HOME, ".config", "claude"),
];

/**
 * Resolve Codex home directory. Respects $CODEX_HOME (set by official Codex CLI
 * to redirect config/sessions away from the default $HOME/.codex location —
 * common on Windows where users separate Codex Windows-native from WSL2 setups).
 * Without the env var, falls back to the first well-known candidate that has
 * a non-empty sessions/ directory.
 */
export function codexHome(): string {
  const override = process.env.CODEX_HOME;
  if (override && override.trim()) return override;
  return firstHomeWithData(CODEX_HOME_CANDIDATES, "sessions");
}

/**
 * Resolve Claude Code home directory. Respects $CLAUDE_CONFIG_DIR (the env var
 * Claude Code itself reads to relocate the entire .claude directory).
 * Without the env var, falls back to the first well-known candidate that has
 * a non-empty projects/ directory.
 */
export function claudeHome(): string {
  const override = process.env.CLAUDE_CONFIG_DIR;
  if (override && override.trim()) return override;
  return firstHomeWithData(CLAUDE_HOME_CANDIDATES, "projects");
}

/**
 * First candidate whose data subdir exists and is non-empty; if none qualify,
 * return the first candidate (the conventional default).
 */
function firstHomeWithData(candidates: string[], dataSubdir: string): string {
  for (const candidate of candidates) {
    try {
      const dataDir = join(candidate, dataSubdir);
      if (existsSync(dataDir) && readdirSync(dataDir).length > 0) return candidate;
    } catch { /* keep looking */ }
  }
  return candidates[0];
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
      // Prefer authoritative cwd from the JSONL itself (handles spaces/special
      // chars in paths that the dir-name reverse heuristic can't recover).
      const cwd = readClaudeCwd(fp) ?? projectDirToCwd(project);
      sessions.push({
        id,
        file: fp,
        project: cwd,
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

// Record types Claude Code writes that are safe markers of the format even
// though they carry no message payload (real sessions often START with these).
const CLAUDE_METADATA_TYPES = new Set([
  "user",
  "assistant",
  "progress",
  "file-history-snapshot",
  "system",
  "attachment",
  "mode",
  "permission-mode",
  "last-prompt",
  "queue-operation",
  "custom-title",
]);

/**
 * Detect session format from the first lines of a JSONL file.
 * Accepts a multi-line head (not just line 1): modern Claude Code sessions
 * frequently start with metadata records (mode/queue-operation/custom-title),
 * and Codex Desktop sessions may lead with session_meta followed by event_msg.
 */
export function detectFormat(head: string): DetectedFormat {
  const lines = head.split("\n").slice(0, 50);
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const obj = JSON.parse(line);
      if (obj.type === "session_meta" && obj.payload?.originator) return "codex";
      if (obj.type === "response_item" || obj.type === "event_msg" || obj.type === "turn_context" || obj.type === "world_state") return "codex";
      if (obj.sessionId && CLAUDE_METADATA_TYPES.has(obj.type)) return "claude";
      if (obj.type === "file-history-snapshot") return "claude";
    } catch {
      continue;
    }
  }
  return "unknown";
}

// ============================================================
// Helpers
// ============================================================

/**
 * Reproduce Claude Code's project-dir naming for a given cwd (verified
 * empirically against Claude Code 2.1.x on Windows and documented Linux
 * behavior): every character that is not [a-zA-Z0-9-] becomes "-".
 *   E:\hermes-runtime\.hermes  -> E--hermes-runtime--hermes
 *   D:\test_probe.x_y z        -> D--test-probe-x-y-z
 *   /home/user/project         -> -home-user-project
 * Sessions converted into Claude format MUST land in the directory this
 * function returns, otherwise `claude --resume` cannot discover them.
 */
export function cwdToClaudeProjectDir(cwd: string): string {
  return cwd.replace(/[^a-zA-Z0-9-]/g, "-");
}

/**
 * Reverse Claude Code's project-dir naming back to the original cwd.
 * Heuristic fallback only — the transform is lossy ("-" is ambiguous), so
 * prefer the authoritative `cwd` read from the session file itself.
 *   D--projects-MyApp -> D:\projects\MyApp  (Windows)
 *   -home-user-project      -> /home/user/project       (Linux/macOS)
 */
export function projectDirToCwd(dir: string): string {
  const winMatch = dir.match(/^([A-Za-z])--(.*)$/);
  if (winMatch) {
    const drive = winMatch[1];
    const rest = winMatch[2].replace(/-/g, "\\");
    return `${drive}:\\${rest}`;
  }
  return dir.replace(/^-/, "/").replace(/-/g, "/");
}

/**
 * Cheaply read the `cwd` field from a Claude session file by scanning only
 * the first ~16 KB. Avoids loading multi-megabyte JSONLs just to render `list`.
 */
function readClaudeCwd(filePath: string): string | null {
  try {
    const fd = openSync(filePath, "r");
    const buf = Buffer.alloc(16 * 1024);
    const n = readSync(fd, buf, 0, buf.length, 0);
    closeSync(fd);
    const head = buf.toString("utf-8", 0, n);
    const m = head.match(/"cwd"\s*:\s*"((?:[^"\\]|\\.)*)"/);
    if (!m) return null;
    // Unescape JSON string (covers \\ and \")
    return JSON.parse(`"${m[1]}"`);
  } catch {
    return null;
  }
}

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
