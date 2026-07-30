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
