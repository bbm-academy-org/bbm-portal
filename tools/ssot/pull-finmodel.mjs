#!/usr/bin/env node
// pull-finmodel — снапшот SSOT-переменных финмодели из мастера в потребителя.
//
// Мастер значений — `ssot/finmodel.yaml` в репо `bbm-academy-org/bbm-kb`
// (приватный). Этот репо — потребитель: он держит ЗАКОММИЧЕННЫЙ снапшот
// `src/lib/finmodel/snapshot/finmodel.json`, чтобы сборка и тесты не ходили в
// сеть, а модуль расчётов читал переменные обычным JSON-импортом.
//
// Контракт анти-staleness (спека финмодели §5): правка мастера обязана либо
// доезжать до портала, либо ронять сборку. Здесь выбран второй вариант:
//   pnpm ssot:pull   — обновить снапшот из bbm-kb@main
//   pnpm ssot:check  — сравнить снапшот с мастером; дрейф = exit 1 (джоба CI
//                      `ssot-freshness`, docs/ci-guardrails.md §5)
//
// Нормативный документ (`content/finmodel/index.mdx` в bbm-kb) сюда НЕ
// снапшотится: он снимается вместе со своим рендером (#193), где и принимается
// решение о публичном контуре — этот репо публичный, а документ до двух гейтов
// (юр-валидация; сверка словаря и весов) живёт в статусе драфта.
//
// Доступ: `gh` CLI. Локально хватает `gh auth`; в CI — секрет `KB_READ_TOKEN`
// (fine-grained PAT, read-only contents на bbm-kb), который скрипт подставляет
// в `GH_TOKEN`.

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { parse } from 'yaml'

const REPO = 'bbm-academy-org/bbm-kb'
const REF = 'main'
const YAML_PATH = 'ssot/finmodel.yaml'
const OUT_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'src',
  'lib',
  'finmodel',
  'snapshot',
)

/**
 * Единственная функция, зависящая от сети. `KB_READ_TOKEN` важнее `GH_TOKEN`:
 * в CI дефолтный токен воркфлоу до приватного bbm-kb не дотягивается.
 * @param {string[]} args
 * @returns {string}
 */
function gh(args) {
  const env = { ...process.env }
  if (env.KB_READ_TOKEN) env.GH_TOKEN = env.KB_READ_TOKEN
  return execFileSync('gh', args, { encoding: 'utf8', env, maxBuffer: 16 * 1024 * 1024 })
}

/**
 * Инварианты мастера, которые дешевле поймать на снятии, чем в рантайме
 * калькулятора: сплит роялти обязан складываться в общий процент, а доли
 * распределения — быть целыми (в текстах они называются «4x / 2x / 1x»).
 * Чистая функция — её же зовут тесты снапшота.
 * @param {any} data
 * @returns {string[]} список нарушений, пустой массив = мастер валиден
 */
export function findInvariantViolations(data) {
  const out = []
  const policy = data?.policy
  if (!policy) return ['policy: секция отсутствует']
  const r = policy.royalty_percent
  if (!r || r.mission_fund + r.bbm_holders !== r.total) {
    out.push('policy.royalty_percent: mission_fund + bbm_holders != total')
  }
  const s = policy.profit_shares
  if (!s || ![s.investors, s.author, s.coauthors].every(Number.isInteger)) {
    out.push('policy.profit_shares: доли обязаны быть целыми')
  }
  if (!data?.projects?.doctor_school?.mining_weights) {
    out.push('projects.doctor_school.mining_weights: секция отсутствует')
  }
  return out
}

/** Снапшот пишется той же формой, что и prettier для JSON: 2 пробела + \n. */
function serialize(data) {
  return JSON.stringify(data, null, 2) + '\n'
}

function main() {
  const checkOnly = process.argv.includes('--check')
  const headSha = gh(['api', `repos/${REPO}/commits/${REF}`, '-q', '.sha']).trim()
  const yamlRaw = gh([
    'api',
    `repos/${REPO}/contents/${YAML_PATH}?ref=${REF}`,
    '-H',
    'Accept: application/vnd.github.raw',
  ])
  const data = parse(yamlRaw)

  const violations = findInvariantViolations(data)
  if (violations.length > 0) {
    console.error(`ssot invariant broken in ${REPO}@${headSha.slice(0, 7)}:${YAML_PATH}`)
    for (const v of violations) console.error(`  - ${v}`)
    process.exit(1)
  }

  const file = join(OUT_DIR, 'finmodel.json')
  const next = serialize(data)
  const current = existsSync(file) ? readFileSync(file, 'utf8') : null
  const drift = current !== next

  if (checkOnly) {
    if (drift) {
      console.error(
        `STALE: снапшот отстал от ${REPO}@${headSha.slice(0, 7)}. Обнови: pnpm ssot:pull`,
      )
      process.exit(1)
    }
    console.log(`fresh: снапшот соответствует ${REPO}@${headSha.slice(0, 7)}`)
    return
  }

  mkdirSync(OUT_DIR, { recursive: true })
  if (drift) writeFileSync(file, next)
  // meta.json намеренно вне сравнения `--check`: `pulled_at` менялся бы каждым
  // прогоном, и джоба свежести дрейфила бы сама на себя.
  writeFileSync(
    join(OUT_DIR, 'meta.json'),
    serialize({
      source_repo: REPO,
      ref: REF,
      source_path: YAML_PATH,
      commit_sha: headSha,
      pulled_at: new Date().toISOString(),
    }),
  )
  console.log(drift ? `updated from ${REPO}@${headSha.slice(0, 7)}` : 'no changes')
}

// Импорт из теста не должен ходить в сеть — сеть только у прямого запуска.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main()
