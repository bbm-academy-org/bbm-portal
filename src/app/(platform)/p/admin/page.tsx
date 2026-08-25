/**
 * The cabinet's route anchor.
 *
 * `/p/admin` has to BE a route for its claim gate to be observable at all — an
 * unrouted path answers 404 for admin and member alike, and the refusal of
 * EARS-418 would be indistinguishable from "there is nothing here". This file
 * is that anchor and nothing more: the index of sections scenario 6 describes,
 * the Refine shell around it and everything under `/p/admin/<slug>/<resource>`
 * are §D of spec 311 and belong to #315, which builds them inside the gate that
 * `layout.tsx` next to this file already enforces.
 *
 * It carries no design decision — no chrome, no navigation, no copy beyond the
 * section's own name — so there is nothing here for #315 to undo.
 */
export default function AdminIndexPage() {
  return <h1>Админка</h1>
}
