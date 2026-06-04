# Upstream Sync Guide

`@earendil-works/pi-base` is a **verbatim subset** of `@earendil-works/pi-coding-agent`'s source tree.
This document describes how to keep it in sync when the upstream (coding-agent) changes.

## Principle

**Zero internal modifications.** Every `.ts` file in `pi-base/src/` is an unmodified copy from
`packages/coding-agent/src/`. The only differences are file-level deletions and two stub files
for a deleted subtree.

This guarantees:

- `git diff` between the two source trees shows only intentional deletions
- `git merge` from coding-agent never produces conflicts inside `.ts` files
- Upstream bugfixes flow through automatically

## What Was Removed

| Path | Reason |
|---|---|
| `src/bun/` | Bun binary CLI entry point — pi-specific, not reusable |
| `src/core/export-html/` | Coding session HTML export — tied to tool rendering internals |

Two stub files were **created** (not copied from upstream) to satisfy import references in
kept files:

| Stub | Satisfies imports from |
|---|---|
| `src/core/export-html/index.ts` | `agent-session.ts`, `main.ts` |
| `src/core/export-html/tool-renderer.ts` | `agent-session.ts` |

These stubs export minimal no-op implementations. They are the only files in `src/` that are
not verbatim copies.

## Sync Procedure

### Full sync (recommended)

```bash
# 1. Copy all source files from coding-agent (overwrites pi-base/src/)
rm -rf packages/pi-base/src
cp -r packages/coding-agent/src packages/pi-base/src

# 2. Re-apply the two deletions
rm -rf packages/pi-base/src/bun
rm -rf packages/pi-base/src/core/export-html

# 3. Re-create the two stubs
mkdir -p packages/pi-base/src/core/export-html/vendor

cat > packages/pi-base/src/core/export-html/index.ts << 'EOF'
/** Stub for pi-base */
import type { SessionManager, FileEntry } from "../session-manager.ts";
export type AgentState = { messages: any[]; model: any; systemPrompt: string; tools: any[]; thinkingLevel: string; };
export interface ToolHtmlRenderer { renderTool(): string; }
export function exportSessionToHtml(_sm: SessionManager, _state: AgentState, _opts: any): string { return ""; }
export function exportFromFile(_path: string, _outputPath?: string): Promise<string> { return Promise.resolve(""); }
EOF

cat > packages/pi-base/src/core/export-html/tool-renderer.ts << 'EOF'
/** Stub for pi-base */
export interface ToolHtmlRendererOptions {
  getToolDefinition: (name: string) => any;
  theme: any;
  cwd: string;
}
export function createToolHtmlRenderer(_opts: ToolHtmlRendererOptions): { renderTool: () => string } {
  return { renderTool: () => "" };
}
EOF

# 4. Sync npm dependencies — copy coding-agent's deps verbatim
#    (see packages/coding-agent/package.json → dependencies)

# 5. Build and verify
cd packages/pi-base
npm run build
```

### Partial sync (pick specific upstream commits)

```bash
# List files that changed upstream
cd packages/coding-agent
git log --oneline --name-only HEAD~5..HEAD -- src/

# Copy only the changed files
cd ../../pi-base
for f in $(cd ../coding-agent && git diff --name-only HEAD~5..HEAD -- src/); do
  cp "../coding-agent/$f" "$f"
done

# Re-delete bun/ and export-html/ (they may have been re-created by the copy)
rm -rf src/bun src/core/export-html
mkdir -p src/core/export-html/vendor
# ... re-create stubs as above

npm run build
```

### Verifying sync cleanliness

```bash
# Check that the only differences are the intended deletions
diff -r packages/coding-agent/src packages/pi-base/src \
  --exclude=bun --exclude=export-html \
  | head -20

# Should produce no output if sync is clean
```

## What to Watch For

| Upstream change | Required action |
|---|---|
| New file in `src/` | Auto-included by full copy. Check if pi-specific → add to deletion list |
| File deleted upstream | Auto-reflected — pi-base deletes it on next sync |
| File moved/renamed | Update the copy command accordingly |
| New npm dependency | Copy to pi-base's `package.json` |
| New exports in `src/index.ts` | No action needed — pi-base uses the same index.ts |
| Changes to `config.ts` | Auto-included. Package name resolution is runtime (from `package.json`), not hardcoded |

## Key Files That Must Stay Identical

Every file in `src/` except the two stubs above must remain byte-identical to its
coding-agent counterpart. If you need pi-base-specific behavior, implement it in:

- **New files** added to `src/` (they won't conflict with upstream)
- **`package.json`** (dependencies, name, config)
- **`tsconfig.build.json`** (build settings)
- **`README.md`**, **`SYNC.md`** (documentation)
