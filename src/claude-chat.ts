import { randomUUID } from "crypto";

export interface ClaudeChatConversation {
  uuid?: string;
  name?: string;
  summary?: string;
  created_at?: string;
  updated_at?: string;
  chat_messages?: ClaudeChatMessage[];
}

interface ClaudeChatMessage {
  uuid?: string;
  sender?: "human" | "assistant";
  text?: string;
  created_at?: string;
  content?: Array<Record<string, unknown>>;
  attachments?: Array<Record<string, unknown>>;
  files?: Array<Record<string, unknown>>;
}

export interface ClaudeChatConversion {
  sessionId: string;
  title: string;
  firstUserMessage: string;
  createdAt: string;
  updatedAt: string;
  records: string[];
  hasConversationText: boolean;
  stats: { userMessages: number; assistantMessages: number; toolCalls: number; toolResults: number; skippedThinking: number };
}

export function sanitizeCodexToolName(value: unknown): string {
  const cleaned = clean(value).replace(/[^a-zA-Z0-9_-]+/g, "_");
  return (cleaned || "claude_tool").slice(0, 64);
}

export function convertClaudeChatConversation(
  conversation: ClaudeChatConversation,
  options: { cwd?: string; model?: string; titlePrefix?: string } = {},
): ClaudeChatConversion {
  const rawSessionId = clean(conversation.uuid);
  const sessionId = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(rawSessionId)
    ? rawSessionId
    : randomUUID();
  const now = new Date().toISOString();
  const createdAt = timestamp(conversation.created_at, now);
  const updatedAt = timestamp(conversation.updated_at, createdAt);
  const cwd = options.cwd || process.cwd();
  const model = options.model || "gpt-5.1-codex-max";
  const prefix = options.titlePrefix ?? "[Claude Chat] ";
  const records: Record<string, unknown>[] = [{
    timestamp: createdAt,
    type: "session_meta",
    payload: {
      id: sessionId,
      session_id: sessionId,
      timestamp: createdAt,
      cwd,
      originator: "ai-session-bridge:claude-chat",
      cli_version: "ai-session-bridge",
      source: "cli",
      thread_source: "user",
      model_provider: "openai",
      model,
    },
  }];
  const stats = { userMessages: 0, assistantMessages: 0, toolCalls: 0, toolResults: 0, skippedThinking: 0 };
  let activeTurn: string | null = null;
  let lastAssistant = "";

  const closeTurn = (at: string) => {
    if (!activeTurn) return;
    records.push({ timestamp: at, type: "event_msg", payload: { type: "task_complete", turn_id: activeTurn, last_agent_message: lastAssistant } });
    activeTurn = null;
    lastAssistant = "";
  };

  for (const message of conversation.chat_messages || []) {
    const at = timestamp(message.created_at, createdAt);
    const role = message.sender === "human" ? "user" : "assistant";
    const text = chatMessageText(message);
    if (role === "user" && text) {
      closeTurn(at);
      activeTurn = randomUUID();
      records.push({ timestamp: at, type: "turn_context", payload: { turn_id: activeTurn, cwd, current_date: at.slice(0, 10), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, model } });
      records.push({ timestamp: at, type: "event_msg", payload: { type: "task_started", turn_id: activeTurn } });
      records.push(userEvent(at, text, message.uuid));
    }
    if (text) {
      records.push({ timestamp: at, type: "response_item", payload: { type: "message", role, content: [{ type: role === "user" ? "input_text" : "output_text", text }] } });
      if (role === "user") stats.userMessages++;
      else {
        lastAssistant = text;
        records.push({ timestamp: at, type: "event_msg", payload: { type: "agent_message", message: text, phase: "final_answer", memory_citation: null } });
        stats.assistantMessages++;
      }
    }
    for (const block of message.content || []) {
      if (block.type === "thinking") stats.skippedThinking++;
      else if (block.type === "tool_use") {
        records.push({ timestamp: at, type: "response_item", payload: { type: "function_call", name: sanitizeCodexToolName(block.name), arguments: JSON.stringify(block.input || {}), call_id: block.id || randomUUID() } });
        stats.toolCalls++;
      } else if (block.type === "tool_result") {
        records.push({ timestamp: at, type: "response_item", payload: { type: "function_call_output", call_id: block.tool_use_id || randomUUID(), output: toolResult(block.content) } });
        stats.toolResults++;
      }
    }
  }

  const hasConversationText = (conversation.chat_messages || []).some(rawMessageText);
  if (!stats.userMessages) {
    const placeholder = hasConversationText
      ? "Imported Claude conversation without a user message."
      : "The Claude export does not contain text for this conversation.";
    activeTurn = randomUUID();
    records.push({ timestamp: updatedAt, type: "turn_context", payload: { turn_id: activeTurn, cwd, current_date: updatedAt.slice(0, 10), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, model } });
    records.push({ timestamp: updatedAt, type: "event_msg", payload: { type: "task_started", turn_id: activeTurn } });
    records.push(userEvent(updatedAt, placeholder));
    records.push({ timestamp: updatedAt, type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: placeholder }] } });
    stats.userMessages++;
  }
  closeTurn(updatedAt);

  const anchor = firstHumanText(conversation) || clean(conversation.summary) || `Conversation ${sessionId.slice(0, 8)}`;
  const titleSource = clean(conversation.name) || anchor;
  const oneLine = titleSource.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  const title = prefix + (oneLine.length > 76 ? `${oneLine.slice(0, 73)}...` : oneLine);
  return { sessionId, title, firstUserMessage: anchor, createdAt, updatedAt, records: records.map((record) => JSON.stringify(record)), hasConversationText, stats };
}

function userEvent(at: string, message: string, clientId?: string): Record<string, unknown> {
  return { timestamp: at, type: "event_msg", payload: { type: "user_message", client_id: clientId || randomUUID(), message, images: [], local_images: [], audio: [], local_audio: [], text_elements: [] } };
}

function chatMessageText(message: ClaudeChatMessage): string {
  const content = (message.content || []).filter((block) => block.type === "text").map((block) => clean(block.text)).filter(Boolean).join("\n\n");
  const attachments = (message.attachments || []).map((item) => {
    const name = clean(item.file_name) || "attachment";
    const extracted = clean(item.extracted_content);
    return extracted ? `[Claude attachment: ${name}]\n${extracted}` : `[Claude attachment: ${name}; content missing from export]`;
  });
  const known = new Set((message.attachments || []).map((item) => item.file_name));
  for (const file of message.files || []) {
    if (!known.has(file.file_name)) attachments.push(`[Claude file: ${clean(file.file_name) || clean(file.file_uuid) || "file"}; content missing from export]`);
  }
  return [content || clean(message.text), ...attachments].filter(Boolean).join("\n\n");
}

function rawMessageText(message: ClaudeChatMessage): boolean {
  return Boolean(clean(message.text) || (message.content || []).some((block) => block.type === "text" && clean(block.text)));
}

function firstHumanText(conversation: ClaudeChatConversation): string {
  for (const message of conversation.chat_messages || []) if (message.sender === "human" && chatMessageText(message)) return chatMessageText(message);
  return "";
}

function toolResult(content: unknown): string {
  if (typeof content === "string") return clean(content);
  if (Array.isArray(content)) {
    const texts = content.filter((item) => item && item.type === "text").map((item) => clean(item.text)).filter(Boolean);
    if (texts.length) return texts.join("\n");
  }
  return JSON.stringify(content ?? "") ?? "";
}

function clean(value: unknown): string { return String(value ?? "").replaceAll("\u0000", "").trim(); }
function timestamp(value: unknown, fallback: string): string { const parsed = Date.parse(String(value || "")); return Number.isFinite(parsed) ? new Date(parsed).toISOString() : fallback; }
