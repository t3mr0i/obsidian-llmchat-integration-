---
description: "Fix all drift issues — safe auto-fixes first, then AI-assisted updates."
---

1. Run `cai fix` to apply safe deterministic repairs.
2. Check results with `cai check --quiet`.
3. If issues remain, read each affected .cai/ file and fix the drift issues directly.
4. After fixing, run `cai check` again to verify score is 100.
5. Do not modify source code files — only update .cai/ scaffold documentation.
