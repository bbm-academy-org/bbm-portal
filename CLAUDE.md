# bbm-portal

## Plane (project tracker) — workspace targeting

The `plane-pp-cli` / `plane-pp-mcp` setup has **no default workspace** on purpose:
`bbm` and `doctor-school` are used 50/50, so there is no "primary". A call that
does not name a workspace falls to a sentinel slug and **fails loudly** (404/403)
rather than silently hitting the wrong one. Do **not** set `PLANE_SLUG` or
`default_workspace` to "fix" such an error — name the workspace instead.

**Always target the workspace explicitly:**
- CLI: `plane-pp-cli <cmd> --workspace <slug> …`
- MCP: pass `workspace: "<slug>"` to `plane_execute`.

**Which slug:** this repo's work lives in the **`bbm`** workspace — its issues are
prefixed `BBMP-*` (e.g. `BBMP-26`, project "BBM Platform"). Use `--workspace bbm`
unless a task explicitly references a `doctor-school` issue (prefixes `DSP-*` /
`DSC-*` / Energy), in which case use `--workspace doctor-school`.

If unsure which workspace an identifier belongs to, run
`plane-pp-cli workspaces list --agent` (both are enrolled) and pick by prefix —
never guess by relying on an implicit default.
