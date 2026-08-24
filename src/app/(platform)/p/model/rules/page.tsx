import React from 'react'

import { RULES_META, RULES_MDX } from '@/lib/finmodel'
import { RulesDocument } from '@/modules/finmodel/view/RulesDocument'
import { RulesShell } from '@/modules/finmodel/view/RulesShell'
import { documentToc } from '@/modules/finmodel/view/toc'

/**
 * `/p/model/rules` — нормативный документ «Смарт-контракт BBM» (#193).
 *
 * Монтаж тонкий, как у `/p/hours` и `/p/okr`: аутентификацию уже сделал
 * OIDC-гейт группы `(platform)` (Zitadel), host-allowlist держит поверхность
 * вне CMS-хоста. Страница НЕ публичная — владелец 2026-08-24 отнёс документ к
 * рабочему пространству портала (ревизия §6 спеки презентации финмодели);
 * юридический гейт перестал быть блокером видимости, а статус драфта стоит у
 * заголовка.
 *
 * Данных за пределами закоммиченного снимка у страницы нет: и текст, и числа
 * приходят из `src/lib/finmodel/snapshot`, в сеть на рендере никто не ходит.
 */

// Cache gate группы `(platform)`: каждый сегмент рендерится по запросу, чтобы
// страницу за гейтом нельзя было отдать анониму из статического кэша
// (tests/unit/platform-cache-gate.spec.ts).
export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Смарт-контракт BBM',
}

export default function ModelRulesPage() {
  return (
    <RulesShell
      toc={documentToc(RULES_MDX)}
      passport={{
        commitSha: RULES_META.commit_sha,
        commitDate: RULES_META.commit_date,
        sourcePath: RULES_META.source_path,
      }}
    >
      <RulesDocument />
    </RulesShell>
  )
}
