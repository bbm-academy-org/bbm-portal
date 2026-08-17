/**
 * Хранилище модуля часов на схеме `core` (спека 124: EARS-10, EARS-12, EARS-20).
 *
 * Заменяет JSON-документ на диске (`./store.ts`, спека 081 пп. 12–13, 17) ТЕМ ЖЕ
 * интерфейсом: `readHoursDocument()` и `mutateHoursDocument(mutator)` с теми же
 * подписями, тем же `MutationResult` и той же семантикой `HoursDataError`. Домен
 * (`./document.ts`, `./publication.ts`) не знает, что под ним сменилось
 * хранилище — он по-прежнему получает целый документ и возвращает целый документ.
 *
 * Три вещи, из-за которых это не «тот же код с другим драйвером»:
 *
 *  - **Мьютекс стал БД-локом.** Мутация — одна транзакция, первая инструкция в
 *    ней `pg_advisory_xact_lock` на один фиксированный ключ модуля (`./core/lock.ts`,
 *    EARS-10). Внутрипроцессная очередь промисов перестаёт быть мьютексом в тот
 *    момент, когда с одной базой говорят два процесса.
 *  - **Никакого сетевого I/O внутри транзакции.** Лок берётся НА МУТАЦИЮ: цикл
 *    доставки спеки 100 остаётся N+1 отдельными мутациями с HTTP-запросом МЕЖДУ
 *    ними (`src/modules/hours/actions.ts`), а не одной транзакцией, держащей лок
 *    модуля через сеть.
 *  - **Отказ едет наружу исключением.** Отказ, который распознан
 *    (`./core/refusals.ts`), находится при открытой транзакции, а `return` из
 *    колбэка транзакции её КОММИТИТ. Поэтому распознанный отказ бросается
 *    (`HoursPersistRefusal`, транзакция откатывается) и здесь же превращается
 *    обратно в привычный формам `{ ok: false, error }`.
 *
 * Фолбэка на JSON нет нигде (EARS-12): нет `PLATFORM_DATABASE_URL` или база
 * недоступна — страница скажет «данные недоступны», мутация откажет вслух.
 */
import type { MutationResult } from './document'
import { hoursDb } from './core/db'
import { HoursDataError, HoursPersistRefusal } from './core/errors'
import { loadDocument } from './core/load'
import { HOURS_LOCK_KEY } from './core/lock'
import { persistDocument, takeHoursLock } from './core/persist'
import { refusalFor } from './core/refusals'
import type { HoursDocument } from './types'

/**
 * Похоже ли это на отказ ХРАНИЛИЩА (а не на ошибку в вызывающем коде).
 *
 * Различение существует затем, чтобы «данные недоступны» не стало универсальным
 * глушителем: исключение из мутатора или опечатка в этом файле должны падать
 * вслух, как падали бы, а не превращаться в успокаивающее сообщение о базе.
 */
function looksLikeStorageFailure(err: unknown): boolean {
  if (err instanceof HoursDataError) return true
  const node = err as { code?: unknown; name?: string; message?: string; cause?: unknown }
  if (typeof node?.code === 'string') return true
  if (node?.name === 'AggregateError') return true
  if (
    typeof node?.message === 'string' &&
    /ECONNREFUSED|ENOTFOUND|ETIMEDOUT|EAI_AGAIN|connect|terminat|Connection/i.test(node.message)
  ) {
    return true
  }
  return node?.cause ? looksLikeStorageFailure(node.cause) : false
}

/** Ошибка хранилища — наверх как `HoursDataError`; всё прочее — как есть. */
function asStorageError(err: unknown): unknown {
  if (err instanceof HoursDataError) return err
  if (!looksLikeStorageFailure(err)) return err
  return new HoursDataError('Данные модуля часов недоступны — база платформы не отвечает.', {
    cause: err,
  })
}

/**
 * Читает документ из `core`. Лок не берётся — читателю он не нужен, — но чтение
 * идёт одной транзакцией `repeatable read`: четыре отдельных `SELECT` в режиме
 * `read committed` могли бы увидеть половину чужой мутации, а документ читается
 * целиком (сводка, экспорт, отпечаток предпросмотра).
 */
export async function readHoursDocument(): Promise<HoursDocument> {
  const db = hoursDb()
  try {
    return await db.transaction(async (tx) => loadDocument(tx), {
      isolationLevel: 'repeatable read',
      accessMode: 'read only',
    })
  } catch (cause) {
    throw asStorageError(cause)
  }
}

/**
 * Атомарно применяет мутацию к целому документу (EARS-10). Отказ мутации ничего
 * не пишет; результат (включая warnings) возвращается вызывающему как есть.
 */
export async function mutateHoursDocument<T>(
  mutator: (doc: HoursDocument) => MutationResult<T>,
): Promise<MutationResult<T>> {
  const db = hoursDb()
  try {
    return await db.transaction(async (tx) => {
      await takeHoursLock(tx, HOURS_LOCK_KEY)
      const before = await loadDocument(tx)
      const result = mutator(before)
      if (!result.ok) return result

      try {
        await persistDocument(tx, before, result.doc)
      } catch (cause) {
        if (cause instanceof HoursPersistRefusal) throw cause
        const refusal = refusalFor(cause, before, result.doc)
        if (refusal) throw new HoursPersistRefusal(refusal, { cause })
        throw cause
      }
      return result
    })
  } catch (cause) {
    if (cause instanceof HoursPersistRefusal) return { ok: false, error: cause.refusal }
    throw asStorageError(cause)
  }
}

export { HoursDataError } from './core/errors'
