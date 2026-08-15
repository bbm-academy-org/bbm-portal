import { describe, expect, it } from 'vitest'

import {
  BRANCH_TYPES,
  branchName,
  branchTypeFromTitle,
  isValidBranchType,
  nextStepsLines,
  slugifyTitle,
  worktreeRelPath,
} from '../../tools/dev/task-worktree.mjs'
import {
  branchDeletionDecision,
  branchDatabaseTeardownPlan,
  classifyTeardownScope,
  classifyTeardownTarget,
  normPath,
  resolveWorktreePath,
} from '../../tools/dev/worktree-teardown.mjs'

/**
 * Ветка задачи выводится из заголовка issue, потому что в этом репо у issue нет
 * kind-меток — тип живёт в заголовке по Conventional Commits (#90).
 */

describe('branchTypeFromTitle', () => {
  it('берёт тип из Conventional-префикса заголовка, со скоупом и без', () => {
    expect(branchTypeFromTitle('feat(dev): worktree-тулинг')).toBe('feat')
    expect(branchTypeFromTitle('fix: не падать на пустом слаге')).toBe('fix')
    expect(branchTypeFromTitle('chore(dev-stand): вернуть диапазон')).toBe('chore')
    expect(branchTypeFromTitle('docs(adr): ADR-003')).toBe('docs')
  })

  it('сводит синонимы к четырём типам репо', () => {
    expect(branchTypeFromTitle('feature: новый модуль')).toBe('feat')
    expect(branchTypeFromTitle('bugfix(okr): битый счётчик')).toBe('fix')
    expect(branchTypeFromTitle('FEAT(hours): калькулятор')).toBe('feat')
  })

  it('незнакомый или отсутствующий тип падает в безопасный chore', () => {
    expect(branchTypeFromTitle('refactor(okr): развязать модуль')).toBe('chore')
    expect(branchTypeFromTitle('ci: обновить workflow')).toBe('chore')
    expect(branchTypeFromTitle('просто заголовок без префикса')).toBe('chore')
    expect(branchTypeFromTitle('')).toBe('chore')
  })
})

describe('isValidBranchType', () => {
  it('пропускает только конвенцию репо', () => {
    for (const t of BRANCH_TYPES) expect(isValidBranchType(t)).toBe(true)
    expect(isValidBranchType('refactor')).toBe(false)
    expect(isValidBranchType('Feat')).toBe(false)
  })
})

describe('slugifyTitle', () => {
  it('срезает Conventional-префикс со скоупом', () => {
    expect(slugifyTitle('feat(dev): worktree tooling')).toBe('worktree-tooling')
  })

  it('транслитерирует кириллицу — иначе русский заголовок даёт пустой слаг', () => {
    expect(slugifyTitle('fix(okr): строка действия')).toBe('stroka-deistviya')
    expect(slugifyTitle('чинить ёлку')).toBe('chinit-elku')
  })

  it('схлопывает пунктуацию в дефисы и обрезает края', () => {
    expect(slugifyTitle('chore: dev:ports — проба 3000–3009!')).toBe('dev-ports-proba-3000-3009')
  })

  it('ограничивает шесть слов, чтобы имя ветки оставалось читаемым', () => {
    expect(slugifyTitle('feat: one two three four five six seven eight')).toBe(
      'one-two-three-four-five-six',
    )
  })

  it('возвращает пустую строку, если выводить нечего (вызов падает явно)', () => {
    expect(slugifyTitle('feat(dev):')).toBe('')
    expect(slugifyTitle(undefined)).toBe('')
  })
})

describe('branchName / worktreeRelPath', () => {
  it('собирает <type>/<N>-<slug> и короткий числовой путь', () => {
    expect(branchName('feat', 90, 'worktree-ports')).toBe('feat/90-worktree-ports')
    expect(worktreeRelPath(93)).toBe('.claude/worktrees/93')
  })
})

describe('nextStepsLines', () => {
  it('несёт безусловное предупреждение про pnpm install', () => {
    const text = nextStepsLines('.claude/worktrees/93', 93).join('\n')
    expect(text).toContain('pnpm install')
    expect(text).toContain('node_modules')
    expect(text).toContain('pnpm worktree:teardown 93')
    expect(text).toContain('pnpm dev:ports')
  })
})

describe('resolveWorktreePath', () => {
  const root = '/repo'

  it('голое имя резолвится в .claude/worktrees первичного дерева', () => {
    const abs = resolveWorktreePath('93', root, () => true)
    expect(normPath(abs)).toContain('/repo/.claude/worktrees/93')
  })

  it('голое имя без каталога на диске остаётся путём как есть', () => {
    const abs = resolveWorktreePath('93', root, () => false)
    expect(normPath(abs).startsWith('/repo')).toBe(false)
    expect(normPath(abs).endsWith('/93')).toBe(true)
  })

  it('явный путь honored как есть', () => {
    const abs = resolveWorktreePath('.claude/worktrees/90', root, () => false)
    expect(normPath(abs)).toContain('.claude/worktrees/90')
  })
})

/**
 * Защитный контур разборки (ревью PR #97): удалять можно ТОЛЬКО то, что лежит
 * строго внутри <primary>/.claude/worktrees/. Оба сценария ревьюера ниже —
 * `.` (контейнер) и путь основного чекаута — воспроизведены как тесты.
 */
describe('classifyTeardownScope', () => {
  const root = '/repo'
  const real = (p: string) => p

  it('легитимный вложенный worktree проходит', () => {
    expect(classifyTeardownScope('/repo/.claude/worktrees/93', root, real)).toBe('inside')
    expect(classifyTeardownScope('/repo/.claude/worktrees/agent-abc/sub', root, real)).toBe(
      'inside',
    )
  })

  it('`.` резолвится в контейнер worktrees — отказ, иначе сносит все деревья', () => {
    // resolveWorktreePath('.') даёт join(root, '.claude/worktrees/.') → сам контейнер.
    const asDot = resolveWorktreePath('.', root, () => true)
    expect(classifyTeardownScope(asDot, root, real)).toBe('worktrees-root')
    expect(classifyTeardownScope('/repo/.claude/worktrees', root, real)).toBe('worktrees-root')
  })

  it('путь основного чекаута — отдельный отказ, а не «orphan» на удаление', () => {
    expect(classifyTeardownScope('/repo', root, real)).toBe('primary-tree')
    expect(classifyTeardownScope('/repo/', root, real)).toBe('primary-tree')
  })

  it('всё вне контейнера — отказ, включая соседа с общим префиксом', () => {
    expect(classifyTeardownScope('/repo/src', root, real)).toBe('outside')
    expect(classifyTeardownScope('/repo/.claude/skills', root, real)).toBe('outside')
    expect(classifyTeardownScope('C:/Users/sidor/Documents', root, real)).toBe('outside')
    // .claude/worktrees-old не является .claude/worktrees/...
    expect(classifyTeardownScope('/repo/.claude/worktrees-old/93', root, real)).toBe('outside')
  })

  it('без корня репозитория не удаляем ничего', () => {
    expect(classifyTeardownScope('/repo/.claude/worktrees/93', null, real)).toBe('no-root')
  })

  it('канонизация закрывает обход через симлинк наружу', () => {
    // Симлинк .claude/worktrees/evil → /repo (основной чекаут).
    const viaSymlink = (p: string) => (p === '/repo/.claude/worktrees/evil' ? '/repo' : p)
    expect(classifyTeardownScope('/repo/.claude/worktrees/evil', root, viaSymlink)).toBe(
      'primary-tree',
    )
  })

  it('сравнение регистронезависимо и не зависит от вида слешей (Windows)', () => {
    const winRoot = 'C:\\repo'
    expect(classifyTeardownScope('C:/Repo/.claude/Worktrees/93', winRoot, real)).toBe('inside')
    expect(classifyTeardownScope('C:\\repo', winRoot, real)).toBe('primary-tree')
  })
})

describe('branchDeletionDecision', () => {
  it('удаляет только влитую в main ветку', () => {
    expect(branchDeletionDecision('feat/90-worktree-ports', true)).toBe('delete')
  })

  it('несмерженную оставляет — разборка не способ потерять коммиты', () => {
    expect(branchDeletionDecision('feat/90-worktree-ports', false)).toBe('keep')
  })

  it('detached HEAD — удалять нечего', () => {
    expect(branchDeletionDecision(null, true)).toBe('detached')
    expect(branchDeletionDecision('', false)).toBe('detached')
  })
})

describe('classifyTeardownTarget', () => {
  it('зарегистрированный worktree — обычная разборка', () => {
    expect(
      classifyTeardownTarget(
        'C:\\repo\\.claude\\worktrees\\93',
        ['C:/repo/.claude/worktrees/93'],
        () => true,
      ),
    ).toBe('registered')
  })

  it('незарегистрированный, но лежащий на диске — сирота после long-path сбоя', () => {
    expect(classifyTeardownTarget('/repo/.claude/worktrees/93', [], () => true)).toBe('orphan')
  })

  it('ни того ни другого — падаем громко, а не «успешно» ничего не делаем', () => {
    expect(classifyTeardownTarget('/repo/.claude/worktrees/nope', [], () => false)).toBe(
      'unresolvable',
    )
  })
})

describe('branchDatabaseTeardownPlan', () => {
  it('tears down the matching platform_<N> database for a numeric task worktree', () => {
    const plan = branchDatabaseTeardownPlan('200', '/repo/.claude/worktrees/200', '/repo')

    expect(plan).toEqual({ action: 'drop', taskId: '200' })
  })

  it('fails closed when the numeric argument and worktree basename disagree', () => {
    expect(() => branchDatabaseTeardownPlan('200', '/repo/.claude/worktrees/201', '/repo')).toThrow(
      /mismatch/i,
    )
  })

  it('skips database teardown for non-numeric ad-hoc worktree paths', () => {
    expect(
      branchDatabaseTeardownPlan('scratch', '/repo/.claude/worktrees/scratch', '/repo'),
    ).toEqual({
      action: 'skip',
      reason: 'not a numeric task worktree',
    })
  })
})
