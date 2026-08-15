# Vendored web fonts — OKR surface

Self-hosted font binaries for `OkrLayout.tsx`. They replaced a call to the
Google loader of `next/font` (#219): that loader resolves the faces over the
network **at build time**, so a transient `fonts.googleapis.com` failure turned
the required `ci` check red on a cold hosted runner. `next/font` self-hosted
these bytes at runtime already — vendoring moves only the _build_ input.

They live here, beside their sole importer, rather than in `public/` or a shared
asset root, because `next/font/local` resolves `src` **relative to the importing
file** and the OKR module is the only consumer — co-located, they move or die
with the module that uses them.

They are **not** in `design-source/`: that directory holds the design _of a
surface_ (the owner-approved mockup a build is measured against,
`.claude/rules/design-process.md` §1). A font binary is a redistributed
third-party asset the surface consumes, not a description of how the surface
should look. Its provenance is recorded here instead, in the same shape.

## Licence

All three families are licensed under the **SIL Open Font License 1.1**, which
permits redistribution of the font files, including in a public repository, as
long as the licence travels with them. The full, unmodified upstream licence
text of each family is committed alongside its binary:

| Font          | Licence file          |
| ------------- | --------------------- |
| Golos Text    | `OFL-GolosText.txt`   |
| Unbounded     | `OFL-Unbounded.txt`   |
| IBM Plex Mono | `OFL-IBMPlexMono.txt` |

Reserved Font Names, copyright holders and the licence conditions are stated in
those files; nothing here overrides them.

## Provenance

Upstream is the `google/fonts` repository (`main`), the same origin
`fonts.googleapis.com` serves from. Each file was fetched from
`https://raw.githubusercontent.com/google/fonts/main/ofl/<dir>/<file>` on
2026-08-14 and rebuilt with `fontTools` 4.63.0 (`brotli` 1.2.0) on 2026-08-15:
subsetted to the character coverage below and flavoured WOFF2 in one
`pyftsubset` step (#230).

Each vendored file is therefore a **build**, not an export of the upstream
binary — its glyph set is a proper subset of the upstream design. Outlines,
metrics and the `wght` axis inside the retained set are unchanged: the build
subsets, it does **not** instance, re-hint or re-draw.

| Vendored file              | Kind                     | Upstream path                            | Version | Upstream SHA-256                                                   | Vendored SHA-256                                                   |
| -------------------------- | ------------------------ | ---------------------------------------- | ------- | ------------------------------------------------------------------ | ------------------------------------------------------------------ |
| `GolosText-Variable.woff2` | build (subset + → WOFF2) | `ofl/golostext/GolosText[wght].ttf`      | 2.004   | `17bb58fb69aec2dfb047a2ebf52534023e9b688c97a6b7ac795b0a72912c2063` | `596b2c5bdbd44f26f0a1f4940ca16f9cf123c865ae0259cff01fbbaf627245c8` |
| `Unbounded-Variable.woff2` | build (subset + → WOFF2) | `ofl/unbounded/Unbounded[wght].ttf`      | 1.701   | `323b511be380c8d474ef030686b71aedde501f8d9cd46da558b7c40454372c3f` | `52b48855e1af66a30badb7e76fcd8c4c60935cbfd804c52a973ee48177697319` |
| `IBMPlexMono-Medium.woff2` | build (subset + → WOFF2) | `ofl/ibmplexmono/IBMPlexMono-Medium.ttf` | 2.3     | `a9b4c49bb299e05b5f6c481e7fb5e78943d2793249a0c8874ab574a2d1ea6755` | `bdd640cf88716b0e9bba7f608e31d6048bd78de274c00d3484e08abb25b380e2` |

Golos Text and Unbounded are variable fonts; the build keeps their `wght` axes
intact (`fvar` after subsetting: 400–900 and 200–900, the upstream spans), which
is what lets one file serve the four weights `OkrLayout.tsx` declares as a
range. Flattening them to static instances would trade the byte regression for a
weight regression, so `--instance` is deliberately **not** used. IBM Plex Mono
has no variable release upstream, so the single static Medium (500) face is
vendored — the only weight the old call declared.

## Character coverage

The retained set is Google Fonts' published `latin` + `cyrillic`
`unicode-range` values — exactly the two subsets the `next/font/google` call
named before #219 vendored these files — plus seven codepoints this surface
renders that fall outside them:

| Part           | Range                                                                                                                                                                        |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `latin`        | `U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD` |
| `cyrillic`     | `U+0301, U+0400-045F, U+0490-0491, U+04B0-04B1, U+2116`                                                                                                                      |
| surface extras | `U+20BD ₽, U+2192 →, U+2264 ≤, U+2298 ⊘, U+25CB ○, U+25D0 ◐, U+2713 ✓`                                                                                                       |

The extras are named individually rather than by pulling in whole blocks:
`₽` and `→` occur in rendered copy (`metrics.yaml`, `src/lib/okr/`), and
`⊘ ○ ◐ ✓` are the KR status-chip glyphs in `components.tsx`. Their blocks —
`latin-ext` and the geometric-shape/dingbat ranges — would cost far more than
the seven codepoints do.

`latin-ext` and `cyrillic-ext` are **not** included as blocks, deliberately.
`cyrillic-ext` is historic and non-Russian-Slavic Cyrillic (`U+0460-052F`,
`U+2DE0-2DFF`, `U+A640-A69F`); the whole Russian alphabet including `ё`
(`U+0451`) lives in `cyrillic`. `latin-ext` is Central-European and Vietnamese
diacritics plus the remaining currency signs, of which only `₽` appears here.
This is the same coverage contract the Google loader served under, so the
fallback behaviour for anything outside it is unchanged from before #219.

Verified mechanically per file: every codepoint present in the upstream `cmap`
that the OKR module's sources, `metrics.yaml`, the full Russian alphabet and the
Russian punctuation set (`— « » … № ₽ – ·`) contain survives the subset — 0
lost in all three files. What was dropped is Latin Extended, Cyrillic Extended,
Greek, box-drawing and dingbats. (`pyftsubset` also drops the `meta` table,
which carries script/language design metadata and no glyph data.)

## Reproducing / updating

```sh
curl -sL -o 'GolosText[wght].ttf' \
  'https://raw.githubusercontent.com/google/fonts/main/ofl/golostext/GolosText%5Bwght%5D.ttf'

pyftsubset 'GolosText[wght].ttf' \
  --output-file=GolosText-Variable.woff2 \
  --flavor=woff2 \
  --unicodes='U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD,U+0301,U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116,U+20BD,U+2192,U+2264,U+2298,U+25CB,U+25D0,U+2713' \
  --layout-features='*' \
  --name-IDs='*' --name-legacy \
  --notdef-outline
```

Same two steps for the other two files, with the matching upstream path and
output name. The flags are load-bearing: `--layout-features='*'` keeps kerning
and the other OpenType features (the default prunes to a minimal set),
`--name-IDs='*' --name-legacy` keeps the full `name` table including the OFL
licence records 13/14 (the default keeps only IDs 0–6 and would strip the
licence text out of the binary), and no `--instance` flag is passed so `fvar`
and `gvar` survive. Re-fetch the `OFL.txt` next to the upstream binary and
update both SHA-256 columns above whenever a binary is rebuilt.
