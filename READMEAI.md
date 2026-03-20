# session-converter — AI Agent Guide

## Purpose

This tool converts AI coding session files between OpenAI Codex CLI and Anthropic Claude Code CLI JSONL formats. Both tools store sessions as JSONL (one JSON object per line), but with different schemas.

## For AI Agents: How to Use

### Installation

```bash
cd /path/to/session-converter
npm install  # or: skip if tsx is available globally
```

### Quick Reference

All commands support `--json` flag for machine-readable output.

```bash
# List all available sessions (returns JSON with session IDs, paths, sizes, previews)
npx tsx src/cli.ts list --json

# Get info about a specific session
npx tsx src/cli.ts info <session-id-or-path> --json

# Preview messages from a session
npx tsx src/cli.ts preview <session-id> --json

# Convert (auto-detect direction)
npx tsx src/cli.ts auto <session-id> --json

# Convert with explicit direction
npx tsx src/cli.ts codex2claude <session-id> --json
npx tsx src/cli.ts claude2codex <session-id> --json

# Dry run (no file written)
npx tsx src/cli.ts auto <session-id> --json --dry-run
```

### JSON Output Schema

#### `list --json`
```json
{
  "codex": [
    {
      "id": "UUID",
      "file": "/absolute/path/to/session.jsonl",
      "date": "YYYY-MM-DD",
      "size": 12345,
      "preview": [
        { "role": "user", "text": "first message", "timestamp": "ISO8601" },
        { "role": "assistant", "text": "response", "timestamp": "ISO8601" }
      ]
    }
  ],
  "claude": [
    {
      "id": "UUID",
      "file": "/absolute/path/to/session.jsonl",
      "project": "/project/path",
      "size": 12345,
      "preview": [...]
    }
  ]
}
```

#### `auto --json` (conversion result)
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
  "lossyFields": ["session_meta.base_instructions", "developer_role_as_user_prefix"],
  "resumeHint": "claude --resume UUID"
}
```

### Session ID Resolution

The tool accepts:
- Full UUID: `019ced67-e597-72d2-9e6d-657e520103b0`
- Partial UUID (8+ chars): `019ced67`
- Full file path: `/home/user/.codex/sessions/2026/03/14/rollout-....jsonl`

### Session File Locations

- **Codex CLI**: `~/.codex/sessions/YYYY/MM/DD/rollout-DATETIME-UUID.jsonl`
- **Claude Code**: `~/.claude/projects/-{PATH_WITH_DASHES}/UUID.jsonl`

### Format Mapping

| Codex (OpenAI Responses API) | Claude Code (Anthropic Messages API) |
|------------------------------|--------------------------------------|
| `{timestamp, type, payload}` wrapper | `{type, sessionId, uuid, timestamp, ...}` wrapper |
| `response_item.payload.type: "message"` | `type: "user"` or `type: "assistant"` |
| `payload.role: "user"`, content: `input_text` | `message.role: "user"`, content: string or `text[]` |
| `payload.role: "assistant"`, content: `output_text` | `message.role: "assistant"`, content: `text[]` |
| `payload.type: "function_call"` | content item `type: "tool_use"` |
| `payload.type: "function_call_output"` | content item `type: "tool_result"` |
| `session_meta` (first record) | metadata embedded in each record |
| `turn_context` | no equivalent (lossy) |
| `event_msg` | `type: "progress"` |
| `compacted` | no equivalent (expanded from replacement_history) |
| N/A | `type: "file-history-snapshot"` (lossy) |

### Tool Name Mapping

| Codex | Claude Code |
|-------|-------------|
| `exec_command` | `Bash` |
| `read_file` | `Read` |
| `write_file` | `Write` |
| `patch_file` | `Edit` |
| `list_directory` | `Glob` |
| `search_files` | `Grep` |
| `request_user_input` | `AskUserQuestion` |

### Error Handling

- Non-zero exit code on errors
- Error messages on stderr
- JSON output includes `success: false` on failure (where applicable)

### Integration Example (from AI agent)

```bash
# Step 1: Find the Codex session
RESULT=$(npx tsx /path/to/session-converter/src/cli.ts list codex --json)
# Parse RESULT to find session ID

# Step 2: Convert it
npx tsx /path/to/session-converter/src/cli.ts codex2claude <session-id> --json
# Parse output for outputFile path

# Step 3: Resume in Claude Code
claude --resume <session-id>
```
