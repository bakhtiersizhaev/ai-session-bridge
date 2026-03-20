# session-converter

Bidirectional session converter between **OpenAI Codex CLI** and **Anthropic Claude Code CLI**.

Convert your AI coding sessions between tools and continue where you left off.

---

[English](#english) | [Русский](#русский)

---

## English

### What is this?

Both Codex CLI and Claude Code CLI store conversation sessions as JSONL files. This tool converts sessions between the two formats, letting you:

- Start a task in Codex, continue it in Claude Code (or vice versa)
- Migrate session history across tools
- Preview and inspect sessions from both tools in one place

### How it works

| Codex CLI (OpenAI) | | Claude Code (Anthropic) |
|---|---|---|
| `response_item` role=user | <-> | `type: "user"` |
| `response_item` role=assistant | <-> | `type: "assistant"` |
| `function_call` + `function_call_output` | <-> | `tool_use` + `tool_result` |
| `session_meta` | -> | session metadata in records |
| `turn_context` | -> | (metadata, lossy) |
| `event_msg` | <-> | `type: "progress"` |
| `compacted` | -> | expanded as user/assistant messages |

### Installation

```bash
# Clone the repository
git clone https://github.com/YOUR_USERNAME/session-converter.git
cd session-converter

# Install dependencies
npm install

# Run directly
npx tsx src/cli.ts --help
```

**Requirements:** Node.js 18+ and `tsx` (included in devDependencies).

### Usage

#### List all sessions

```bash
npx tsx src/cli.ts list              # Both Codex and Claude Code sessions
npx tsx src/cli.ts list codex        # Only Codex sessions
npx tsx src/cli.ts list claude       # Only Claude Code sessions
```

Shows session ID, path, size, and first messages preview.

#### Preview a session

```bash
npx tsx src/cli.ts preview <session-id>
npx tsx src/cli.ts preview 019ced67    # Partial ID works (8+ chars)
```

#### Get session info

```bash
npx tsx src/cli.ts info <session-id>
```

#### Convert sessions

```bash
# Codex -> Claude Code
npx tsx src/cli.ts codex2claude <session-id>

# Claude Code -> Codex
npx tsx src/cli.ts claude2codex <session-id>

# Auto-detect and convert
npx tsx src/cli.ts auto <session-id-or-file>

# Custom output path
npx tsx src/cli.ts auto <session-id> -o ~/my-session.jsonl

# Dry run (see what would happen)
npx tsx src/cli.ts auto <session-id> --dry-run
```

#### JSON mode (for AI agents)

```bash
npx tsx src/cli.ts list --json
npx tsx src/cli.ts auto <session-id> --json
```

All commands support `--json` for machine-readable output.

### Session storage locations

| Tool | Location |
|------|----------|
| Codex CLI | `~/.codex/sessions/YYYY/MM/DD/*.jsonl` |
| Claude Code | `~/.claude/projects/-{PROJECT_PATH}/*.jsonl` |

### Limitations

Some fields don't have direct equivalents and are marked as "lossy":
- `session_meta.base_instructions` — Codex system prompt (not present in Claude Code format)
- `developer` role messages — converted with `[SYSTEM/DEVELOPER]` prefix
- `turn_context.collaboration_mode` — Codex-specific metadata
- `file-history-snapshot` — Claude Code-specific file backup tracking
- `compacted` summaries — expanded from replacement_history, original summary text lost

### Project structure

```
session-converter/
├── src/
│   ├── cli.ts            # CLI entry point with all commands
│   ├── codex2claude.ts   # Codex -> Claude Code conversion
│   ├── claude2codex.ts   # Claude Code -> Codex conversion
│   ├── discover.ts       # Session file discovery and format detection
│   └── types.ts          # TypeScript type definitions for both formats
├── package.json
├── tsconfig.json
├── READMEAI.md           # Instructions for AI agents
├── AGENTS.txt            # AI agent discovery file
├── LICENSE               # MIT
└── README.md             # This file
```

---

## Русский

### Что это?

И Codex CLI, и Claude Code CLI хранят сессии разговоров в формате JSONL. Этот инструмент конвертирует сессии между двумя форматами, позволяя:

- Начать задачу в Codex, продолжить в Claude Code (и наоборот)
- Перенести историю сессий между инструментами
- Просматривать и инспектировать сессии из обоих инструментов в одном месте

### Как работает

Оба CLI хранят сессии как JSONL (JSON Lines). Конвертер читает записи одного формата и маппит их в другой:

- Текстовые сообщения user/assistant — маппятся 1:1
- Tool calls (function_call <-> tool_use) — маппятся 1:1 с переименованием инструментов
- Метаданные (session_meta, turn_context, file-history) — частично, помечаются как lossy

### Установка

```bash
git clone https://github.com/YOUR_USERNAME/session-converter.git
cd session-converter
npm install
npx tsx src/cli.ts --help
```

**Требования:** Node.js 18+ и `tsx`.

### Использование

```bash
# Список всех сессий с превью
npx tsx src/cli.ts list

# Превью содержимого сессии
npx tsx src/cli.ts preview 019ced67

# Конвертация Codex -> Claude Code
npx tsx src/cli.ts codex2claude 019ced67-e597-72d2-9e6d-657e520103b0

# Конвертация Claude Code -> Codex
npx tsx src/cli.ts claude2codex 70f732ba-5279-4674-a7a8-c99cc4771e33

# Авто-определение формата
npx tsx src/cli.ts auto /path/to/session.jsonl

# JSON вывод (для AI агентов)
npx tsx src/cli.ts list --json
```

### Где хранятся сессии

| Инструмент | Расположение |
|------------|-------------|
| Codex CLI | `~/.codex/sessions/YYYY/MM/DD/*.jsonl` |
| Claude Code | `~/.claude/projects/-{ПУТЬ_К_ПРОЕКТУ}/*.jsonl` |

### Ограничения

Некоторые поля не имеют прямых аналогов и помечаются как "lossy":
- `session_meta.base_instructions` — системный промпт Codex
- `developer` роль — конвертируется с префиксом `[SYSTEM/DEVELOPER]`
- `turn_context.collaboration_mode` — специфичные метаданные Codex
- `file-history-snapshot` — специфичное отслеживание файлов Claude Code

---

## License

MIT
