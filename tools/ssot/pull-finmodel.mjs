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
// Сравнивается не только разбор значений, но и sha256 СЫРЫХ байт мастера
// (`meta.source_sha256`): правка одних комментариев мастера — тоже факт (снятая
// пометка `model_example`, подпись под весами майнинга), и она обязана давать
// дрейф. Сами пометки снимаются из комментариев в поле снапшота `model_example`,
// чтобы «пометку» не пересказывать руками в типах этого репо.
//
// Второй снимаемый артефакт (#193) — НОРМАТИВНЫЙ ДОКУМЕНТ
// `content/finmodel/index.mdx` того же мастера: он ложится байт в байт в
// `src/lib/finmodel/snapshot/rules.mdx`. ЧИТАЮТ его не здесь: документ
// рендерит KB (kb.bbm.academy/finmodel), а портальную страницу владелец
// отменил 2026-08-24 (#193) — второй рендер того же текста пришлось бы держать
// в синхроне без единого читателя. Снимок в этом репо существует ради машинной
// сверки текста с кодом (`tests/unit/finmodel-rules-consistency.spec.ts`):
// каждое число документа обязано приходить из снапшота, а не быть набранным
// руками. Свежесть его считается по sha256 СЫРЫХ байт, поэтому правка одной
// формулировки мастера — такой же дрейф, как правка значения.
//
// Коммит в паспорте документа — ПОСЛЕДНИЙ КОММИТ САМОГО ФАЙЛА
// (`commits?path=…`), а не HEAD репо на момент снятия: паспорт отвечает на
// вопрос «какую версию ЭТОГО текста несёт снимок», а не «когда в bbm-kb
// трогали что-то соседнее». Паспорт yaml-снапшота (`commit_sha` верхнего
// уровня) остаётся прежним — HEAD на момент снятия; он машинный, его читает
// джоба свежести (round-2 ревью PR #320, решение принято здесь).
//
// Доступ: `gh` CLI. Локально хватает `gh auth`; в CI — секрет `KB_READ_TOKEN`
// (fine-grained PAT, read-only contents на bbm-kb), который скрипт подставляет
// в `GH_TOKEN`.

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { parse } from 'yaml'

const REPO = 'bbm-academy-org/bbm-kb'
const REF = 'main'
const YAML_PATH = 'ssot/finmodel.yaml'
const MDX_PATH = 'content/finmodel/index.mdx'
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
  try {
    return execFileSync('gh', args, { encoding: 'utf8', env, maxBuffer: 16 * 1024 * 1024 })
  } catch (error) {
    // Стек Node здесь бесполезен: читателю нужно знать не «где упало», а чего
    // не хватает — иначе красная джоба выглядит как поломка скрипта, а не как
    // отсутствующий доступ.
    const detail = String(error?.stderr ?? error?.message ?? error).trim()
    console.error(`не удалось прочитать ${REPO} через gh: ${detail}`)
    console.error(
      env.KB_READ_TOKEN || env.GH_TOKEN
        ? 'Токен есть, но доступа нет: нужен read-only contents на приватный bbm-kb.'
        : 'Ни KB_READ_TOKEN, ни GH_TOKEN не заданы. Локально: gh auth login. ' +
            'В CI: секрет KB_READ_TOKEN репо bbm-portal (fine-grained PAT, read-only contents на bbm-kb).',
    )
    process.exit(1)
  }
}

/**
 * Форма мастера, которую типы этого репо обещают потребителю. Проверяется на
 * снятии, а не в рантайме калькулятора: `getVariables()` отдаёт снапшот с
 * приведением типа, и единственное, что делает это приведение честным, —
 * машинная проверка формы здесь плюс тот же вызов на закоммиченном файле в
 * `tests/unit/finmodel-ssot-snapshot.spec.ts`. Переименованный или выпавший
 * лист мастера обязан ронять `ssot:pull` / `ssot:check`, а не всплывать
 * прочерком на публичной странице.
 */
const REQUIRED_NUMBER_LEAVES = [
  'policy.profit_shares.investors',
  'policy.profit_shares.author',
  'policy.profit_shares.coauthors',
  'policy.royalty_percent.total',
  'policy.royalty_percent.mission_fund',
  'policy.royalty_percent.bbm_holders',
  'policy.reserve_percent',
  'policy.emission_price_rub',
  'policy.examples.team_monthly_rate_rub',
  'policy.examples.team_hours_norm',
  'projects.doctor_school.unit_price_rub',
  'projects.doctor_school.mining_weights.pul',
  'projects.doctor_school.mining_weights.bre',
  'projects.doctor_school.mining_weights.con',
]

/**
 * Значение по точечному пути; `undefined`, если путь обрывается.
 * @param {any} data
 * @param {string} path
 */
function at(data, path) {
  return path.split('.').reduce((node, key) => (node == null ? undefined : node[key]), data)
}

/**
 * Инварианты мастера, которые дешевле поймать на снятии, чем в рантайме
 * калькулятора: полная форма (`REQUIRED_NUMBER_LEAVES`), сплит роялти обязан
 * складываться в общий процент, а доли распределения — быть целыми (в текстах
 * они называются «4x / 2x / 1x»).
 * Чистая функция — её же зовут тесты снапшота.
 * @param {any} data
 * @returns {string[]} список нарушений, пустой массив = мастер валиден
 */
export function findInvariantViolations(data) {
  const out = []
  const policy = data?.policy
  if (!policy) return ['policy: секция отсутствует']

  for (const path of REQUIRED_NUMBER_LEAVES) {
    const value = at(data, path)
    if (!Number.isFinite(value)) {
      out.push(`${path}: ожидалось число, получено ${JSON.stringify(value) ?? 'undefined'}`)
    }
  }

  const r = policy.royalty_percent
  if (!r || r.mission_fund + r.bbm_holders !== r.total) {
    out.push('policy.royalty_percent: mission_fund + bbm_holders != total')
  }
  const s = policy.profit_shares
  if (!s || ![s.investors, s.author, s.coauthors].every(Number.isInteger)) {
    out.push('policy.profit_shares: доли обязаны быть целыми')
  }
  return out
}

/**
 * Пометки `model_example` живут в мастере ТОЛЬКО как YAML-комментарии, а
 * `parse()` их выбрасывает. Здесь они снимаются вместе со значениями и ложатся
 * в снапшот структурными данными — иначе «пометку» пришлось бы пересказывать
 * руками в типах, и это был бы второй источник правды: владелец переводит
 * число из модельного в фикс канона в bbm-kb, а этот репо продолжает
 * подписывать его «модельным».
 *
 * Путь маркера собирается по отступам; строки-комментарии (в том числе схема в
 * шапке мастера) значениями не считаются.
 * @param {string} yamlRaw
 * @returns {string[]} точечные пути помеченных значений
 */
export function extractModelExampleMarkers(yamlRaw) {
  const out = []
  /** @type {{indent: number, key: string}[]} */
  const stack = []
  for (const line of yamlRaw.split('\n')) {
    if (/^\s*(#|$)/.test(line)) continue
    const match = /^(\s*)([A-Za-z_][\w.-]*):(.*)$/.exec(line)
    if (!match) continue
    const indent = match[1].length
    while (stack.length > 0 && stack[stack.length - 1].indent >= indent) stack.pop()
    stack.push({ indent, key: match[2] })
    const rest = match[3]
    const hash = rest.indexOf('#')
    if (hash >= 0 && /\bmodel_example\b/.test(rest.slice(hash))) {
      out.push(stack.map((node) => node.key).join('.'))
    }
  }
  return out
}

/**
 * Содержимое снапшота: значения мастера плюс снятый из его комментариев список
 * помеченных путей.
 * @param {string} yamlRaw
 */
export function buildSnapshot(yamlRaw) {
  return { ...parse(yamlRaw), model_example: extractModelExampleMarkers(yamlRaw) }
}

/**
 * Хэш СЫРЫХ байт мастера. Сравнение разобранных значений слепо к правке одних
 * комментариев — а комментарий мастера несёт факт (пометка `model_example`,
 * подпись под весами майнинга), и его правка обязана давать дрейф.
 * @param {string} yamlRaw
 */
export function sourceSha256(yamlRaw) {
  return createHash('sha256').update(yamlRaw, 'utf8').digest('hex')
}

/**
 * Отстал ли закоммиченный снапшот от мастера — по значениям И по сырым байтам.
 * @param {string|null} currentSnapshotRaw
 * @param {any} currentMeta
 * @param {string} yamlRaw
 */
export function hasDrift(currentSnapshotRaw, currentMeta, yamlRaw) {
  return (
    currentSnapshotRaw !== serialize(buildSnapshot(yamlRaw)) ||
    currentMeta?.source_sha256 !== sourceSha256(yamlRaw)
  )
}

/**
 * Отстал ли закоммиченный снимок нормативного документа от мастера — по сырым
 * байтам файла И по хэшу в паспорте. Отдельная функция, а не четвёртый
 * аргумент `hasDrift`: у документа свой мастер-файл, свой хэш и свой коммит, и
 * смешивать два дрейфа в одном булеве значило бы потерять, какой из них
 * сработал.
 * @param {string|null} currentRulesRaw
 * @param {any} currentMeta
 * @param {string} mdxRaw
 */
export function hasRulesDrift(currentRulesRaw, currentMeta, mdxRaw) {
  return currentRulesRaw !== mdxRaw || currentMeta?.rules?.source_sha256 !== sourceSha256(mdxRaw)
}

/**
 * Поля паспорта документа, разошедшиеся с мастером. Байты и их хэш ловят
 * правку ТЕКСТА, но не переименование файла и не смену его последнего коммита
 * при тех же байтах — а подпись «версия …» под документом читает человек, и
 * она обязана указывать на настоящий коммит. Поэтому `--check` сверяет и
 * паспорт (ревью PR #325, п.5).
 * @param {any} currentMeta
 * @param {{source_path: string, commit_sha: string, commit_date: string}} expected
 * @returns {string[]} имена разошедшихся полей, пустой массив = паспорт свеж
 */
export function rulesPassportDrift(currentMeta, expected) {
  const rules = currentMeta?.rules
  if (!rules) return Object.keys(expected)
  return Object.keys(expected).filter((key) => rules[key] !== expected[key])
}

/**
 * Ответ `gh api commits?path=…` → sha и дата коммита ДОКУМЕНТА.
 *
 * Разбор вынесен из `main` ради одного отказа: `.[0]` по пустому массиву даёт
 * строку «null null», и незаграждённая деструктуризация положила бы её в
 * паспорт вместо того, чтобы уронить снятие. Пустая подпись под нормативным
 * документом хуже отсутствующей — она выглядит настоящей.
 * @param {string} raw
 * @returns {{sha: string, date: string}}
 */
export function parseCommitProbe(raw) {
  const [sha, date] = String(raw).trim().split(/\s+/)
  if (!/^[0-9a-f]{40}$/.test(sha ?? '') || !date || date === 'null') {
    throw new Error(
      `не удалось прочитать последний коммит ${MDX_PATH}: gh api commits вернул ${JSON.stringify(raw)}`,
    )
  }
  return { sha, date }
}

/**
 * `pulled_at` меняется каждым прогоном, поэтому сам по себе он не повод
 * переписывать файл: иначе `ssot:pull` пачкает дерево и печатает «no changes».
 * @param {any} currentMeta
 * @param {Record<string, string>} nextCore
 */
export function metaNeedsWrite(currentMeta, nextCore) {
  if (!currentMeta) return true
  // Сравнение через JSON: с #193 в паспорте появился вложенный блок `rules`, и
  // ссылочное сравнение объявляло бы его изменившимся каждым прогоном.
  return Object.entries(nextCore).some(
    ([key, value]) => JSON.stringify(currentMeta[key]) !== JSON.stringify(value),
  )
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
  const mdxRaw = gh([
    'api',
    `repos/${REPO}/contents/${MDX_PATH}?ref=${REF}`,
    '-H',
    'Accept: application/vnd.github.raw',
  ])
  // Последний коммит САМОГО файла документа — см. блок про паспорт в шапке.
  const { sha: rulesSha, date: rulesDate } = parseCommitProbe(
    gh([
      'api',
      `repos/${REPO}/commits?path=${MDX_PATH}&sha=${REF}&per_page=1`,
      '-q',
      '.[0].sha + " " + .[0].commit.committer.date',
    ]),
  )

  // Паспорт документа считается до ветки `--check`: его сверяют обе ветки.
  const rulesPassport = {
    source_path: MDX_PATH,
    commit_sha: rulesSha,
    // Дата ТОГО коммита, а не снятия: паспорт под документом отвечает на
    // вопрос «когда этот текст менялся в последний раз».
    commit_date: rulesDate,
  }

  const violations = findInvariantViolations(parse(yamlRaw))
  if (violations.length > 0) {
    console.error(`ssot invariant broken in ${REPO}@${headSha.slice(0, 7)}:${YAML_PATH}`)
    for (const v of violations) console.error(`  - ${v}`)
    process.exit(1)
  }

  const file = join(OUT_DIR, 'finmodel.json')
  const metaFile = join(OUT_DIR, 'meta.json')
  const rulesFile = join(OUT_DIR, 'rules.mdx')
  const next = serialize(buildSnapshot(yamlRaw))
  const current = existsSync(file) ? readFileSync(file, 'utf8') : null
  const currentRules = existsSync(rulesFile) ? readFileSync(rulesFile, 'utf8') : null
  const currentMeta = existsSync(metaFile) ? JSON.parse(readFileSync(metaFile, 'utf8')) : null

  if (checkOnly) {
    const stale = []
    if (hasDrift(current, currentMeta, yamlRaw)) stale.push(YAML_PATH)
    if (hasRulesDrift(currentRules, currentMeta, mdxRaw)) stale.push(MDX_PATH)
    const passportFields = rulesPassportDrift(currentMeta, rulesPassport)
    if (passportFields.length > 0) stale.push(`паспорт документа: ${passportFields.join(', ')}`)
    if (stale.length > 0) {
      console.error(
        `STALE: снапшот отстал от ${REPO}@${headSha.slice(0, 7)} (${stale.join(', ')}). ` +
          'Обнови: pnpm ssot:pull',
      )
      process.exit(1)
    }
    console.log(`fresh: снапшот соответствует ${REPO}@${headSha.slice(0, 7)}`)
    return
  }

  mkdirSync(OUT_DIR, { recursive: true })
  const contentChanged = current !== next
  if (contentChanged) writeFileSync(file, next)
  // Документ пишется БАЙТ В БАЙТ, без нормализации переводов строк: его хэш —
  // тот же `sourceSha256`, и «поправленный» перевод строки дал бы вечный дрейф.
  const rulesChanged = currentRules !== mdxRaw
  if (rulesChanged) writeFileSync(rulesFile, mdxRaw)

  // Паспорт снапшота. `pulled_at` намеренно вне сравнения `--check`: он менялся
  // бы каждым прогоном, и джоба свежести дрейфила бы сама на себя. А
  // `source_sha256`, наоборот, В сравнении — им ловится правка ОДНИХ
  // комментариев мастера, которую разбор значений не видит.
  const core = {
    source_repo: REPO,
    ref: REF,
    source_path: YAML_PATH,
    commit_sha: headSha,
    source_sha256: sourceSha256(yamlRaw),
    rules: { ...rulesPassport, source_sha256: sourceSha256(mdxRaw) },
  }
  const metaChanged = metaNeedsWrite(currentMeta, core)
  if (metaChanged) {
    const now = new Date().toISOString()
    writeFileSync(
      metaFile,
      serialize({
        ...core,
        rules: { ...core.rules, pulled_at: now },
        pulled_at: now,
      }),
    )
  }

  console.log(
    contentChanged || rulesChanged
      ? `updated from ${REPO}@${headSha.slice(0, 7)}`
      : metaChanged
        ? `no changes (meta.json refreshed: ${REPO}@${headSha.slice(0, 7)})`
        : 'no changes',
  )
}

// Импорт из теста не должен ходить в сеть — сеть только у прямого запуска.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main()
