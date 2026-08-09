<p align="center"><img src="assets/logo.svg" width="96" alt="ai-session-bridge logo — two rail lines joined by a crossover switch"></p>

# ai-session-bridge <sub>(aka **claude2codex** / **codex2claude**)</sub>

[![License: MIT](https://img.shields.io/badge/License-MIT-1a7f37.svg)](LICENSE)
[![Node >= 18](https://img.shields.io/badge/node-%3E%3D18-3FA69B.svg)](package.json)
[![Website](https://img.shields.io/badge/website-github%20pages-D97757.svg)](https://bakhtiersizhaev.github.io/ai-session-bridge/)

> **v0.3** — moves Claude Code sessions in both directions, imports Claude Chat data exports, and registers the resulting sessions for the Codex app UI.

Move your context between **OpenAI Codex CLI / Codex app**, **Anthropic Claude Code**, and exported conversations from the **Claude web or desktop app**.

Start a task in one tool, continue in the other. Both store sessions as JSONL — this tool converts between their formats bidirectionally. Searching for a *claude codex bridge*, *claude2codex converter*, or a way to *transfer a Claude Code session to Codex* (or back)? This is it.

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

# Bridge Codex session -> Claude Code (last 5 user turns)
npx tsx src/cli.ts codex2claude 019ced67-e597-72d2-9e6d-657e520103b0 --tail 5

# Bridge Claude Code session -> Codex
npx tsx src/cli.ts claude2codex 70f732ba-5279-4674-a7a8-c99cc4771e33

# Import every conversation from a Claude Chat data export
npx tsx src/cli.ts import-claude-chat ~/Downloads/claude-export

# Inspect an archive without writing anything
npx tsx src/cli.ts import-claude-chat ~/Downloads/claude-export --dry-run --json

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
- **Tail trimming**: `--tail N` keeps only the last N user turns — essential for large sessions that overflow context
- **History registration**: Automatically registers converted sessions in Claude Code's `history.jsonl`
- **Modern Codex registration**: Registers sessions in both `session_index.jsonl` and `state_5.sqlite` (Node.js 22.5+), so they appear in the app sidebar and remain writable after resume
- **Claude Chat archives**: Imports every conversation from the official Claude `conversations.json` data export as a separate Codex session
- **Visible app history**: Emits `user_message` and `agent_message` UI events, so imported text is rendered in Codex instead of being model-only context
- **Responses API-safe tools**: Normalizes imported tool names to `^[a-zA-Z0-9_-]+$` and prevents invalid `input[].name` errors
- **Correct project placement**: Converted sessions go into the right `~/.claude/projects/` subdirectory
- **Converted session tracking**: Bridged sessions are marked `[bridged]` in list output
- **AI agent friendly**: `--json` flag on every command for machine-readable output

### Tool name mapping

| Codex CLI | Claude Code |
|-----------|-------------|
| `shell_command` / `exec_command` | `Bash` |
| `read_file` | `Read` |
| `write_file` | `Write` |
| `patch_file` | `Edit` |
| `list_directory` | `Glob` |
| `search_files` | `Grep` |
| `update_plan` | `TodoWrite` |
| `request_user_input` | `AskUserQuestion` |

### Verified end-to-end

Both directions were tested with a "secret codeword" round-trip on real CLIs (Codex CLI 0.126, Claude Code 2.1):

1. Tell tool A a codeword → bridge the session → `resume` in tool B → ask for the codeword → tool B answers correctly.
2. Send a second message after resume → new turns append to the bridged session file (Codex side requires the session-index registration this tool performs automatically).

### Session storage paths

| Tool | Path |
|------|------|
| Codex CLI | `~/.codex/sessions/YYYY/MM/DD/*.jsonl` |
| Claude Code | `~/.claude/projects/-{PROJECT_PATH}/*.jsonl` |
| Bridged (Codex->Claude) | `~/.claude/projects/{project dir of the source cwd}/*.jsonl` |
| Bridged (Claude->Codex) | `~/.codex/sessions/YYYY/MM/DD/converted-*.jsonl` |
| Imported Claude Chat archive | `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl` |

### Importing a Claude Chat data export

Point `import-claude-chat` at either the extracted export directory or its
`conversations.json` file. Each Claude conversation becomes a separate Codex
session with a `[Claude Chat]` title. Text, available attachment extracts, tool
calls, and tool results are preserved; hidden thinking blocks are skipped.

Some Claude exports contain conversation metadata but empty message bodies.
The dry-run report shows `withText` and `withoutText` counts, and textless
conversations receive an explicit placeholder instead of pretending that their
content was recovered.

### Codex app and Claude app

- **Codex app**: converted and imported sessions use current Codex rollout
  records and UI events. When the local `state_5.sqlite` database, Node API,
  schema, and reusable thread defaults are available, the bridge registers the
  thread there so it appears in the app sidebar; `session_index.jsonl` remains
  the fallback for other environments.
- **Claude web / desktop app**: export your data from Claude, then point
  `import-claude-chat` at the extracted `conversations.json`. The bridge does
  not sign in to Claude or claim live cloud sync; it transfers only what the
  official export contains.
- **Claude Code**: local coding sessions remain fully bidirectional through
  `claude2codex` and `codex2claude`.

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

# Codex -> Claude Code (последние 5 тернов)
npx tsx src/cli.ts codex2claude 019ced67-e597-72d2-9e6d-657e520103b0 --tail 5

# Claude Code -> Codex
npx tsx src/cli.ts claude2codex 70f732ba-5279-4674-a7a8-c99cc4771e33

# Импорт всех разговоров из экспорта Claude Chat
npx tsx src/cli.ts import-claude-chat ~/Downloads/claude-export

# Предварительная проверка без записи
npx tsx src/cli.ts import-claude-chat ~/Downloads/claude-export --dry-run --json

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
- История отображается в интерфейсе Codex благодаря событиям `user_message` / `agent_message`
- Сессии регистрируются в современном `state_5.sqlite` и появляются в боковой панели
- Имена инструментов очищаются до формата Responses API, поэтому импорт не вызывает ошибку `input[].name`

### Экспорт Claude Chat

Команда `import-claude-chat` принимает папку распакованного архива или файл
`conversations.json` и создаёт отдельную сессию Codex для каждого разговора.
Если Claude оставил в экспорте только метаданные без текста, это явно отражается
в отчёте `withText` / `withoutText`; отсутствующий текст не подменяется выдуманным.

### Codex app и Claude app

- **Codex app**: импортированные и конвертированные сессии записываются в
  актуальном формате rollout и содержат UI-события. Когда доступны локальная
  `state_5.sqlite`, Node API, подходящая схема и базовые данные тредов, сессия
  регистрируется в боковой панели приложения; в остальных окружениях остаётся
  fallback через `session_index.jsonl`.
- **Claude web / desktop app**: выгрузите данные из Claude и передайте
  распакованный `conversations.json` команде `import-claude-chat`. Мост не
  авторизуется в Claude и не обещает live cloud sync — переносится только то,
  что попало в официальный экспорт.
- **Claude Code**: локальные coding-сессии по-прежнему переносятся в обе
  стороны командами `claude2codex` и `codex2claude`.

---

## License

MIT
