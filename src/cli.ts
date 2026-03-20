#!/usr/bin/env tsx
/**
 * session-converter — Bidirectional Codex CLI <-> Claude Code session converter
 *
 * Usage:
 *   session-converter codex2claude <session-id-or-file>  [--output <path>]
 *   session-converter claude2codex <session-id-or-file>  [--output <path>]
 *   session-converter auto         <session-id-or-file>  [--output <path>]
 *   session-converter list         [codex|claude]
 *   session-converter info         <session-id-or-file>
 *   session-converter preview      <session-id-or-file>
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { dirname, join, resolve } from "path";
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

const VERSION = "0.2.0";

const HELP = `
session-converter v${VERSION}
Bidirectional Codex CLI <-> Claude Code session converter

Commands:
  codex2claude <id|file> [--output <path>]   Convert Codex session to Claude Code format
  claude2codex <id|file> [--output <path>]   Convert Claude Code session to Codex format
  auto         <id|file> [--output <path>]   Auto-detect format and convert to the other
  list         [codex|claude]                List recent sessions with previews
  info         <id|file>                     Show detailed session info
  preview      <id|file>                     Show first messages from session

Options:
  --output, -o <path>    Output file path (default: auto-generated)
  --json                 Output result as JSON (for AI agent consumption)
  --dry-run              Show what would be converted without writing
  --preview-lines <n>    Number of message previews to show (default: 5)
  --help, -h             Show this help
  --version, -v          Show version

Examples:
  # List all sessions with previews
  session-converter list

  # Convert specific Codex session to Claude Code
  session-converter codex2claude 019ced67-e597-72d2-9e6d-657e520103b0

  # Auto-detect and convert a file
  session-converter auto /path/to/session.jsonl

  # Convert with custom output path
  session-converter codex2claude 019ced67 -o ~/my-converted-session.jsonl

  # Get JSON result (for AI agents)
  session-converter auto 019ced67 --json

  # Preview session content before converting
  session-converter preview 019ced67
`;

function main(): void {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
    console.log(HELP);
    process.exit(0);
  }

  if (args.includes("--version") || args.includes("-v")) {
    console.log(VERSION);
    process.exit(0);
  }

  const command = args[0];
  const target = args[1];
  const jsonMode = args.includes("--json");
  const dryRun = args.includes("--dry-run");
  const outputIdx = args.indexOf("--output") !== -1 ? args.indexOf("--output") : args.indexOf("-o");
  const outputPath = outputIdx !== -1 ? args[outputIdx + 1] : undefined;
  const previewLinesIdx = args.indexOf("--preview-lines");
  const previewLines = previewLinesIdx !== -1 ? parseInt(args[previewLinesIdx + 1], 10) : 5;

  switch (command) {
    case "list":
      cmdList(target as "codex" | "claude" | undefined, jsonMode, previewLines);
      break;
    case "info":
      cmdInfo(target, jsonMode);
      break;
    case "preview":
      cmdPreview(target, jsonMode, previewLines);
      break;
    case "codex2claude":
      cmdConvert(target, "codex2claude", outputPath, jsonMode, dryRun);
      break;
    case "claude2codex":
      cmdConvert(target, "claude2codex", outputPath, jsonMode, dryRun);
      break;
    case "auto":
      cmdConvert(target, "auto", outputPath, jsonMode, dryRun);
      break;
    default:
      console.error(`Unknown command: ${command}`);
      console.log(HELP);
      process.exit(1);
  }
}

// ============================================================
// list — sessions with preview
// ============================================================

function cmdList(filter: "codex" | "claude" | undefined, jsonMode: boolean, _previewLines: number): void {
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
    console.log("\n\x1b[1m\x1b[34m=== Codex CLI Sessions ===\x1b[0m");
    console.log(`  \x1b[2mLocation: ${codexSessionsDir()}\x1b[0m\n`);
    for (const s of results.codex as any[]) {
      const sizeKb = (s.size / 1024).toFixed(0);
      console.log(`  \x1b[1m${s.id}\x1b[0m`);
      console.log(`    \x1b[2mDate:\x1b[0m ${s.date}  \x1b[2mSize:\x1b[0m ${sizeKb}KB`);
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
  }

  if (results.claude) {
    console.log("\n\x1b[1m\x1b[35m=== Claude Code Sessions ===\x1b[0m");
    console.log(`  \x1b[2mLocation: ${claudeProjectsDir()}\x1b[0m\n`);
    for (const s of results.claude as any[]) {
      const sizeKb = (s.size / 1024).toFixed(0);
      console.log(`  \x1b[1m${s.id}\x1b[0m`);
      console.log(`    \x1b[2mProject:\x1b[0m ${s.project}  \x1b[2mSize:\x1b[0m ${sizeKb}KB`);
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
  }
}

// ============================================================
// preview — detailed session preview
// ============================================================

function cmdPreview(target: string, jsonMode: boolean, limit: number): void {
  const { filePath, format } = resolveTarget(target);
  const previews = getSessionPreview(filePath, format, limit);

  if (jsonMode) {
    console.log(JSON.stringify({ file: filePath, format, messages: previews }, null, 2));
    return;
  }

  console.log(`\n\x1b[1mSession Preview\x1b[0m`);
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
// info — session metadata
// ============================================================

function cmdInfo(target: string, jsonMode: boolean): void {
  const { filePath, format } = resolveTarget(target);
  const content = readFileSync(filePath, "utf-8");
  const lines = content.split("\n").filter(Boolean);

  const info: Record<string, unknown> = {
    file: filePath,
    format,
    totalLines: lines.length,
    sizeBytes: Buffer.byteLength(content),
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
    console.log("\n\x1b[1m=== Session Info ===\x1b[0m");
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
): void {
  const { filePath, format } = resolveTarget(target);
  const lines = readFileSync(filePath, "utf-8").split("\n").filter(Boolean);

  let actualDirection: "codex2claude" | "claude2codex";
  if (direction === "auto") {
    if (format === "codex") {
      actualDirection = "codex2claude";
    } else if (format === "claude") {
      actualDirection = "claude2codex";
    } else {
      console.error("Cannot auto-detect format. Please specify codex2claude or claude2codex.");
      process.exit(1);
    }
  } else {
    actualDirection = direction;
  }

  let result: { records: string[]; meta: Omit<ConversionMeta, "sourceFile" | "outputPath"> };
  if (actualDirection === "codex2claude") {
    result = convertCodexToClaude(lines);
  } else {
    result = convertClaudeToCodex(lines);
  }

  const finalOutput = outputPath || generateOutputPath(actualDirection, result.meta.sourceSessionId);

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
      console.log("\n\x1b[1m=== Dry Run ===\x1b[0m");
      for (const [k, v] of Object.entries(summary)) {
        console.log(`  \x1b[2m${k}:\x1b[0m ${Array.isArray(v) ? v.join(", ") : v}`);
      }
      console.log();
    }
    return;
  }

  mkdirSync(dirname(finalOutput), { recursive: true });
  writeFileSync(finalOutput, result.records.join("\n") + "\n");

  const report = {
    success: true,
    direction: actualDirection,
    sourceFile: filePath,
    outputFile: finalOutput,
    ...result.meta.stats,
    lossyFields: result.meta.lossyFields,
    resumeHint: actualDirection === "codex2claude"
      ? `claude --resume ${result.meta.sourceSessionId}`
      : `codex --resume ${result.meta.sourceSessionId}`,
  };

  if (jsonMode) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`\n\x1b[32m\x1b[1m+++ Converted ${actualDirection}\x1b[0m`);
    console.log(`  \x1b[2mSource:\x1b[0m    ${filePath}`);
    console.log(`  \x1b[2mOutput:\x1b[0m    ${finalOutput}`);
    console.log(`  \x1b[2mRecords:\x1b[0m   ${result.meta.stats.totalRecords} total -> ${result.meta.stats.convertedRecords} converted, ${result.meta.stats.skippedRecords} skipped`);
    console.log(`  \x1b[2mMessages:\x1b[0m  ${result.meta.stats.userMessages} user, ${result.meta.stats.assistantMessages} assistant`);
    console.log(`  \x1b[2mTool calls:\x1b[0m ${result.meta.stats.toolCalls}`);
    if (result.meta.lossyFields.length > 0) {
      console.log(`  \x1b[2mLossy:\x1b[0m     ${result.meta.lossyFields.join(", ")}`);
    }
    console.log(`\n  \x1b[1mTo resume:\x1b[0m ${report.resumeHint}`);
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
            if (text.startsWith("<permissions") || text.startsWith("# AGENTS.md")) continue;
            previews.push({
              role: p.role,
              text,
              timestamp: rec.timestamp,
            });
          }
        } catch { /* skip */ }
      }
    } else if (format === "claude") {
      for (const line of lines) {
        if (previews.length >= limit) break;
        try {
          const rec = JSON.parse(line);
          if (rec.type === "user") {
            const content = rec.message?.content;
            const text = typeof content === "string"
              ? content
              : (content || []).filter((c: any) => c.type === "text").map((c: any) => c.text).join("\n");
            if (!text.trim()) continue;
            previews.push({ role: "user", text: text.trim(), timestamp: rec.timestamp });
          } else if (rec.type === "assistant") {
            const content = rec.message?.content || [];
            const texts = content.filter((c: any) => c.type === "text").map((c: any) => c.text);
            const tools = content.filter((c: any) => c.type === "tool_use").map((c: any) => `${c.name}()`);
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
// Target resolution
// ============================================================

function resolveTarget(target: string): { filePath: string; format: "codex" | "claude" | "unknown" } {
  if (!target) {
    console.error("Please provide a session ID or file path.");
    process.exit(1);
  }

  if (existsSync(target)) {
    const firstLine = readFileSync(target, "utf-8").split("\n")[0];
    return { filePath: resolve(target), format: detectFormat(firstLine) };
  }

  const codexFile = findCodexSession(target);
  if (codexFile) return { filePath: codexFile, format: "codex" };

  const claudeFile = findClaudeSession(target);
  if (claudeFile) return { filePath: claudeFile, format: "claude" };

  if (target.length >= 8) {
    const claudeSessions = listClaudeSessions(200);
    const match = claudeSessions.find((s) => s.id.startsWith(target));
    if (match) return { filePath: match.file, format: "claude" };

    const codexSessions = listCodexSessions(200);
    const codexMatch = codexSessions.find((s) => s.id.startsWith(target));
    if (codexMatch) return { filePath: codexMatch.file, format: "codex" };
  }

  console.error(`Session not found: ${target}`);
  console.error("Provide a full session ID, partial ID (8+ chars), or file path.");
  process.exit(1);
}

function generateOutputPath(direction: "codex2claude" | "claude2codex", sessionId: string): string {
  const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);

  if (direction === "codex2claude") {
    const projectDir = join(claudeProjectsDir(), "-converted-from-codex");
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

main();
