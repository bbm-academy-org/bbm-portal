/**
 * The bare refusal of spec 311 EARS-418 / D-5.
 *
 * «Bare means bare — a plain response with no layout, no top bar, no
 * explanation and no contact block.» This is the boundary `forbidden()` unwinds
 * to from the `/p` gates, and Next serves it with HTTP 403 — the status D-5
 * chose over 404 so that "why can't Пётр get in" stays diagnosable: the path
 * exists, the grant does not. Rendering nothing is the whole design; anything
 * added here (a heading, an apology, a "request access" link) would be a guest
 * contour this spec deliberately does not have.
 *
 * **Why it lives at `src/app/` and not inside the `(platform)` group**, which is
 * where every other file of this surface lives: `forbidden.tsx` is a ROOT-only
 * special file. A copy under `(platform)/` is silently ignored and Next falls
 * back to its own built-in 403 page — which carries the copy «This page could
 * not be accessed», i.e. exactly the explanation D-5 forbids. That failure is
 * invisible (the status code is right, only the body is wrong), so the file
 * stays here. Next renders it in its own error shell, outside the group's root
 * layout, which is why «no layout» is literally true.
 *
 * It is not a CMS-surface file despite its path: the CMS groups never call
 * `forbidden()`, and ADR-003's host allowlist answers a wrong-host request with
 * 404 long before any boundary is reached.
 */
export default function Forbidden() {
  return null
}
