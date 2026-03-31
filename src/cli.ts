#!/usr/bin/env tsx
/**
 * ai-session-bridge — Bridge AI coding sessions between Codex CLI and Claude Code
 *
 * Usage:
 *   ai-session-bridge codex2claude <session-id-or-file>  [--output <path>]
 *   ai-session-bridge claude2codex <session-id-or-file>  [--output <path>]
 *   ai-session-bridge auto         <session-id-or-file>  [--output <path>]
 *   ai-session-bridge list         [codex|claude]
 *   ai-session-bridge info         <session-id-or-file>
 *   ai-session-bridge preview      <session-id-or-file>
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync } from "fs";
import { dirname, join, resolve } from "path";
import { homedir } from "os";
import { convertCodexToClaude } from "./codex2claude.js";
import { convertClaudeToCodex } from "./claude2codex.js";
import {
  findCodexSession,
  findClaudeSession,
  listCodexSessions,
  listClaudeSessions,
  detectFormat,
  claudeProjectsDir,
  codexSessionsDir,
} from "./discover.js";
import type { ConversionMeta } from "./types.js";

const VERSION = "0.1.0-preview";
const NAME = "ai-session-bridge";

const HELP = `
${NAME} v${VERSION}
Bridge AI coding sessions between Codex CLI and Claude Code

Commands:
  codex2claude <id|file> [--output <path>]   Convert Codex session -> Claude Code format
  claude2codex <id|file> [--output <path>]   Convert Claude Code session -> Codex format
  auto         <id|file> [--output <path>]   Auto-detect format and bridge to the other
  list         [codex|claude]                List recent sessions with message previews
  info         <id|file>                     Show detailed session metadata
  preview      <id|file>                     Show first messages from a session

Options:
  --output, -o <path>    Output file path (default: auto-generated)
  --json                 Machine-readable JSON output (for AI agents)
  --dry-run              Preview conversion stats without writing files
  --tail <n>             Only convert last N user turns (useful for large sessions)
  --preview-lines <n>    Number of message previews in list/preview (default: 5)
  --help, -h             Show this help
  --version, -v          Show version

Examples:
  ${NAME} list                                              # Show all sessions
  ${NAME} preview 019ced67                                  # Preview a Codex session
  ${NAME} codex2claude 019ced67-e597-72d2-9e6d-657e520103b0 # Bridge Codex -> Claude Code
  ${NAME} auto /path/to/session.jsonl -o ~/bridged.jsonl    # Auto-detect and convert
  ${NAME} auto 019ced67 --json                              # JSON output for AI agents
`;

function main(): void {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
    console.log(HELP);
    process.exit(0);
  }

  if (args.includes("--version") || args.includes("-v")) {
    console.log(`${NAME} v${VERSION}`);
    process.exit(0);
  }

  const command = args[0];
  const target = args[1];
  const jsonMode = args.includes("--json");
  const dryRun = args.includes("--dry-run");
  const outputIdx = args.indexOf("--output") !== -1 ? args.indexOf("--output") : args.indexOf("-o");
  const outputPath = outputIdx !== -1 ? args[outputIdx + 1] : undefined;
  const tailIdx = args.indexOf("--tail");
  const tailTurns = tailIdx !== -1 ? parseInt(args[tailIdx + 1], 10) : undefined;
  const previewLinesIdx = args.indexOf("--preview-lines");
  const previewLines = previewLinesIdx !== -1 ? parseInt(args[previewLinesIdx + 1], 10) : 5;

  switch (command) {
    case "list":
      cmdList(target as "codex" | "claude" | undefined, jsonMode);
      break;
    case "info":
      cmdInfo(target, jsonMode);
      break;
    case "preview":
      cmdPreview(target, jsonMode, previewLines);
      break;
    case "codex2claude":
      cmdConvert(target, "codex2claude", outputPath, jsonMode, dryRun, tailTurns);
      break;
    case "claude2codex":
      cmdConvert(target, "claude2codex", outputPath, jsonMode, dryRun, tailTurns);
      break;
    case "auto":
      cmdConvert(target, "auto", outputPath, jsonMode, dryRun, tailTurns);
      break;
    default:
      console.error(`Unknown command: ${command}\nRun '${NAME} --help' for usage.`);
      process.exit(1);
  }
}

// ============================================================
// list
// ============================================================

function cmdList(filter: "codex" | "claude" | undefined, jsonMode: boolean): void {
  const results: Record<string, unknown[]> = {};

  if (!filter || filter === "codex") {
    const sessions = listCodexSessions(15);
    results.codex = sessions.map((s) => ({
      ...s,
      preview: getSessionPreview(s.file, "codex", 2),
    }));
  }

  if (!filter || filter === "claude") {
    const sessions = listClaudeSessions(15);
    results.claude = sessions.map((s) => ({
      ...s,
      preview: getSessionPreview(s.file, "claude", 2),
    }));
  }

  if (jsonMode) {
    console.log(JSON.stringify(results, null, 2));
    return;
  }

  if (results.codex) {
    const items = results.codex as any[];
    const originals = items.filter((s) => !s.converted);
    const converted = items.filter((s) => s.converted);

    console.log(`\n\x1b[1m\x1b[34m  Codex CLI Sessions\x1b[0m  \x1b[2m(${codexSessionsDir()})\x1b[0m\n`);
    for (const s of originals) {
      printSessionEntry(s, "codex");
    }
    if (converted.length > 0) {
      console.log(`  \x1b[2m--- bridged from Claude Code ---\x1b[0m\n`);
      for (const s of converted) {
        printSessionEntry(s, "codex", true);
      }
    }
    if (items.length === 0) {
      console.log("  \x1b[2mNo sessions found.\x1b[0m\n");
    }
  }

  if (results.claude) {
    const items = results.claude as any[];
    const originals = items.filter((s) => !s.converted);
    const converted = items.filter((s) => s.converted);

    console.log(`\n\x1b[1m\x1b[35m  Claude Code Sessions\x1b[0m  \x1b[2m(${claudeProjectsDir()})\x1b[0m\n`);
    for (const s of originals) {
      printSessionEntry(s, "claude");
    }
    if (converted.length > 0) {
      console.log(`  \x1b[2m--- bridged from Codex ---\x1b[0m\n`);
      for (const s of converted) {
        printSessionEntry(s, "claude", true);
      }
    }
    if (items.length === 0) {
      console.log("  \x1b[2mNo sessions found.\x1b[0m\n");
    }
  }
}

function printSessionEntry(s: any, type: "codex" | "claude", converted = false): void {
  const sizeKb = (s.size / 1024).toFixed(0);
  const badge = converted ? " \x1b[36m[bridged]\x1b[0m" : "";
  console.log(`  \x1b[1m${s.id}\x1b[0m${badge}`);
  if (type === "codex") {
    console.log(`    \x1b[2mDate:\x1b[0m ${s.date}  \x1b[2mSize:\x1b[0m ${sizeKb} KB`);
  } else {
    console.log(`    \x1b[2mProject:\x1b[0m ${s.project}  \x1b[2mSize:\x1b[0m ${sizeKb} KB`);
  }
  console.log(`    \x1b[2mFile:\x1b[0m ${s.file}`);
  if (s.preview?.length > 0) {
    for (const p of s.preview) {
      const truncated = p.text.length > 100 ? p.text.slice(0, 100) + "..." : p.text;
      const roleColor = p.role === "user" ? "\x1b[32m" : "\x1b[33m";
      console.log(`    ${roleColor}${p.role}:\x1b[0m ${truncated}`);
    }
  }
  console.log();
}

// ============================================================
// preview
// ============================================================

function cmdPreview(target: string, jsonMode: boolean, limit: number): void {
  const { filePath, format } = resolveTarget(target);
  const previews = getSessionPreview(filePath, format, limit);

  if (jsonMode) {
    console.log(JSON.stringify({ file: filePath, format, messages: previews }, null, 2));
    return;
  }

  console.log(`\n\x1b[1m  Session Preview\x1b[0m`);
  console.log(`  \x1b[2mFile:\x1b[0m ${filePath}`);
  console.log(`  \x1b[2mFormat:\x1b[0m ${format}\n`);

  for (const p of previews) {
    const roleColor = p.role === "user" ? "\x1b[32m" : p.role === "assistant" ? "\x1b[33m" : "\x1b[36m";
    console.log(`  ${roleColor}[${p.role}]\x1b[0m \x1b[2m${p.timestamp}\x1b[0m`);

    const lines = p.text.split("\n").slice(0, 10);
    for (const line of lines) {
      const truncated = line.length > 120 ? line.slice(0, 120) + "..." : line;
      console.log(`    ${truncated}`);
    }
    if (p.text.split("\n").length > 10) {
      console.log(`    \x1b[2m... (${p.text.split("\n").length - 10} more lines)\x1b[0m`);
    }

    if (p.toolCalls && p.toolCalls.length > 0) {
      for (const tc of p.toolCalls) {
        console.log(`    \x1b[36m-> ${tc}\x1b[0m`);
      }
    }
    console.log();
  }
}

// ============================================================
// info
// ============================================================

function cmdInfo(target: string, jsonMode: boolean): void {
  const { filePath, format } = resolveTarget(target);
  const content = readFileSync(filePath, "utf-8");
  const lines = content.split("\n").filter(Boolean);

  const info: Record<string, unknown> = {
    file: filePath,
    format,
    totalLines: lines.length,
    sizeKB: (Buffer.byteLength(content) / 1024).toFixed(1),
  };

  const types: Record<string, number> = {};
  for (const line of lines) {
    try {
      const obj = JSON.parse(line);
      types[obj.type] = (types[obj.type] || 0) + 1;
    } catch { /* skip */ }
  }
  info.recordTypes = types;

  if (format === "codex") {
    try {
      const first = JSON.parse(lines[0]);
      if (first.type === "session_meta") {
        info.sessionId = first.payload.id;
        info.cwd = first.payload.cwd;
        info.model = first.payload.model;
        info.cliVersion = first.payload.cli_version;
        info.startedAt = first.payload.timestamp;
      }
    } catch { /* skip */ }
  } else if (format === "claude") {
    try {
      const first = lines.find((l) => {
        try { return JSON.parse(l).sessionId; } catch { return false; }
      });
      if (first) {
        const obj = JSON.parse(first);
        info.sessionId = obj.sessionId;
        info.cwd = obj.cwd;
        info.version = obj.version;
        info.gitBranch = obj.gitBranch;
        info.startedAt = obj.timestamp;
      }
    } catch { /* skip */ }
  }

  if (jsonMode) {
    console.log(JSON.stringify(info, null, 2));
  } else {
    console.log("\n\x1b[1m  Session Info\x1b[0m\n");
    for (const [k, v] of Object.entries(info)) {
      if (typeof v === "object" && v !== null) {
        console.log(`  \x1b[2m${k}:\x1b[0m`);
        for (const [kk, vv] of Object.entries(v as Record<string, unknown>)) {
          console.log(`    ${kk}: ${vv}`);
        }
      } else {
        console.log(`  \x1b[2m${k}:\x1b[0m ${v}`);
      }
    }
    console.log();
  }
}

// ============================================================
// convert
// ============================================================

function cmdConvert(
  target: string,
  direction: "codex2claude" | "claude2codex" | "auto",
  outputPath: string | undefined,
  jsonMode: boolean,
  dryRun: boolean,
  tailTurns?: number,
): void {
  const { filePath, format } = resolveTarget(target);
  let lines = readFileSync(filePath, "utf-8").split("\n").filter(Boolean);

  // --tail: keep only session_meta + last N user turns (with their surrounding context)
  if (tailTurns && tailTurns > 0) {
    lines = trimToTail(lines, tailTurns, format);
  }

  let actualDirection: "codex2claude" | "claude2codex";
  if (direction === "auto") {
    if (format === "codex") {
      actualDirection = "codex2claude";
    } else if (format === "claude") {
      actualDirection = "claude2codex";
    } else {
      console.error("Cannot auto-detect format. Specify codex2claude or claude2codex explicitly.");
      process.exit(1);
    }
  } else {
    actualDirection = direction;
  }

  let result: { records: string[]; meta: Omit<ConversionMeta, "sourceFile" | "outputPath">; sourceCwd?: string; firstUserMessage?: string };
  if (actualDirection === "codex2claude") {
    result = convertCodexToClaude(lines);
  } else {
    result = convertClaudeToCodex(lines);
  }

  const finalOutput = outputPath || generateOutputPath(actualDirection, result.meta.sourceSessionId, result.sourceCwd);

  if (dryRun) {
    const summary = {
      direction: actualDirection,
      sourceFile: filePath,
      sourceFormat: format,
      wouldWriteTo: finalOutput,
      ...result.meta.stats,
      lossyFields: result.meta.lossyFields,
    };
    if (jsonMode) {
      console.log(JSON.stringify(summary, null, 2));
    } else {
      console.log("\n\x1b[1m  Dry Run\x1b[0m\n");
      for (const [k, v] of Object.entries(summary)) {
        console.log(`  \x1b[2m${k}:\x1b[0m ${Array.isArray(v) ? v.join(", ") : v}`);
      }
      console.log();
    }
    return;
  }

  mkdirSync(dirname(finalOutput), { recursive: true });
  writeFileSync(finalOutput, result.records.join("\n") + "\n");

  // Register in Claude Code's history.jsonl so `claude --resume <id>` can discover the session
  if (actualDirection === "codex2claude") {
    const projectPath = result.sourceCwd || process.cwd();
    registerInClaudeHistory(result.meta.sourceSessionId, projectPath, result.firstUserMessage || "bridged session");
  }

  const report: Record<string, unknown> = {
    success: true,
    direction: actualDirection,
    sourceFile: filePath,
    outputFile: finalOutput,
    ...result.meta.stats,
    lossyFields: result.meta.lossyFields,
    resumeHint: actualDirection === "codex2claude"
      ? `claude --resume ${result.meta.sourceSessionId}`
      : `codex resume ${result.meta.sourceSessionId}`,
  };
  if (actualDirection === "codex2claude" && result.sourceCwd) {
    report.requiredCwd = result.sourceCwd;
    report.fullResumeCommand = `cd ${result.sourceCwd} && claude --resume ${result.meta.sourceSessionId}`;
  }

  if (jsonMode) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    const arrow = actualDirection === "codex2claude" ? "Codex -> Claude Code" : "Claude Code -> Codex";
    console.log(`\n\x1b[32m\x1b[1m  Bridged: ${arrow}\x1b[0m\n`);
    console.log(`  \x1b[2mSource:\x1b[0m     ${filePath}`);
    console.log(`  \x1b[2mOutput:\x1b[0m     ${finalOutput}`);
    console.log(`  \x1b[2mRecords:\x1b[0m    ${result.meta.stats.totalRecords} total -> ${result.meta.stats.convertedRecords} converted, ${result.meta.stats.skippedRecords} skipped`);
    console.log(`  \x1b[2mMessages:\x1b[0m   ${result.meta.stats.userMessages} user, ${result.meta.stats.assistantMessages} assistant`);
    console.log(`  \x1b[2mTool calls:\x1b[0m ${result.meta.stats.toolCalls}`);
    if (result.meta.lossyFields.length > 0) {
      console.log(`  \x1b[2mLossy:\x1b[0m      ${result.meta.lossyFields.join(", ")}`);
    }
    console.log(`\n  \x1b[1mResume:\x1b[0m ${report.resumeHint}`);
    if (actualDirection === "codex2claude" && result.sourceCwd) {
      console.log(`\n  \x1b[33m⚠ Claude Code resolves sessions by cwd. Run from the original project directory:\x1b[0m`);
      console.log(`  \x1b[1mcd ${result.sourceCwd} && ${report.resumeHint}\x1b[0m`);
    }
    console.log();
  }
}

// ============================================================
// Session preview extraction
// ============================================================

interface MessagePreview {
  role: string;
  text: string;
  timestamp: string;
  toolCalls?: string[];
}

function getSessionPreview(filePath: string, format: string, limit: number): MessagePreview[] {
  const previews: MessagePreview[] = [];

  try {
    const content = readFileSync(filePath, "utf-8");
    const lines = content.split("\n").filter(Boolean);

    if (format === "codex") {
      for (const line of lines) {
        if (previews.length >= limit) break;
        try {
          const rec = JSON.parse(line);
          if (rec.type !== "response_item") continue;
          const p = rec.payload;
          if (p.type === "message" && (p.role === "user" || p.role === "assistant")) {
            const text = (p.content || [])
              .map((c: any) => c.text || "")
              .join("\n")
              .trim();
            if (!text) continue;
            // Skip system/developer messages
            if (text.startsWith("<permissions") || text.startsWith("# AGENTS.md") || text.startsWith("[SYSTEM/DEVELOPER]")) continue;
            previews.push({ role: p.role, text, timestamp: rec.timestamp });
          }
        } catch { /* skip */ }
      }
    } else if (format === "claude") {
      for (const line of lines) {
        if (previews.length >= limit) break;
        try {
          const rec = JSON.parse(line);
          if (rec.type === "user") {
            const msgContent = rec.message?.content;
            const text = typeof msgContent === "string"
              ? msgContent
              : (msgContent || []).filter((c: any) => c.type === "text").map((c: any) => c.text).join("\n");
            if (!text.trim()) continue;
            previews.push({ role: "user", text: text.trim(), timestamp: rec.timestamp });
          } else if (rec.type === "assistant") {
            const msgContent = rec.message?.content || [];
            const texts = msgContent.filter((c: any) => c.type === "text").map((c: any) => c.text);
            const tools = msgContent.filter((c: any) => c.type === "tool_use").map((c: any) => `${c.name}()`);
            const text = texts.join("\n").trim();
            if (!text && tools.length === 0) continue;
            previews.push({
              role: "assistant",
              text: text || "(tool calls only)",
              timestamp: rec.timestamp,
              toolCalls: tools.length > 0 ? tools : undefined,
            });
          }
        } catch { /* skip */ }
      }
    }
  } catch { /* file read error */ }

  return previews;
}

// ============================================================
// Tail trimming
// ============================================================

/**
 * Trim session lines to keep only the last N user turns.
 * Preserves session_meta/turn_context headers and all records from the last N turns onwards.
 */
function trimToTail(lines: string[], tailTurns: number, format: string): string[] {
  if (format === "codex") {
    // Find all user message positions
    const userPositions: number[] = [];
    for (let i = 0; i < lines.length; i++) {
      try {
        const obj = JSON.parse(lines[i]);
        if (obj.type === "response_item" && obj.payload?.type === "message" && obj.payload?.role === "user") {
          userPositions.push(i);
        }
      } catch { /* skip */ }
    }

    if (userPositions.length <= tailTurns) return lines; // nothing to trim

    const cutIdx = userPositions[userPositions.length - tailTurns];

    // Keep headers (session_meta, first turn_context) + everything from cutIdx onwards
    const headers: string[] = [];
    for (const line of lines.slice(0, cutIdx)) {
      try {
        const obj = JSON.parse(line);
        if (obj.type === "session_meta" || obj.type === "turn_context") {
          headers.push(line);
          if (obj.type === "turn_context") break; // only need first one
        }
      } catch { /* skip */ }
    }

    return [...headers, ...lines.slice(cutIdx)];
  } else if (format === "claude") {
    // Find all user message positions
    const userPositions: number[] = [];
    for (let i = 0; i < lines.length; i++) {
      try {
        const obj = JSON.parse(lines[i]);
        if (obj.type === "user" && obj.message?.role === "user") {
          // Skip tool_result-only user messages
          const content = obj.message.content;
          if (typeof content === "string" || (Array.isArray(content) && content.some((c: any) => c.type !== "tool_result"))) {
            userPositions.push(i);
          }
        }
      } catch { /* skip */ }
    }

    if (userPositions.length <= tailTurns) return lines;

    const cutIdx = userPositions[userPositions.length - tailTurns];

    // Keep file-history-snapshot + everything from cutIdx onwards
    const headers: string[] = [];
    for (const line of lines.slice(0, cutIdx)) {
      try {
        const obj = JSON.parse(line);
        if (obj.type === "file-history-snapshot") {
          headers.push(line);
          break;
        }
      } catch { /* skip */ }
    }

    return [...headers, ...lines.slice(cutIdx)];
  }

  return lines;
}

// ============================================================
// Target resolution
// ============================================================

function resolveTarget(target: string): { filePath: string; format: "codex" | "claude" | "unknown" } {
  if (!target) {
    console.error(`No session specified. Run '${NAME} list' to see available sessions.`);
    process.exit(1);
  }

  // Direct file path
  if (existsSync(target)) {
    const firstLine = readFileSync(target, "utf-8").split("\n")[0];
    return { filePath: resolve(target), format: detectFormat(firstLine) };
  }

  // Unified search: list all sessions, match by full or partial ID, prefer originals
  const allCodex = listCodexSessions(500);
  const allClaude = listClaudeSessions(500);

  // Phase 1: Exact full ID match — originals first
  const codexExact = allCodex.find((s) => s.id === target && !s.converted);
  if (codexExact) return { filePath: codexExact.file, format: "codex" };

  const claudeExact = allClaude.find((s) => s.id === target && !s.converted);
  if (claudeExact) return { filePath: claudeExact.file, format: "claude" };

  // Phase 2: Partial ID match (8+ chars) — originals first
  if (target.length >= 8) {
    const claudePartial = allClaude.find((s) => s.id.startsWith(target) && !s.converted);
    if (claudePartial) return { filePath: claudePartial.file, format: "claude" };

    const codexPartial = allCodex.find((s) => s.id.startsWith(target) && !s.converted);
    if (codexPartial) return { filePath: codexPartial.file, format: "codex" };
  }

  // Phase 3: Fall back to converted sessions
  const codexConverted = allCodex.find((s) => (s.id === target || (target.length >= 8 && s.id.startsWith(target))) && s.converted);
  if (codexConverted) return { filePath: codexConverted.file, format: "codex" };

  const claudeConverted = allClaude.find((s) => (s.id === target || (target.length >= 8 && s.id.startsWith(target))) && s.converted);
  if (claudeConverted) return { filePath: claudeConverted.file, format: "claude" };

  console.error(`Session not found: ${target}`);
  console.error(`Run '${NAME} list' to see available sessions.`);
  process.exit(1);
}

function generateOutputPath(direction: "codex2claude" | "claude2codex", sessionId: string, sourceCwd?: string): string {
  const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);

  if (direction === "codex2claude") {
    // Place in the correct Claude Code project directory matching the source cwd
    // Claude Code maps /home/user/project -> ~/.claude/projects/-home-user-project/
    const cwd = sourceCwd || process.cwd();
    const projectDirName = "-" + cwd.replace(/\//g, "-").replace(/^-/, "");
    const projectDir = join(claudeProjectsDir(), projectDirName);
    mkdirSync(projectDir, { recursive: true });
    return join(projectDir, `${sessionId}.jsonl`);
  } else {
    const now = new Date();
    const y = now.getFullYear().toString();
    const m = (now.getMonth() + 1).toString().padStart(2, "0");
    const d = now.getDate().toString().padStart(2, "0");
    const codexDir = join(codexSessionsDir(), y, m, d);
    mkdirSync(codexDir, { recursive: true });
    return join(codexDir, `converted-${ts}-${sessionId}.jsonl`);
  }
}

/**
 * Register a converted session in Claude Code's history.jsonl so --resume can find it.
 */
function registerInClaudeHistory(sessionId: string, projectPath: string, firstMessage: string): void {
  const historyPath = join(homedir(), ".claude", "history.jsonl");
  const entry = JSON.stringify({
    display: `[bridged from Codex] ${firstMessage.slice(0, 100)}`,
    pastedContents: {},
    timestamp: Date.now(),
    project: projectPath,
    sessionId,
  });
  appendFileSync(historyPath, entry + "\n");
}

main();
