#!/usr/bin/env node

// src/pattern/auto-suggest.ts
function buildSuggestionDraft(cluster, today) {
  const title = cluster.taskType.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  const filesList = cluster.commonFiles.length > 0 ? cluster.commonFiles.slice(0, 10).map((f) => `- \`${f}\``).join("\n") : "- _(no recurring files \u2014 task touches different paths each time)_";
  const recentCommits = cluster.commits.slice(0, 5).map((c) => `- ${c.hash} \u2014 ${c.subject}`).join("\n");
  return `---
name: ${cluster.taskType}
description: Recurring task \u2014 auto-suggested from ${cluster.commits.length} recent commits
triggers:
  - "${cluster.taskType.replace(/-/g, " ")}"
last_updated: ${today}
---

# ${title}

> **AUTO-SUGGESTED** \u2014 observed ${cluster.commits.length}\xD7 in the last 30 days.
> Review and refine before relying on this pattern.

## Why this exists

You did this kind of task ${cluster.commits.length} times recently. CAI detected the
recurrence from git history and drafted this pattern so the next time around
the AI has a starting point instead of a blank slate.

## Files typically touched

${filesList}

## Recent examples

${recentCommits}

## Steps

[TODO: Turn the recent examples into numbered steps. Look at the diffs of the
commits above to see what the workflow actually is.]

## Gotchas

[TODO: From experience \u2014 what went wrong in those past commits? Add the
corrections you had to make.]

## Verify

- [ ] [TODO: What to check after this kind of task]

## After This Task

- [ ] Update \`.cai/ROUTER.md\` if project state changed
- [ ] Update relevant \`.cai/context/\` files
`;
}
export {
  buildSuggestionDraft
};
//# sourceMappingURL=auto-suggest-XNB5JANJ.js.map