# Vendored web fonts — «Карта пути» surface

Self-hosted font binaries for `PathMapLayout.tsx` (#530), vendored for the same
reason and in the same shape as the OKR surface's fonts
(`src/modules/okr/view/fonts/README.md`, #219/#230): `next/font/local` makes
`next build` network-free, whereas the Google loader resolves faces over the
network at build time. They live beside their sole importer and are not in
`design-source/` — a font binary is a redistributed asset, not a design.

The faces are the two the vendored canvas names (`design-source/path-map/`):
**Cormorant Garamond** for the beacon headline, **Manrope** for the UI.

## Licence

Both families are licensed under the **SIL Open Font License 1.1**; the full,
unmodified upstream licence text travels with each binary:

| Font               | Licence file                |
| ------------------ | --------------------------- |
| Cormorant Garamond | `OFL-CormorantGaramond.txt` |
| Manrope            | `OFL-Manrope.txt`           |

## Provenance

Upstream is the `google/fonts` repository (`main`), fetched from
`https://raw.githubusercontent.com/google/fonts/main/ofl/<dir>/<file>` on
2026-10-27 and rebuilt with `fontTools` 4.63.0 (`brotli`) the same day:
subsetted and flavoured WOFF2 in one `pyftsubset` step. Each vendored file is a
**build** (subset + → WOFF2): outlines, metrics and the `wght` axis inside the
retained set are unchanged — no instancing, re-hinting or re-drawing.

| Vendored file                      | Upstream path                                       | Version | Upstream SHA-256                                                   | Vendored SHA-256                                                   | `wght`  |
| ---------------------------------- | --------------------------------------------------- | ------- | ------------------------------------------------------------------ | ------------------------------------------------------------------ | ------- |
| `CormorantGaramond-Variable.woff2` | `ofl/cormorantgaramond/CormorantGaramond[wght].ttf` | 4.001   | `b20b7d9626dd956b2c5e558692ad328b1f19e3275e2782db4fa07670d83f35e0` | `633048f642df2d4b83eb6765e5bfe4f88def8dcf791d217cdd13e32932ebf49a` | 300–700 |
| `Manrope-Variable.woff2`           | `ofl/manrope/Manrope[wght].ttf`                     | 4.505   | `3ae11c49db0455a3cc33e37d380f20fdb8c7f8b41dc07625c177e3d87a9d6ae6` | `8bc99b663ab1c61b93b17988f5f80cff1268e9f277830eb31e7e2d5ebe5a832d` | 200–800 |

## Character coverage

Google Fonts' published `latin` + `cyrillic` `unicode-range` values (the same
two subsets the OKR fonts keep) plus `U+2192 →`, which the map renders in copy:

```
U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304,
U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215,
U+FEFF, U+FFFD, U+0301, U+0400-045F, U+0490-0491, U+04B0-04B1, U+2116, U+2192
```

Rebuild recipe:

```sh
pyftsubset '<Family>[wght].ttf' --unicodes='<the set above>' \
  --flavor=woff2 --layout-features='*' --output-file=<Family>-Variable.woff2
```
