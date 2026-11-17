// PORTED verbatim from bbm-academy-org/bbm-kb `components/idef0-viewer/registry.mjs` (#553; source
// vendored in `design-source/processes/registry.mjs`). The only change is this header: in the portal
// it runs on the SERVER per request (`./parse.ts`), over the markdown read from bbm-kb main, not at
// build time. Original header follows.
//
// Plain-language explanations of registry IDs for the IDEF0 viewer, parsed at build time from the
// package's markdown (index.tsx), so the viewer never carries a hand copy of their text:
// registry-ru.md gives each O-ID / F-ID its name, type and definition; process-to-be-ru.md gives each
// F-ID its TO-BE step (the model is TO-BE: the registry is legacy input, the process document says
// what became of it) and «Не входит в TO-BE» the reason an item was left out.

const ID = /^[OF]-\d{3}$/;
const IDS = /[OF]-\d{3}/g;

/** Inline markdown → text: links keep their text, emphasis and code marks go. */
export function plain(text) {
  return String(text ?? "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\*\*|__|`/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** «—» and empty cells mean «nothing». */
const value = (text) => {
  const v = plain(text);
  return v === "—" || v === "-" ? "" : v;
};

const cells = (line) =>
  line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim());
const isRule = (line) => /^\|(\s*:?-{3,}:?\s*\|)+\s*$/.test(line.trim());

/** Every markdown table with the `##` section and nearest `##`/`###` heading it sits under. */
function tables(md) {
  const lines = md.split(/\r?\n/);
  const out = [];
  let section = "";
  let heading = "";
  for (let i = 0; i < lines.length; i += 1) {
    const h = /^(#{2,3})\s+(.*)$/.exec(lines[i]);
    if (h) {
      if (h[1] === "##") section = plain(h[2]);
      heading = plain(h[2]);
      continue;
    }
    if (!lines[i].startsWith("|") || !isRule(lines[i + 1] ?? "")) continue;
    const table = { section, heading, header: cells(lines[i]), rows: [] };
    for (i += 2; i < lines.length && lines[i].startsWith("|"); i += 1)
      table.rows.push(cells(lines[i]));
    i -= 1;
    out.push(table);
  }
  return out;
}

const record = (header, row) =>
  Object.fromEntries(header.map((h, k) => [h, row[k] ?? ""]));

/** A parenthesis holding only registry IDs is a reference, not wording: dropped from step text. */
const withoutIdRefs = (text) =>
  text
    .replace(/\s*\((?:[OF]-\d{3}|TK-\d+|[\s,;/и…])+\)/g, "")
    .replace(/\s+([.,;:])/g, "$1");

export function parseKnowledge(registryMd, processMd) {
  const objects = new Map();
  const functions = new Map();
  const clusters = new Map();
  for (const t of tables(registryMd)) {
    if (t.section === "Функции" && t.header[0] === "Кластер") {
      for (const row of t.rows) clusters.set(row[0], plain(row[1]));
      continue;
    }
    if (t.header[0] !== "ID") continue;
    for (const row of t.rows) {
      const id = plain(row[0]);
      if (!ID.test(id)) continue;
      const r = record(t.header, row);
      const common = {
        id,
        status: value(r["Статус"]),
        decision: value(r["Решение / вопрос"]),
      };
      if (t.section === "Объекты" && id[0] === "O")
        objects.set(id, {
          ...common,
          name: plain(r["Название"]),
          type: value(r["Тип"]),
          group: t.heading,
          definition: value(r["Определение"]),
        });
      else if (t.section === "Функции" && id[0] === "F")
        functions.set(id, {
          ...common,
          name: plain(r["Функция"]),
          cluster: value(r["Кластер"]),
          executor: value(r["Исполнитель"]),
        });
    }
  }

  // TO-BE steps: numbered items of the numbered process blocks («## 1. …» … «## 7. …»).
  const steps = new Map();
  const blocks = new Map();
  let block = null;
  for (const line of processMd.split(/\r?\n/)) {
    const h = /^##\s+(?:(\d+)\.\s+)?(.*)$/.exec(line);
    if (h) {
      block = h[1] ? { n: Number(h[1]), title: plain(h[2]) } : null;
      if (block) blocks.set(block.n, block.title);
      continue;
    }
    if (!block) continue;
    // A step list is a numbered list, or one paragraph «**Шаги TO-BE — …** 19. … 20. …».
    const parts = /^\*\*Шаги/.test(line)
      ? line.replace(/^\*\*[^*]*\*\*\s*/, "").split(/\s(?=\d+\.\s)/)
      : [line];
    for (const part of parts) {
      const item = /^\d+\.\s+(.*)$/.exec(part);
      if (!item) continue;
      const text = withoutIdRefs(plain(item[1]));
      for (const id of new Set(item[1].match(IDS) ?? [])) {
        if (!steps.has(id)) steps.set(id, []);
        steps.get(id).push({ block: block.n, text });
      }
    }
  }
  const outOfScope = new Map();
  for (const t of tables(processMd)) {
    if (t.section !== "Не входит в TO-BE") continue;
    for (const row of t.rows)
      for (const id of row[0].match(IDS) ?? [])
        outOfScope.set(id, { what: plain(row[1]), reason: plain(row[2]) });
  }
  return { objects, functions, clusters, steps, blocks, outOfScope };
}
