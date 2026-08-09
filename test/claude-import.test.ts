import assert from "node:assert/strict";
import test from "node:test";
import { convertClaudeToCodex } from "../src/claude2codex.js";
import { convertClaudeChatConversation, sanitizeCodexToolName } from "../src/claude-chat.js";

test("Claude Code conversion emits Codex UI messages and valid turn boundaries", () => {
  const sessionId = "11111111-1111-4111-8111-111111111111";
  const lines = [
    JSON.stringify({ type: "user", sessionId, cwd: "/tmp/project", uuid: "u1", timestamp: "2026-01-01T00:00:00Z", message: { role: "user", content: "hello" } }),
    JSON.stringify({ type: "assistant", sessionId, cwd: "/tmp/project", timestamp: "2026-01-01T00:00:01Z", message: { model: "claude", content: [{ type: "text", text: "hi" }, { type: "tool_use", id: "call1", name: "visualize:read_me", input: {} }] } }),
    JSON.stringify({ type: "user", sessionId, cwd: "/tmp/project", uuid: "u2", timestamp: "2026-01-01T00:00:02Z", message: { role: "user", content: "next" } }),
  ];
  const result = convertClaudeToCodex(lines);
  const records = result.records.map((line) => JSON.parse(line));
  const events = records.filter((record) => record.type === "event_msg").map((record) => record.payload);
  assert.equal(events.filter((event) => event.type === "user_message").length, 2);
  assert.equal(events.filter((event) => event.type === "agent_message").length, 1);
  assert.equal(events.filter((event) => event.type === "task_complete").length, 2);
  assert.equal(events.some((event) => event.type === "task_completed"), false);
  const call = records.find((record) => record.payload?.type === "function_call");
  assert.equal(call.payload.name, "visualize_read_me");
  assert.match(call.payload.name, /^[a-zA-Z0-9_-]+$/);
});

test("Claude Chat export conversion is visible in the Codex UI", () => {
  const result = convertClaudeChatConversation({
    uuid: "22222222-2222-4222-8222-222222222222",
    name: "Example chat",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:02Z",
    chat_messages: [
      { uuid: "m1", sender: "human", created_at: "2026-01-01T00:00:00Z", text: "Question", content: [{ type: "text", text: "Question" }] },
      { uuid: "m2", sender: "assistant", created_at: "2026-01-01T00:00:01Z", text: "Answer", content: [{ type: "text", text: "Answer" }, { type: "tool_use", id: "t1", name: "mcp:tool.name", input: {} }] },
    ],
  });
  const records = result.records.map((line) => JSON.parse(line));
  assert.equal(records.some((record) => record.payload?.type === "user_message" && record.payload.message === "Question"), true);
  assert.equal(records.some((record) => record.payload?.type === "agent_message" && record.payload.message === "Answer"), true);
  assert.equal(records.some((record) => record.payload?.type === "task_complete"), true);
  const call = records.find((record) => record.payload?.type === "function_call");
  assert.equal(call.payload.name, "mcp_tool_name");
});

test("textless Claude export conversations are reported honestly", () => {
  const result = convertClaudeChatConversation({ uuid: "33333333-3333-4333-8333-333333333333", chat_messages: [] });
  assert.equal(result.hasConversationText, false);
  assert.equal(result.stats.userMessages, 1);
  assert.equal(result.records.some((line) => line.includes("does not contain text")), true);
});

test("Codex tool names satisfy the Responses API pattern and length", () => {
  assert.equal(sanitizeCodexToolName("visualize:read_me"), "visualize_read_me");
  assert.match(sanitizeCodexToolName("a.b:c/d"), /^[a-zA-Z0-9_-]+$/);
  assert.equal(sanitizeCodexToolName("x".repeat(100)).length, 64);
});
