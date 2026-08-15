---
name: spec-issue-graph
description: Turn an accepted spec or ADR into a connected issue graph rather than a flat pile — parent, native sub-issues, blocked_by edges from the start, exactly one takeable issue at the end, and issue numbers written back into the spec. Use after a spec is accepted and needs to become tracked work. Project-local; this repo only.
---

# spec-issue-graph — issue graph from a spec

This adapts ds-platform's `open-ears-issues` skill (inventory #127) to this
project's task system: without EARS formalism, but with the same mechanism — a
**native graph instead of prose**. Canon:
[`.claude/skills/task-canon/SKILL.md`](../task-canon/SKILL.md) §3.

The symptom this skill exists to prevent: a spec lands as N flat issues, all of
them «takeable», with relations described only in body prose. The board then
lies (everything is ready), triage lies (there are no blockers), and work order
exists only in the head of whoever opened the issues.

## Precondition — do not start without it

- The owner has **accepted the spec/ADR** and agreed on the issue set. This skill
  opens issues; it does not invent scope.
- The backlog gains **at most one new takeable issue** at the end. More means the
  spec became a pile rather than a graph: edges are missing.
- Cross-repo children (`bbm-public-website`) **are opened** and linked because
  both repos share an organization, but they are **not implemented here** — see
  the boundary in `CLAUDE.md`.

## Step 1 — make sure the taxonomy exists

```bash
pnpm taxonomy:bootstrap          # dry run: what is missing
pnpm taxonomy:bootstrap --apply  # create channel:* labels and fallback milestone
```

Confirm the required milestone exists. A milestone is a long-lived theme, not a
spec; one spec may belong to an existing theme, and that is normal.

## Step 2 — the parent

```bash
pnpm issue:create --title "<set theme>" --body-file <file> \
  --type Task --label epic --channel spec \
  --source "<spec/ADR that warrants this set>" --milestone "<theme>"
```

Choose the parent Type from its deliverable class; the `epic` label carries the
umbrella role. An epic's child set replaces `Acceptance criteria` (canon §1).

## Step 3 — children, one per deliverable

Create every child through the same wrapper, with `--channel spec`, a Type that
matches the work (`Feature` / `Bug` / `Task`), and the same milestone. The body
follows canon §1's skeleton; `Spec reference` names the spec **and a specific
section**, not merely the whole file.

Slicing rule: one child = one verifiable deliverable. If its acceptance criteria
cannot be written without «and also», split it into two children.

## Step 4 — build the native graph (the most frequently skipped step)

The endpoints accept a **numeric DB id**, not an issue number:

```bash
OWNER_REPO=bbm-academy-org/bbm-portal
id() { gh api repos/$OWNER_REPO/issues/$1 --jq .id; }

# child C becomes a sub-issue of parent P
gh api --method POST repos/$OWNER_REPO/issues/<P>/sub_issues -F sub_issue_id=$(id <C>)

# issue B is blocked by issue A
gh api --method POST repos/$OWNER_REPO/issues/<B>/dependencies/blocked_by -F issue_id=$(id <A>)
```

GitHub derives the reverse «blocks» edge; do not add it again in the opposite
direction.

`blocked_by` means **technical dependency only**: work is physically impossible
earlier. Priority («we want this first») is represented by board order, not an
edge. A parent, «related to», and «successor» are never blockers.

## Step 5 — rationale on every edge

Add a line to the **blocked** issue's `Dependencies` section:

```markdown
**Blocked by:** #131 — the platform DB contract is defined there; this schema has no target before it
```

`pnpm backlog:triage` marks an edge without rationale as a provenance-orphan.
That is grounds to challenge the edge, not a formatting complaint.

## Step 6 — verify «exactly one takeable issue»

```bash
pnpm backlog:triage
```

The Takeable section must gain **exactly one** issue from the set: the critical
path head. If it gains more, return to step 4; child-to-child edges are missing.

Also check Field hygiene (Type/channel/Source/milestone/assignee) and Edges
without rationale. Both must be empty for the newly created issues.

## Step 7 — write the numbers back into the spec

Add this to the spec header in the same PR as the spec, or in the next PR if the
spec is already on `main`:

```markdown
- **Issues:** #130 (parent), #131, #132, #133
```

A spec without issue numbers and issues without a link to the spec section are
two halves nobody will reconnect a month later.

## Failure modes

| Symptom                                               | What actually happened                                                |
| ----------------------------------------------------- | --------------------------------------------------------------------- |
| Five issues from the set appear under Takeable        | Edges were not added; the graph stayed in someone's head              |
| Body says «depends on #N», while the graph is empty   | Prose is not a relation; neither the board nor triage sees it         |
| A child-to-parent blocking edge exists                | Hierarchy ≠ dependency; the parent is never a blocker                 |
| Issues were opened with `gh issue create`             | Validation was bypassed; Type/channel/Source/milestone may be missing |
| Spec is on `main`, issue numbers are recorded nowhere | The next session will open the same issues again                      |
