---
paths:
  - 'src/lib/okr/**'
  - 'src/app/**/okr/**'
---

<!-- READ-ON-DEMAND (`paths:` frontmatter, so not always-on). The frontmatter must stay the first bytes of the file. Indexed in AGENTS.md §0. -->

# OKR module — the first dynamic platform module

**Anchor (BBMP-129 milestone):** PRD `../bbm/outputs/2026-07-22-okr-dashboard/2026-07-23-prd-plane-integration.md` · progress model §3 + Plane taxonomy §4 `../bbm/outputs/2026-07-22-okr-dashboard/okr-structure.md` · Plane structure cut `../bbm/outputs/2026-07-22-okr-dashboard/2026-07-23-update/plane-cut-spec.md` · tracking: GH #58 (P1 core, `BBMP-130`) → #59 (Zitadel OIDC gate, `BBMP-131`) → #60 (prod + Vercel retire, `BBMP-132`).

Code: `src/lib/okr` plus its route. It reads self-hosted Plane (workspace `doctor-school`, projects DSG1–DSG5) read-only with a TTL cache; the SSOT stays in Plane, and the only module-owned facts are manual metric values (`metrics.yaml`).

Module discipline per ADR-002: no imports from the CMS side (collections/globals/endpoints/payload config), enforced by dependency-cruiser in CI.
