import { randomUUID } from "crypto";
import type {
  CodexRecord,
  CodexSessionMeta,
  CodexMessagePayload,
  CodexFunctionCallPayload,
  CodexFunctionCallOutputPayload,
  CodexCompacted,
  ClaudeUserRecord,
  ClaudeAssistantRecord,
  ClaudeProgressRecord,
  ClaudeFileHistoryRecord,
  ConversionMeta,
} from "./types.js";

interface ConvertState {
  sessionId: string;
  cwd: string;
  version: string;
  gitBranch: string;
  model: string;
  lastUuid: string | null;
  pendingToolUses: Array<{ type: "tool_use"; id: string; name: string; input: Record<string, unknown> }>;
  pendingTexts: Array<{ type: "text"; text: string }>;
  stats: ConversionMeta["stats"];
  lossyFields: Set<string>;
}

export function convertCodexToClaude(lines: string[]): { records: string[]; meta: Omit<ConversionMeta, "sourceFile" | "outputPath"> } {
  const state: ConvertState = {
    sessionId: randomUUID(),
    cwd: process.cwd(),
    version: "converted-from-codex",
    gitBranch: "",
    model: "unknown",
    lastUuid: null,
    pendingToolUses: [],
    pendingTexts: [],
    stats: { totalRecords: 0, convertedRecords: 0, skippedRecords: 0, toolCalls: 0, userMessages: 0, assistantMessages: 0 },
    lossyFields: new Set(),
  };

  const output: string[] = [];

  // First pass: extract session metadata
  for (const line of lines) {
    const rec = safeParse(line);
    if (!rec) continue;
    if (rec.type === "session_meta") {
      const meta = rec as CodexSessionMeta;
      state.sessionId = meta.payload.id || state.sessionId;
      state.cwd = meta.payload.cwd || state.cwd;
      state.model = (meta.payload.model as string) || "unknown";
      break;
    }
  }

  // Emit initial file-history-snapshot (Claude Code convention)
  const firstUuid = randomUUID();
  output.push(JSON.stringify({
    type: "file-history-snapshot",
    messageId: firstUuid,
    snapshot: {
      messageId: firstUuid,
      trackedFileBackups: {},
      timestamp: new Date().toISOString(),
    },
    isSnapshotUpdate: false,
  } satisfies ClaudeFileHistoryRecord));

  // Collect function_calls that belong to the same assistant turn
  let pendingFunctionCalls: Array<{ name: string; arguments: string; call_id: string }> = [];
  let pendingFunctionOutputs: Map<string, string> = new Map();
  let currentTurnTexts: Array<{ type: "text"; text: string }> = [];

  for (const line of lines) {
    const rec = safeParse(line);
    if (!rec) continue;
    state.stats.totalRecords++;

    switch (rec.type) {
      case "session_meta":
        state.lossyFields.add("session_meta.base_instructions");
        state.stats.skippedRecords++;
        break;

      case "turn_context": {
        // Extract model and context info
        const tc = rec.payload as Record<string, unknown>;
        if (tc.model) state.model = tc.model as string;
        if (tc.cwd) state.cwd = tc.cwd as string;
        state.lossyFields.add("turn_context.collaboration_mode");
        state.lossyFields.add("turn_context.approval_policy");
        state.stats.skippedRecords++;
        break;
      }

      case "event_msg": {
        const ev = rec.payload as Record<string, unknown>;
        const uuid = randomUUID();
        output.push(JSON.stringify({
          parentUuid: state.lastUuid,
          isSidechain: false,
          userType: "external",
          cwd: state.cwd,
          sessionId: state.sessionId,
          version: state.version,
          gitBranch: state.gitBranch,
          type: "progress",
          data: { type: ev.type, ...ev },
          uuid,
          timestamp: rec.timestamp,
        } satisfies ClaudeProgressRecord));
        state.stats.convertedRecords++;
        break;
      }

      case "compacted": {
        const comp = rec as CodexCompacted;
        // Convert compacted replacement_history as condensed messages
        if (comp.payload.replacement_history) {
          for (const msg of comp.payload.replacement_history) {
            if (msg.role === "user") {
              const text = msg.content.map((c) => c.text).join("\n");
              const uuid = randomUUID();
              output.push(JSON.stringify(makeClaudeUser(state, text, uuid, rec.timestamp)));
              state.lastUuid = uuid;
              state.stats.userMessages++;
              state.stats.convertedRecords++;
            } else if (msg.role === "assistant") {
              const text = msg.content.map((c) => c.text).join("\n");
              const uuid = randomUUID();
              output.push(JSON.stringify(makeClaudeAssistant(state, [{ type: "text", text }], uuid, rec.timestamp)));
              state.lastUuid = uuid;
              state.stats.assistantMessages++;
              state.stats.convertedRecords++;
            }
          }
        }
        if (comp.payload.message) {
          state.lossyFields.add("compacted.summary_message");
        }
        break;
      }

      case "response_item": {
        const payload = rec.payload as Record<string, unknown>;
        const ptype = payload.type as string;

        if (ptype === "message") {
          const msg = payload as unknown as CodexMessagePayload;

          if (msg.role === "user") {
            // Flush any pending assistant content first
            flushAssistant(state, output, pendingFunctionCalls, pendingFunctionOutputs, currentTurnTexts, rec.timestamp);
            pendingFunctionCalls = [];
            pendingFunctionOutputs = new Map();
            currentTurnTexts = [];

            const text = msg.content.map((c) => c.text).join("\n");
            const uuid = randomUUID();
            output.push(JSON.stringify(makeClaudeUser(state, text, uuid, rec.timestamp)));
            state.lastUuid = uuid;
            state.stats.userMessages++;
            state.stats.convertedRecords++;
          } else if (msg.role === "assistant") {
            const text = msg.content.map((c) => c.text).join("\n");
            if (text.trim()) {
              currentTurnTexts.push({ type: "text", text });
            }
            state.stats.convertedRecords++;
          } else if (msg.role === "developer") {
            // Developer messages are system-level instructions
            // Store as a user message with [SYSTEM] prefix for context
            const text = msg.content.map((c) => c.text).join("\n");
            const uuid = randomUUID();
            output.push(JSON.stringify(makeClaudeUser(state, `[SYSTEM/DEVELOPER]\n${text}`, uuid, rec.timestamp)));
            state.lastUuid = uuid;
            state.stats.convertedRecords++;
            state.lossyFields.add("developer_role_as_user_prefix");
          }
        } else if (ptype === "function_call") {
          const fc = payload as unknown as CodexFunctionCallPayload;
          pendingFunctionCalls.push({ name: fc.name, arguments: fc.arguments, call_id: fc.call_id });
          state.stats.toolCalls++;
          state.stats.convertedRecords++;
        } else if (ptype === "function_call_output") {
          const fo = payload as unknown as CodexFunctionCallOutputPayload;
          pendingFunctionOutputs.set(fo.call_id, fo.output);
          state.stats.convertedRecords++;
        }
        break;
      }

      default:
        state.stats.skippedRecords++;
    }
  }

  // Flush any remaining assistant content
  flushAssistant(state, output, pendingFunctionCalls, pendingFunctionOutputs, currentTurnTexts, new Date().toISOString());

  return {
    records: output,
    meta: {
      sourceFormat: "codex",
      sourceSessionId: state.sessionId,
      targetFormat: "claude",
      convertedAt: new Date().toISOString(),
      lossyFields: [...state.lossyFields],
      stats: state.stats,
    },
  };
}

function flushAssistant(
  state: ConvertState,
  output: string[],
  functionCalls: Array<{ name: string; arguments: string; call_id: string }>,
  functionOutputs: Map<string, string>,
  texts: Array<{ type: "text"; text: string }>,
  timestamp: string,
): void {
  if (texts.length === 0 && functionCalls.length === 0) return;

  const content: Array<Record<string, unknown>> = [];

  // Add text content
  for (const t of texts) {
    content.push(t);
  }

  // Add tool_use items
  for (const fc of functionCalls) {
    let parsedInput: Record<string, unknown> = {};
    try {
      parsedInput = JSON.parse(fc.arguments);
    } catch {
      parsedInput = { raw_arguments: fc.arguments };
    }
    content.push({
      type: "tool_use",
      id: fc.call_id,
      name: mapToolName(fc.name, "codex2claude"),
      input: parsedInput,
    });
  }

  if (content.length > 0) {
    const uuid = randomUUID();
    output.push(JSON.stringify(makeClaudeAssistant(state, content, uuid, timestamp)));
    state.lastUuid = uuid;
    state.stats.assistantMessages++;
  }

  // Add tool results as a separate assistant record (Claude Code convention)
  const toolResults: Array<Record<string, unknown>> = [];
  for (const fc of functionCalls) {
    const resultOutput = functionOutputs.get(fc.call_id);
    if (resultOutput !== undefined) {
      toolResults.push({
        type: "tool_result",
        tool_use_id: fc.call_id,
        content: resultOutput,
      });
    }
  }

  if (toolResults.length > 0) {
    const uuid = randomUUID();
    output.push(JSON.stringify({
      parentUuid: state.lastUuid,
      isSidechain: false,
      userType: "external",
      cwd: state.cwd,
      sessionId: state.sessionId,
      version: state.version,
      gitBranch: state.gitBranch,
      type: "user",
      message: {
        role: "user",
        content: toolResults,
      },
      uuid,
      timestamp,
    }));
    state.lastUuid = uuid;
  }
}

function makeClaudeUser(state: ConvertState, text: string, uuid: string, timestamp: string): ClaudeUserRecord {
  return {
    parentUuid: state.lastUuid,
    isSidechain: false,
    userType: "external",
    cwd: state.cwd,
    sessionId: state.sessionId,
    version: state.version,
    gitBranch: state.gitBranch,
    type: "user",
    message: { role: "user", content: text },
    uuid,
    timestamp,
  };
}

function makeClaudeAssistant(
  state: ConvertState,
  content: Array<Record<string, unknown>>,
  uuid: string,
  timestamp: string,
): ClaudeAssistantRecord {
  return {
    parentUuid: state.lastUuid,
    isSidechain: false,
    userType: "external",
    cwd: state.cwd,
    sessionId: state.sessionId,
    version: state.version,
    gitBranch: state.gitBranch,
    type: "assistant",
    message: {
      model: state.model,
      id: `msg_converted_${uuid.slice(0, 8)}`,
      type: "message",
      role: "assistant",
      content: content as any,
      stop_reason: "end_turn",
      stop_sequence: null,
      usage: { input_tokens: 0, output_tokens: 0 },
    },
    requestId: `req_converted_${uuid.slice(0, 8)}`,
    uuid,
    timestamp,
  };
}

// Map Codex tool names to Claude Code equivalents
function mapToolName(name: string, _direction: string): string {
  const codex2claude: Record<string, string> = {
    exec_command: "Bash",
    read_file: "Read",
    write_file: "Write",
    list_directory: "Glob",
    search_files: "Grep",
    create_file: "Write",
    patch_file: "Edit",
    request_user_input: "AskUserQuestion",
  };
  return codex2claude[name] || name;
}

function safeParse(line: string): CodexRecord | null {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}
