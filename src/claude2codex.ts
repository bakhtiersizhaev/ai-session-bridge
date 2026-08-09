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
  let activeTurnId: string | null = null;
  let lastAssistantMessage = "";

  const closeTurn = (timestamp: string): void => {
    if (!activeTurnId) return;
    output.push(JSON.stringify({
      timestamp,
      type: "event_msg",
      payload: { type: "task_complete", turn_id: activeTurnId, last_agent_message: lastAssistantMessage },
    }));
    activeTurnId = null;
    lastAssistantMessage = "";
  };

  const startTurn = (timestamp: string): void => {
    activeTurnId = randomUUID();
    output.push(JSON.stringify({
      timestamp,
      type: "turn_context",
      payload: {
        turn_id: activeTurnId,
        cwd: state.cwd,
        current_date: timestamp.slice(0, 10),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        model: state.model,
      },
    }));
    output.push(JSON.stringify({ timestamp, type: "event_msg", payload: { type: "task_started", turn_id: activeTurnId } }));
  };

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

  // Emit session_meta. `session_id` duplicates `id` — current Codex builds
  // write both, and session tooling keys off session_id when present.
  const now = new Date().toISOString();
  let lastProcessedTimestamp = now;
  output.push(JSON.stringify({
    timestamp: now,
    type: "session_meta",
    payload: {
      id: state.sessionId,
      session_id: state.sessionId,
      timestamp: now,
      cwd: state.cwd,
      originator: "session_converter",
      cli_version: state.cliVersion,
      source: "converted",
      model_provider: "anthropic",
      model: state.model,
    },
  } satisfies CodexSessionMeta));

  for (const line of lines) {
    const rec = safeParse(line);
    if (!rec) continue;
    state.stats.totalRecords++;
    const timestamp = (rec.timestamp as string) || now;
    lastProcessedTimestamp = timestamp;

    switch (rec.type) {
      case "file-history-snapshot": {
        state.lossyFields.add("file-history-snapshot");
        state.stats.skippedRecords++;
        break;
      }

      // Claude Code bookkeeping records with no Codex equivalent. Listed
      // explicitly so the skip is intentional, not an accident of the default.
      case "mode":
      case "permission-mode":
      case "last-prompt":
      case "queue-operation":
      case "custom-title":
      case "attachment":
      case "system": {
        state.lossyFields.add(`claude.${rec.type}`);
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
                  output: normalizeToolResultContent(item.content),
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

        // New user turn — close the previous one and emit current Codex boundaries.
        closeTurn(timestamp);
        state.turnCounter++;
        startTurn(timestamp);

        if (!state.firstUserMessage && content.trim()) {
          state.firstUserMessage = content.trim();
        }

        output.push(JSON.stringify({
          timestamp,
          type: "event_msg",
          payload: {
            type: "user_message",
            client_id: ur.uuid || randomUUID(),
            message: content,
            images: [], local_images: [], audio: [], local_audio: [], text_elements: [],
          },
        }));

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
          const block = item as unknown as Record<string, unknown>;
          if (block.type === "text") {
            textParts.push(block.text as string);
          } else if (block.type === "tool_use") {
            toolUses.push({
              id: block.id as string,
              name: block.name as string,
              input: (block.input as Record<string, unknown>) || {},
            });
          } else if (block.type === "thinking" || block.type === "redacted_thinking") {
            // Extended-thinking blocks have no Codex equivalent.
            state.lossyFields.add("thinking_blocks");
          }
        }

        // Emit text as assistant message
        if (textParts.length > 0) {
          const assistantText = textParts.join("\n");
          output.push(JSON.stringify({
            timestamp,
            type: "response_item",
            payload: {
              type: "message",
              role: "assistant",
              content: [{ type: "output_text", text: assistantText }],
            },
          }));
          output.push(JSON.stringify({
            timestamp,
            type: "event_msg",
            payload: { type: "agent_message", message: assistantText, phase: "final_answer", memory_citation: null },
          }));
          lastAssistantMessage = assistantText;
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

  closeTurn(lastProcessedTimestamp);

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

// Map Claude Code tool names to Codex equivalents.
// shell_command is the exec tool name current Codex CLI/Desktop sessions use;
// exec_command is kept as the legacy alias for older rollouts.
function mapToolName(name: string, _direction: string): string {
  const claude2codex: Record<string, string> = {
    Bash: "shell_command",
    Read: "read_file",
    Write: "write_file",
    Edit: "patch_file",
    Glob: "list_directory",
    Grep: "search_files",
    AskUserQuestion: "request_user_input",
    TodoWrite: "update_plan",
    Task: "shell_command", // closest equivalent
    WebFetch: "shell_command",
    WebSearch: "shell_command",
  };
  const mapped = claude2codex[name] || name;
  const sanitized = mapped.replace(/[^a-zA-Z0-9_-]+/g, "_");
  return (sanitized || "claude_tool").slice(0, 64);
}

function normalizeContent(content: string | Array<Record<string, unknown>>): string {
  if (typeof content === "string") return content;
  return content
    .filter((c) => c.type === "text")
    .map((c) => c.text as string)
    .join("\n");
}

/**
 * Flatten a Claude tool_result payload to plain text for Codex
 * function_call_output. Text blocks are joined; non-text blocks (images etc.)
 * are dropped rather than dumped as base64 JSON noise.
 */
function normalizeToolResultContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const texts = (content as Array<Record<string, unknown>>)
      .filter((c) => c && c.type === "text" && typeof c.text === "string")
      .map((c) => c.text as string);
    if (texts.length > 0) return texts.join("\n");
  }
  return JSON.stringify(content ?? "");
}

function safeParse(line: string): Record<string, unknown> | null {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}
