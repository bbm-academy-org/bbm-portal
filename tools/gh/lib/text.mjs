// bbm-portal — shared text predicates for the issue tooling.
//
// `isPlaceholder` lives here rather than in one of the two commands that need it
// (`backlog:triage` reads it out of a `Dependencies` clause, the epic
// product-layer gate reads it out of a waiver tail): an unfilled template field
// has one definition in this repo, and a second copy would be the one that
// drifts. `tools/gh/backlog-triage.mjs` re-exports it so its long-standing
// import surface is unchanged.

/** «none», a dash, an empty string, or an unfilled template placeholder. */
export function isPlaceholder(text) {
  const t = String(text ?? '')
    .trim()
    .toLowerCase()
  if (t === '') return true
  if (/^<!--[\s\S]*-->$/.test(t)) return true
  // An angle-bracket placeholder from canon §1's skeleton is an unfilled
  // template, not a populated field.
  if (/^<[^<>]*>$/.test(t)) return true
  return ['нет', 'none', 'нету', 'n/a', 'na', '—', '–', '-', 'tbd', '_no response_'].includes(t)
}
