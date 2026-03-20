# ai-session-bridge

Bridge your AI coding sessions between **OpenAI Codex CLI** and **Anthropic Claude Code CLI**.

Start a task in one tool, continue in the other. Both store sessions as JSONL — this tool converts between their formats bidirectionally.

---

[English](#english) | [Русский](#русский)

---

## English

### The problem

You're deep into a coding session with Codex CLI when you realize Claude Code would handle the next part better. Or vice versa. But your conversation history, tool call results, and context are locked in one tool's proprietary JSONL format.

### The solution

`ai-session-bridge` reads session files from either tool, maps messages and tool calls 1:1, and writes a valid session file for the other tool. Then you resume where you left off.

### How it works

```
Codex CLI (.codex/sessions/)          Claude Code (.claude/projects/)
┌──────────────────────┐              ┌──────────────────────┐
│ response_item (user) │  ──bridge──> │ type: "user"         │
│ response_item (asst) │  ──bridge──> │ type: "assistant"    │
│ function_call        │  ──bridge──> │ tool_use             │
│ function_call_output │  ──bridge──> │ tool_result          │
│ session_meta         │  ──bridge──> │ (embedded metadata)  │
│ event_msg            │  <──bridge── │ type: "progress"     │
└──────────────────────┘              └──────────────────────┘
```

### Quick start

```bash
git clone https://github.com/bakhtiersizhaev/ai-session-bridge.git
cd ai-session-bridge
npm install
```

### Usage

```bash
# See all your sessions from both tools
npx tsx src/cli.ts list

# Preview what's in a session before bridging
npx tsx src/cli.ts preview 019ced67

# Bridge Codex session -> Claude Code
npx tsx src/cli.ts codex2claude 019ced67-e597-72d2-9e6d-657e520103b0

# Bridge Claude Code session -> Codex
npx tsx src/cli.ts claude2codex 70f732ba-5279-4674-a7a8-c99cc4771e33

# Auto-detect format and bridge
npx tsx src/cli.ts auto /path/to/session.jsonl

# Dry run — see stats without writing
npx tsx src/cli.ts auto 019ced67 --dry-run

# JSON output for AI agents
npx tsx src/cli.ts list --json
```

### Features

- **Bidirectional**: Codex CLI <-> Claude Code, both directions
- **Auto-detect**: Reads the JSONL and figures out which format it is
- **Session discovery**: Finds sessions in `~/.codex/sessions/` and `~/.claude/projects/` automatically
- **Partial ID**: Type 8+ characters of a session UUID instead of the full thing
- **Message preview**: See the first messages before converting
- **Tool name mapping**: `exec_command` <-> `Bash`, `read_file` <-> `Read`, etc.
- **Converted session tracking**: Bridged sessions are marked `[bridged]` in list output
- **AI agent friendly**: `--json` flag on every command for machine-readable output

### Tool name mapping

| Codex CLI | Claude Code |
|-----------|-------------|
| `exec_command` | `Bash` |
| `read_file` | `Read` |
| `write_file` | `Write` |
| `patch_file` | `Edit` |
| `list_directory` | `Glob` |
| `search_files` | `Grep` |
| `request_user_input` | `AskUserQuestion` |

### Session storage paths

| Tool | Path |
|------|------|
| Codex CLI | `~/.codex/sessions/YYYY/MM/DD/*.jsonl` |
| Claude Code | `~/.claude/projects/-{PROJECT_PATH}/*.jsonl` |
| Bridged (Codex->Claude) | `~/.claude/projects/-converted-from-codex/*.jsonl` |
| Bridged (Claude->Codex) | `~/.codex/sessions/YYYY/MM/DD/converted-*.jsonl` |

### What's preserved / what's lost

| Field | Status |
|-------|--------|
| User messages | 1:1 |
| Assistant messages | 1:1 |
| Tool calls + results | 1:1 (with name mapping) |
| Progress events | mapped |
| `developer` role (Codex) | converted with `[SYSTEM/DEVELOPER]` prefix |
| `session_meta` (Codex) | embedded in session metadata |
| `turn_context` (Codex) | lossy — no Claude Code equivalent |
| `file-history-snapshot` (Claude) | lossy — no Codex equivalent |
| `compacted` summaries (Codex) | expanded from `replacement_history` |

### Requirements

- Node.js 18+
- `tsx` (installed as devDependency)

---

## Русский

### Проблема

Вы в разгаре сессии в Codex CLI и понимаете, что Claude Code лучше справится со следующей частью задачи. Или наоборот. Но вся история диалога, результаты вызовов инструментов и контекст заперты в проприетарном JSONL-формате одного инструмента.

### Решение

`ai-session-bridge` читает файл сессии любого из инструментов, маппит сообщения и tool calls 1:1, и записывает валидный файл сессии для другого. Дальше вы продолжаете с того места, где остановились.

### Быстрый старт

```bash
git clone https://github.com/bakhtiersizhaev/ai-session-bridge.git
cd ai-session-bridge
npm install
```

### Использование

```bash
# Все сессии из обоих инструментов
npx tsx src/cli.ts list

# Превью сессии перед конвертацией
npx tsx src/cli.ts preview 019ced67

# Codex -> Claude Code
npx tsx src/cli.ts codex2claude 019ced67-e597-72d2-9e6d-657e520103b0

# Claude Code -> Codex
npx tsx src/cli.ts claude2codex 70f732ba-5279-4674-a7a8-c99cc4771e33

# Авто-определение формата
npx tsx src/cli.ts auto /path/to/session.jsonl

# Пробный прогон (без записи файла)
npx tsx src/cli.ts auto 019ced67 --dry-run
```

### Что сохраняется при конвертации

- Текстовые сообщения user/assistant — 1:1
- Tool calls и результаты — 1:1 с переименованием инструментов
- Progress events — маппятся
- Метаданные (session_meta, turn_context, file-history) — частично, помечаются как lossy

---

## License

MIT
