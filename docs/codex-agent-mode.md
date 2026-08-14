# Codex agent mode

Codex uses the same canonical project skills and the same critical enforcement
decisions as Claude Code where Codex exposes a stable hook payload. The
canonical skill bodies remain under `.claude/skills/<name>/SKILL.md`; do not
copy them into a second tree.

## One-time setup in each checkout or worktree

1. Select Node 22 (`.nvmrc`; the repository scripts reject other majors).
2. From any directory inside the checkout, run `pnpm codex:setup`.
3. Run `pnpm codex:verify` to verify the generated bridge.
4. Start Codex at the repository root. Open `/hooks`, inspect the project hooks,
   and trust the exact definitions once.

`codex:setup` generates `.agents/skills` as a directory junction on Windows and
a directory symlink elsewhere. Codex follows linked skill folders while scanning
`.agents/skills`. The bridge is git-ignored, repeatable, and points directly to
`.claude/skills`; it contains no copied skill bodies. On Windows, the junction
does not require Developer Mode or administrator privileges. The setup command
refuses to replace an unrelated real directory.

Repository hooks live in `.codex/hooks.json`. Codex hooks are enabled by
default, but repository hooks run only after the project layer and the exact
hook definitions are trusted. A change to `.codex/hooks.json` changes the trust
hash, so review and trust the hooks again through `/hooks`. Hook commands resolve
the repository root with `git rev-parse --show-toplevel`, so a tool call from a
nested working directory still reaches the repository-local scripts.

## Compatibility boundary

The adapters cover SessionStart, UserPromptSubmit, PreToolUse, PostToolUse, and
Stop without claiming impossible byte-for-byte harness parity:

- `apply_patch`, `spawn_agent`, and shell payloads are normalized to the
  contracts consumed by the existing Claude hooks;
- SessionStart and prompt events register their transcript paths for
  cross-harness parallel-session detection;
- PostToolUse records conservative per-session write evidence; Stop reads the
  stable `last_assistant_message` field and that evidence instead of depending
  on Codex's explicitly unstable JSONL transcript format;
- SessionStart resets write evidence only for an explicit `startup` or `clear`;
  `compact`, `resume`, and an absent source preserve earlier evidence;
- UserPromptSubmit records owner-halt wording from the shared `HALT_RE` as a
  monotonic session signal, so Stop still rejects a self-certified “no
  deviations” report after an interruption;
- malformed or unknown payloads remain fail-open, and read-only tool calls do
  not turn on completion-report enforcement.

Critical worktree-write, dispatch/model, secret-output, merge, handoff-prompt,
and Stop gates are covered for their representative Codex payloads. Two
advisory paths do not have a safe exact mapping:

- arbitrary Codex shell reads cannot be classified as Claude `Read`, `Grep`, or
  `Glob` calls, so the main-tree read advisory remains fail-open/manual for
  those commands;
- Codex UserPromptSubmit exposes no stable token-count field, so
  `context-budget.mjs` remains fail-open when the Claude transcript usage shape
  is absent.

Do not infer safety from either missing advisory. Worktree isolation and manual
context monitoring remain required by the repository instructions.

Generated state under `.claude/codex-write-state/` and
`.claude/hook-session-registry/` is git-ignored and safe to delete between
sessions. `BBM_HOOKS_DISABLE=1` remains the emergency kill switch for the whole
stack.

DesignSync is deliberately excluded. This compatibility layer does not install,
configure, or invoke DesignSync, and it does not change product UI, deployment,
or runtime application behavior.

Official references: [Codex hooks](https://developers.openai.com/codex/hooks)
and [Agent Skills](https://developers.openai.com/codex/skills).
