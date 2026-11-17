// Просмотрщик IDEF0-модели производства контента DS (страница
// content/processes/ds-content-production/idef0.mdx). Передаётся в MDX через components map в
// app/(docs)/[[...slug]]/page.tsx, не import в MDX: тот же MDX рендерит bbm-portal через
// next-mdx-remote. Модель (model/index.yaml + диаграммы) и пояснения реестра (registry-ru.md,
// process-to-be-ru.md) читаются и разбираются на билде — по паттерну components/finmodel.tsx;
// в браузер уходят готовые данные, runtime-fetch нет.
import fs from 'node:fs';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { parseKnowledge } from './registry.mjs';
import { Idef0ViewerClient } from './client';

const PACKAGE = 'content/processes/ds-content-production';

export type Idef0Model = {
  index: { root: string; diagrams: { id: string; file: string; parent?: string }[] };
  diagrams: Record<string, unknown>[];
  knowledge: ReturnType<typeof parseKnowledge> | null;
  knowledgeError: string | null;
};

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), PACKAGE, file), 'utf8');

function loadModel(): Idef0Model {
  // Модель обязательна: без неё билд падает, страница с пустой схемой не публикуется.
  const index = parseYaml(read('model/index.yaml')) as Idef0Model['index'];
  const diagrams = index.diagrams.map((entry) => ({
    ...(parseYaml(read(`model/${entry.file}`)) as Record<string, unknown>),
    id: entry.id,
    parent: entry.parent,
  }));
  // Пояснения необязательны (как в исходном просмотрщике): без них схема открывается с одними ID.
  try {
    return {
      index,
      diagrams,
      knowledge: parseKnowledge(read('registry-ru.md'), read('process-to-be-ru.md')),
      knowledgeError: null,
    };
  } catch (error) {
    return { index, diagrams, knowledge: null, knowledgeError: String(error instanceof Error ? error.message : error) };
  }
}

export function Idef0Viewer() {
  return <Idef0ViewerClient model={loadModel()} />;
}
