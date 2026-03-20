# ai-session-bridge — AI Agent Integration Guide

## What this tool does

Converts AI coding session JSONL files between OpenAI Codex CLI and Anthropic Claude Code CLI formats. Both CLI tools store sessions as JSONL (one JSON object per line) but with different schemas. This tool maps between them bidirectionally.

## How to use (for AI agents)

All commands support `--json` for machine-readable output.

```bash
# List all available sessions
npx tsx src/cli.ts list --json

# Get info about a specific session
npx tsx src/cli.ts info <session-id-or-path> --json

# Preview messages
npx tsx src/cli.ts preview <session-id> --json

# Convert (auto-detect direction)
npx tsx src/cli.ts auto <session-id> --json

# Explicit direction
npx tsx src/cli.ts codex2claude <session-id> --json
npx tsx src/cli.ts claude2codex <session-id> --json

# Dry run
npx tsx src/cli.ts auto <session-id> --json --dry-run
```

## JSON output schemas

### `list --json`
```json
{
  "codex": [{
    "id": "UUID",
    "file": "/absolute/path.jsonl",
    "date": "YYYY-MM-DD",
    "size": 12345,
    "converted": false,
    "preview": [{"role": "user", "text": "...", "timestamp": "ISO8601"}]
  }],
  "claude": [{
    "id": "UUID",
    "file": "/absolute/path.jsonl",
    "project": "/project/path",
    "size": 12345,
    "converted": false,
    "preview": [...]
  }]
}
```

### `auto --json` (conversion result)
```json
{
  "success": true,
  "direction": "codex2claude",
  "sourceFile": "/path/to/source.jsonl",
  "outputFile": "/path/to/output.jsonl",
  "totalRecords": 4487,
  "convertedRecords": 3845,
  "skippedRecords": 37,
  "toolCalls": 1009,
  "userMessages": 221,
  "assistantMessages": 137,
  "lossyFields": ["session_meta.base_instructions"],
  "resumeHint": "claude --resume UUID"
}
```

## Session ID resolution

Accepts:
- Full UUID: `019ced67-e597-72d2-9e6d-657e520103b0`
- Partial UUID (8+ chars): `019ced67`
- File path: `/home/user/.codex/sessions/2026/03/14/rollout-....jsonl`

Originals are prioritized over converted sessions when resolving.

## Session file locations

- **Codex CLI originals**: `~/.codex/sessions/YYYY/MM/DD/rollout-DATETIME-UUID.jsonl`
- **Claude Code originals**: `~/.claude/projects/-{PATH}/UUID.jsonl`
- **Bridged Codex->Claude**: `~/.claude/projects/-converted-from-codex/UUID.jsonl`
- **Bridged Claude->Codex**: `~/.codex/sessions/YYYY/MM/DD/converted-DATETIME-UUID.jsonl`

## Format mapping reference

| Codex (OpenAI Responses API) | Claude Code (Anthropic Messages API) |
|------------------------------|--------------------------------------|
| `{timestamp, type, payload}` wrapper | `{type, sessionId, uuid, timestamp, ...}` wrapper |
| `response_item` role=user, content: `input_text` | `type: "user"`, content: string or `text[]` |
| `response_item` role=assistant, content: `output_text` | `type: "assistant"`, content: `text[]` |
| `function_call` (name, arguments, call_id) | `tool_use` (id, name, input) |
| `function_call_output` (call_id, output) | `tool_result` (tool_use_id, content) |
| `session_meta` | metadata embedded in each record |
| `turn_context` | no equivalent (lossy) |
| `event_msg` | `type: "progress"` |
| `compacted` | expanded from replacement_history |

## Tool name mapping

| Codex | Claude Code |
|-------|-------------|
| `exec_command` | `Bash` |
| `read_file` | `Read` |
| `write_file` | `Write` |
| `patch_file` | `Edit` |
| `list_directory` | `Glob` |
| `search_files` | `Grep` |
| `request_user_input` | `AskUserQuestion` |

## Integration example

```bash
# 1. Find sessions
SESSIONS=$(npx tsx /path/to/ai-session-bridge/src/cli.ts list codex --json)

# 2. Convert
RESULT=$(npx tsx /path/to/ai-session-bridge/src/cli.ts codex2claude $SESSION_ID --json)

# 3. Resume
claude --resume $SESSION_ID
```

## Requirements

Node.js 18+, tsx
