#!/usr/bin/env node

// src/watch.ts
import { writeFileSync, readFileSync, existsSync, chmodSync, unlinkSync } from "fs";
import { resolve } from "path";
var HOOK_MARKER = "# cai-drift-check-start";
var HOOK_END_MARKER = "# cai-drift-check-end";
var HOOK_MARKERS = { start: HOOK_MARKER, end: HOOK_END_MARKER, legacy: "# cai-drift-check" };
function buildHookContent(config, autoFix, threshold = 80) {
  const cliPath = resolve(config.scaffoldRoot, "dist", "cli.js");
  const base = existsSync(cliPath) ? `node "${cliPath}"` : "npx @temroi/cai";
  const checkCmd = `${base} check --quiet --incremental`;
  const fixCmd = `${base} fix 2>&1`;
  const sessionCmd = `${base} session 2>&1`;
  const installedAt = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
  const autoFixBlock = autoFix ? `
# Auto-fix: if score below ${threshold}, run safe fixes and refresh session context
SCORE_NUM=$(echo "$SCORE" | grep -oE '[0-9]+/100' | cut -d/ -f1 || true)
if [ -n "$SCORE_NUM" ] && [ "$SCORE_NUM" -lt ${threshold} ]; then
  echo "cai: score $SCORE_NUM/100 \u2014 running auto-fix..."
  ${fixCmd}
  ${sessionCmd}
fi` : "";
  return `#!/bin/sh
${HOOK_MARKER}
# Installed by cai watch on ${installedAt}
# What this does: runs a drift check after every commit to keep scaffold in sync.
# If nothing is out of sync, no output is shown.
# To remove: run 'cai watch --uninstall'
# To bypass once: git commit --no-verify
# To disable all cai hooks: set CAI_HOOKS=0 in your environment
[ "\${CAI_HOOKS:-1}" = "0" ] && exit 0
SCORE=$(${checkCmd} 2>&1) || true
case "$SCORE" in
  *"100/100"*) ;;
  *) echo "$SCORE" ;;
esac
${autoFixBlock}
${HOOK_END_MARKER}
`;
}
async function manageHook(config, opts) {
  const hookPath = resolve(config.projectRoot, ".git", "hooks", "post-commit");
  if (opts.uninstall) {
    uninstallHook(hookPath);
    return;
  }
  installHook(hookPath, config, opts.autoFix ?? false, opts.threshold);
}
function installHook(hookPath, config, autoFix, threshold) {
  const hookContent = buildHookContent(config, autoFix, threshold);
  if (existsSync(hookPath)) {
    const existing = readFileSync(hookPath, "utf-8");
    if (existing.includes(HOOK_MARKER)) {
      console.log("\u26A0 Hook already installed \u2014 nothing changed.");
      console.log("  \u2139 To reinstall, run: cai watch --uninstall && cai watch");
      return;
    }
    const updated = existing.trimEnd() + "\n\n" + hookContent;
    writeFileSync(hookPath, updated);
    chmodSync(hookPath, 493);
    console.log("\u2714 Added drift check to your existing post-commit hook.");
    console.log("  \u2139 After each commit, cai will check whether your scaffold is still accurate.");
    return;
  }
  writeFileSync(hookPath, hookContent);
  chmodSync(hookPath, 493);
  console.log("\u2714 post-commit hook installed.");
  console.log("  \u2139 After each commit, cai will run a drift check automatically.");
  console.log("  \u2139 Nothing is shown when everything is in sync \u2014 output only appears when there is drift.");
  if (autoFix) {
    console.log(`  \u2139 Auto-fix is on \u2014 if the score drops below ${threshold ?? 80}/100, cai fix will run and refresh your session context.`);
  }
  console.log("  \u2139 To bypass a single commit: git commit --no-verify");
  console.log("  \u2139 To disable all cai hooks:  CAI_HOOKS=0 git commit");
  console.log("  \u2139 To remove the hook:        cai watch --uninstall");
}
function uninstallHook(hookPath) {
  if (!existsSync(hookPath)) {
    console.log("\u26A0 No post-commit hook found \u2014 nothing to remove.");
    return;
  }
  const content = readFileSync(hookPath, "utf-8");
  if (!content.includes(HOOK_MARKER) && !content.includes(HOOK_MARKERS.legacy)) {
    console.log("\u26A0 A post-commit hook exists but was not installed by cai \u2014 not modified.");
    console.log("  \u2139 To remove it manually, delete or edit: .git/hooks/post-commit");
    return;
  }
  const lines = content.split("\n");
  const filtered = [];
  let inCaiBlock = false;
  for (const line of lines) {
    if (line.includes(HOOK_MARKER)) {
      inCaiBlock = true;
      continue;
    }
    if (inCaiBlock && line.includes(HOOK_END_MARKER)) {
      inCaiBlock = false;
      continue;
    }
    if (!inCaiBlock) {
      filtered.push(line);
    }
  }
  const remaining = filtered.join("\n").trim();
  if (remaining === "#!/bin/sh" || remaining === "") {
    unlinkSync(hookPath);
    console.log("\u2714 post-commit hook removed.");
  } else {
    writeFileSync(hookPath, remaining + "\n");
    chmodSync(hookPath, 493);
    console.log("\u2714 Removed cai section from post-commit hook. Your other hook scripts are untouched.");
  }
}

export {
  HOOK_MARKERS,
  manageHook
};
//# sourceMappingURL=chunk-I42G66PB.js.map