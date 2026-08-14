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
2026-08-14 and converted TTF → WOFF2 with `fontTools` 4.63.0 (`brotli` 1.2.0):
container change only — glyphs, outlines, metrics, `cmap` and the `wght` axis
are byte-for-byte the upstream design, **no subsetting and no instancing**.

| Vendored file              | Kind               | Upstream path                            | Version | Upstream SHA-256                                                   |
| -------------------------- | ------------------ | ---------------------------------------- | ------- | ------------------------------------------------------------------ |
| `GolosText-Variable.woff2` | export (TTF→WOFF2) | `ofl/golostext/GolosText[wght].ttf`      | 2.004   | `17bb58fb69aec2dfb047a2ebf52534023e9b688c97a6b7ac795b0a72912c2063` |
| `Unbounded-Variable.woff2` | export (TTF→WOFF2) | `ofl/unbounded/Unbounded[wght].ttf`      | 1.701   | `323b511be380c8d474ef030686b71aedde501f8d9cd46da558b7c40454372c3f` |
| `IBMPlexMono-Medium.woff2` | export (TTF→WOFF2) | `ofl/ibmplexmono/IBMPlexMono-Medium.ttf` | 2.3     | `a9b4c49bb299e05b5f6c481e7fb5e78943d2793249a0c8874ab574a2d1ea6755` |

Golos Text and Unbounded are variable fonts (`wght` axes 400–900 and 200–900);
`OkrLayout.tsx` declares the sub-ranges the surface actually uses. IBM Plex Mono
has no variable release upstream, so the single static Medium (500) face is
vendored — the only weight the old call declared.

Glyph coverage is the full upstream charset, a superset of the `['latin',
'cyrillic']` subsets the old call named: Cyrillic is load-bearing on this
Russian-language surface, and not subsetting removes any chance of dropping a
codepoint that used to render.

## Reproducing / updating

```sh
curl -sL -o 'GolosText[wght].ttf' \
  'https://raw.githubusercontent.com/google/fonts/main/ofl/golostext/GolosText%5Bwght%5D.ttf'
python -c "from fontTools.ttLib import TTFont; f=TTFont('GolosText[wght].ttf'); f.flavor='woff2'; f.save('GolosText-Variable.woff2')"
```

Same two steps for the other two files. Re-fetch the `OFL.txt` next to the
upstream binary and update the table above whenever a binary is replaced.
