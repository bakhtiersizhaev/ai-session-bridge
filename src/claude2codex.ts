import { randomUUID } from "crypto";
import type {
  CodexRecord,
  CodexSessionMeta,
  ClaudeUserRecord,
  ClaudeAssistantRecord,
  ClaudeProgressRecord,
  ClaudeFileHistoryRecord,
  ConversionMeta,
} from "./types.js";

interface ConvertState {
  sessionId: string;
  cwd: string;
  model: string;
  cliVersion: string;
  turnCounter: number;
  stats: ConversionMeta["stats"];
  lossyFields: Set<string>;
  firstUserMessage: string;
}

export function convertClaudeToCodex(lines: string[]): { records: string[]; meta: Omit<ConversionMeta, "sourceFile" | "outputPath">; sourceCwd?: string; firstUserMessage?: string } {
  const state: ConvertState = {
    sessionId: randomUUID(),
    cwd: process.cwd(),
    model: "unknown",
    cliVersion: "converted-from-claude",
    turnCounter: 0,
    stats: { totalRecords: 0, convertedRecords: 0, skippedRecords: 0, toolCalls: 0, userMessages: 0, assistantMessages: 0 },
    lossyFields: new Set(),
    firstUserMessage: "",
  };

  const output: string[] = [];

  // First pass: extract session metadata from first user/assistant record
  for (const line of lines) {
    const rec = safeParse(line);
    if (!rec) continue;
    if (rec.sessionId) {
      state.sessionId = rec.sessionId as string;
      state.cwd = (rec.cwd as string) || state.cwd;
    }
    if (rec.type === "assistant" && rec.message) {
      const msg = rec.message as Record<string, unknown>;
      if (msg.model) state.model = msg.model as string;
      break;
    }
  }

  // Emit session_meta
  const now = new Date().toISOString();
  output.push(JSON.stringify({
    timestamp: now,
    type: "session_meta",
    payload: {
      id: state.sessionId,
      timestamp: now,
      cwd: state.cwd,
      originator: "session_converter",
      cli_version: state.cliVersion,
      source: "converted",
      model_provider: "anthropic",
      model: state.model,
    },
  } satisfies CodexSessionMeta));

  // Emit initial turn_context
  state.turnCounter++;
  const turnId = randomUUID();
  output.push(JSON.stringify({
    timestamp: now,
    type: "turn_context",
    payload: {
      turn_id: turnId,
      cwd: state.cwd,
      current_date: now.slice(0, 10),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      model: state.model,
    },
  }));

  output.push(JSON.stringify({
    timestamp: now,
    type: "event_msg",
    payload: {
      type: "task_started",
      turn_id: turnId,
    },
  }));

  for (const line of lines) {
    const rec = safeParse(line);
    if (!rec) continue;
    state.stats.totalRecords++;
    const timestamp = (rec.timestamp as string) || now;

    switch (rec.type) {
      case "file-history-snapshot": {
        state.lossyFields.add("file-history-snapshot");
        state.stats.skippedRecords++;
        break;
      }

      case "user": {
        const ur = rec as unknown as ClaudeUserRecord;
        const content = normalizeContent(ur.message.content);

        // Check if content contains tool_result items
        if (Array.isArray(ur.message.content)) {
          for (const item of ur.message.content as Array<Record<string, unknown>>) {
            if (item.type === "tool_result") {
              output.push(JSON.stringify({
                timestamp,
                type: "response_item",
                payload: {
                  type: "function_call_output",
                  call_id: item.tool_use_id as string,
                  output: typeof item.content === "string"
                    ? item.content
                    : JSON.stringify(item.content),
                },
              }));
              state.stats.convertedRecords++;
              continue;
            }
          }
          // If all items were tool_results, skip the user message creation
          const hasNonToolResult = (ur.message.content as Array<Record<string, unknown>>).some(
            (item) => item.type !== "tool_result"
          );
          if (!hasNonToolResult) break;
        }

        // New user turn — emit turn boundaries
        state.turnCounter++;
        const newTurnId = randomUUID();

        output.push(JSON.stringify({
          timestamp,
          type: "event_msg",
          payload: { type: "task_started", turn_id: newTurnId },
        }));

        if (!state.firstUserMessage && content.trim()) {
          state.firstUserMessage = content.trim();
        }

        output.push(JSON.stringify({
          timestamp,
          type: "response_item",
          payload: {
            type: "message",
            role: "user",
            content: [{ type: "input_text", text: content }],
          },
        }));
        state.stats.userMessages++;
        state.stats.convertedRecords++;
        break;
      }

      case "assistant": {
        const ar = rec as unknown as ClaudeAssistantRecord;
        const msgContent = ar.message?.content || [];

        // Separate text content and tool_use content
        const textParts: string[] = [];
        const toolUses: Array<{ id: string; name: string; input: Record<string, unknown> }> = [];

        for (const item of msgContent) {
          if (item.type === "text") {
            textParts.push((item as any).text);
          } else if (item.type === "tool_use") {
            toolUses.push({
              id: (item as any).id,
              name: (item as any).name,
              input: (item as any).input || {},
            });
          }
        }

        // Emit text as assistant message
        if (textParts.length > 0) {
          output.push(JSON.stringify({
            timestamp,
            type: "response_item",
            payload: {
              type: "message",
              role: "assistant",
              content: [{ type: "output_text", text: textParts.join("\n") }],
            },
          }));
          state.stats.assistantMessages++;
          state.stats.convertedRecords++;
        }

        // Emit tool calls as function_call
        for (const tu of toolUses) {
          output.push(JSON.stringify({
            timestamp,
            type: "response_item",
            payload: {
              type: "function_call",
              name: mapToolName(tu.name, "claude2codex"),
              arguments: JSON.stringify(tu.input),
              call_id: tu.id,
            },
          }));
          state.stats.toolCalls++;
          state.stats.convertedRecords++;
        }
        break;
      }

      case "progress": {
        const pr = rec as unknown as ClaudeProgressRecord;
        output.push(JSON.stringify({
          timestamp,
          type: "event_msg",
          payload: {
            type: "progress",
            ...(pr.data || {}),
          },
        }));
        state.stats.convertedRecords++;
        break;
      }

      default:
        state.stats.skippedRecords++;
    }
  }

  // Emit task_completed
  output.push(JSON.stringify({
    timestamp: now,
    type: "event_msg",
    payload: { type: "task_completed", turn_id: turnId },
  }));

  return {
    records: output,
    meta: {
      sourceFormat: "claude",
      sourceSessionId: state.sessionId,
      targetFormat: "codex",
      convertedAt: new Date().toISOString(),
      lossyFields: [...state.lossyFields],
      stats: state.stats,
    },
    sourceCwd: state.cwd,
    firstUserMessage: state.firstUserMessage,
  };
}

// Map Claude Code tool names to Codex equivalents
function mapToolName(name: string, _direction: string): string {
  const claude2codex: Record<string, string> = {
    Bash: "exec_command",
    Read: "read_file",
    Write: "write_file",
    Edit: "patch_file",
    Glob: "list_directory",
    Grep: "search_files",
    AskUserQuestion: "request_user_input",
    Task: "exec_command", // closest equivalent
    WebFetch: "exec_command",
    WebSearch: "exec_command",
  };
  return claude2codex[name] || name;
}

function normalizeContent(content: string | Array<Record<string, unknown>>): string {
  if (typeof content === "string") return content;
  return content
    .filter((c) => c.type === "text")
    .map((c) => c.text as string)
    .join("\n");
}

function safeParse(line: string): Record<string, unknown> | null {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}
