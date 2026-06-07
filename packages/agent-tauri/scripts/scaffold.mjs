#!/usr/bin/env node

/**
 * Scaffold a new Tauri-based desktop agent.
 *
 * Usage:
 *   node scripts/scaffold.mjs ./my-agent
 *   npx @earendil-works/agent-tauri scaffold ./my-agent
 */

import { cp, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const templateDir = resolve(__dirname, "../template");

async function scaffold(targetDir) {
  const dest = resolve(process.cwd(), targetDir);
  console.log(`Scaffolding agent at: ${dest}`);

  // Copy template
  await cp(templateDir, dest, { recursive: true, force: true });

  // Update package.json name
  const pkgPath = join(dest, "package.json");
  const pkg = JSON.parse(await readFile(pkgPath, "utf-8"));
  pkg.name = `@me/${targetDir.replace(/^\.\//, "").replace(/\\//g, "-")}`;
  await writeFile(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);

  console.log("\nDone! Next steps:");
  console.log(`  cd ${targetDir}`);
  console.log("  bun install");
  console.log("  # Add your tools in src-agent/tools/domain-tools.ts");
  console.log("  # Add your skills in skills/");
  console.log("  bun run build");
}

const target = process.argv[2];
if (!target) {
  console.error("Usage: node scripts/scaffold.mjs <target-directory>");
  process.exit(1);
}

scaffold(target).catch((err) => {
  console.error("Scaffold failed:", err);
  process.exit(1);
});
