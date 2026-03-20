// ============================================================
// Codex CLI JSONL types (OpenAI Responses API format)
// ============================================================

export interface CodexRecord {
  timestamp: string;
  type: "session_meta" | "response_item" | "event_msg" | "turn_context" | "compacted";
  payload: Record<string, unknown>;
}

export interface CodexSessionMeta extends CodexRecord {
  type: "session_meta";
  payload: {
    id: string;
    timestamp: string;
    cwd: string;
    originator: string;
    cli_version: string;
    source: string;
    model_provider: string;
    base_instructions?: { text: string };
    model?: string;
    [k: string]: unknown;
  };
}

export interface CodexResponseItem extends CodexRecord {
  type: "response_item";
  payload:
    | CodexMessagePayload
    | CodexFunctionCallPayload
    | CodexFunctionCallOutputPayload;
}

export interface CodexMessagePayload {
  type: "message";
  role: "user" | "assistant" | "developer";
  content: Array<{ type: "input_text" | "output_text"; text: string }>;
  phase?: string;
  [k: string]: unknown;
}

export interface CodexFunctionCallPayload {
  type: "function_call";
  name: string;
  arguments: string;
  call_id: string;
  [k: string]: unknown;
}

export interface CodexFunctionCallOutputPayload {
  type: "function_call_output";
  call_id: string;
  output: string | Array<{ type: string; text: string }>;
  [k: string]: unknown;
}

export interface CodexTurnContext extends CodexRecord {
  type: "turn_context";
  payload: {
    turn_id: string;
    cwd: string;
    model: string;
    current_date: string;
    timezone: string;
    [k: string]: unknown;
  };
}

export interface CodexEventMsg extends CodexRecord {
  type: "event_msg";
  payload: {
    type: string;
    turn_id?: string;
    [k: string]: unknown;
  };
}

export interface CodexCompacted extends CodexRecord {
  type: "compacted";
  payload: {
    message: string;
    replacement_history: Array<{
      type: "message";
      role: "user" | "assistant";
      content: Array<{ type: string; text: string }>;
    }>;
  };
}

// ============================================================
// Claude Code JSONL types (Anthropic Messages API format)
// ============================================================

export interface ClaudeRecord {
  type: "user" | "assistant" | "progress" | "file-history-snapshot";
  [k: string]: unknown;
}

export interface ClaudeUserRecord {
  parentUuid: string | null;
  isSidechain: boolean;
  userType: string;
  cwd: string;
  sessionId: string;
  version: string;
  gitBranch?: string;
  type: "user";
  message: {
    role: "user";
    content: string | Array<{ type: "text"; text: string }>;
  };
  uuid: string;
  timestamp: string;
  todos?: unknown[];
  permissionMode?: string;
}

export interface ClaudeAssistantRecord {
  parentUuid: string | null;
  isSidechain: boolean;
  userType: string;
  cwd: string;
  sessionId: string;
  version: string;
  gitBranch?: string;
  type: "assistant";
  message: {
    model: string;
    id: string;
    type: "message";
    role: "assistant";
    content: Array<ClaudeTextContent | ClaudeToolUseContent | ClaudeToolResultContent>;
    stop_reason: string | null;
    stop_sequence: string | null;
    usage: Record<string, unknown>;
  };
  requestId: string;
  uuid: string;
  timestamp: string;
}

export interface ClaudeTextContent {
  type: "text";
  text: string;
}

export interface ClaudeToolUseContent {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ClaudeToolResultContent {
  type: "tool_result";
  tool_use_id: string;
  content: string | Array<{ type: string; text?: string }>;
  is_error?: boolean;
}

export interface ClaudeProgressRecord {
  parentUuid: string | null;
  isSidechain: boolean;
  userType: string;
  cwd: string;
  sessionId: string;
  version: string;
  type: "progress";
  data: Record<string, unknown>;
  toolUseID?: string;
  uuid: string;
  timestamp: string;
}

export interface ClaudeFileHistoryRecord {
  type: "file-history-snapshot";
  messageId: string;
  snapshot: Record<string, unknown>;
  isSnapshotUpdate: boolean;
}

// ============================================================
// Conversion context
// ============================================================

export interface ConversionMeta {
  sourceFormat: "codex" | "claude";
  sourceSessionId: string;
  sourceFile: string;
  targetFormat: "codex" | "claude";
  convertedAt: string;
  lossyFields: string[];
  stats: {
    totalRecords: number;
    convertedRecords: number;
    skippedRecords: number;
    toolCalls: number;
    userMessages: number;
    assistantMessages: number;
  };
}

export interface ConversionResult {
  meta: ConversionMeta;
  outputPath: string;
}
