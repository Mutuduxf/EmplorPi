# @earendil-works/agent-tauri

Tauri desktop app scaffold for `@earendil-works/agent-base`.

One command to create a portable desktop LLM agent — you just provide tools and skills.

## Usage

```bash
# Scaffold a new agent project
npx @earendil-works/agent-tauri scaffold ./my-agent

cd my-agent
bun install

# Add your domain tools
#   src-agent/tools/domain-tools.ts

# Add your domain skills
#   skills/domain-knowledge.md

# Build (produces portable .exe/.app/.AppImage)
bun run build
```

## Architecture

```
my-agent/
├── src-agent/
│   ├── index.ts               ← RPC sidecar (fixed)
│   └── tools/
│       └── domain-tools.ts    ← ← YOU WRITE THIS
├── skills/
│   └── domain-knowledge.md    ← ← YOU WRITE THIS
├── src/                       ← Web chat UI (React, fixed)
├── src-tauri/                 ← Tauri Rust backend (fixed)
└── package.json
```

The build produces a standalone executable with an embedded Bun-compiled
sidecar process. Everything is portable — data directory lives next to
the executable.

## Output

```
dist/My Agent/
├── My Agent.exe       ← Tauri shell
├── agent-sidecar.exe  ← Bun-compiled agent (zero deps)
└── data/              ← Created on first launch
    ├── sessions/
    ├── settings.json
    └── auth.json
```

## Prerequisites

- [Bun](https://bun.sh) 1.2+
- [Rust](https://rustup.rs) nightly
- [Tauri CLI](https://v2.tauri.app/start/cli/) 2.x
