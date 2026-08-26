import type { ReactNode } from 'react'

import {
  AppTile,
  Button,
  Container,
  Eyebrow,
  PageHeader,
  TOKEN_GROUPS,
  Tag,
  TileGrid,
  TopBar,
  type TokenGroup,
} from '@/ui'

import './showcase.css'

/**
 * The component showcase (#312) — every token and every component of `src/ui`
 * on one page, rendered by the real code rather than described.
 *
 * WHY IT IS A ROUTE AND NOT A STORYBOOK. Consolidation spec §11 defers «UI-линты
 * и showcase» behind one trigger — the start of `src/ui` — and asks for the
 * minimal viable version of each. A component-workshop dependency (Storybook and
 * its build) is a second toolchain to install, patch and keep on Node 22 for a
 * kit of eight components. A page is: the app's own build, the app's own
 * bundler, the app's own fonts, and — the part a separate workshop cannot give —
 * the components rendered in the SAME cascade the real surfaces get, so a
 * regression that only shows inside the platform layout shows here too.
 *
 * WHERE IT SITS. Under `/p`, so it inherits the workspace gate of
 * `src/app/(platform)/p/layout.tsx` by existing (EARS-416): a signed-in member
 * sees it, nobody else does. It is deliberately NOT a registry entry — it
 * appears on no launcher tile and in no app switcher; it is an engineering
 * surface, reached by typing its path.
 *
 * WHAT IT IS FOR. Reviewing a component against `design-source/` without
 * building a screen to hold it, and seeing the states the vendored wireframes
 * do not draw. Each section names the states that CANNOT be shown statically
 * (hover, focus-visible) rather than pretending the default is all there is.
 */

const SECTION_STATES: Record<string, string> = {
  Button:
    'Показаны: обычное и выключенное. Наведение и фокус-видимый существуют, но статичная страница их не рисует — проверяются с клавиатуры.',
  AppTile:
    'Показаны все четыре формы плитки. Наведение и фокус-видимый есть у ссылочных форм; плитка «портфель, позже» не получает ни того, ни другого — она не элемент управления.',
  TopBar: 'Показаны состояние главной (без имени приложения) и состояние внутри приложения.',
}

/**
 * Each token demonstrated by its EFFECT, never by a reprinted value: a colour
 * as a swatch, a length as a bar of that width, a type token as a line set with
 * it. The value itself stays in `tokens.css` — a page that printed it would be
 * a third copy of the palette, and the third copy is the one that drifts.
 */
function tokenDemo(group: TokenGroup, token: string) {
  if (group.kind === 'color') {
    return (
      <span
        className="bbm-showcase__swatch"
        style={{ background: `var(${token})` }}
        aria-hidden="true"
      />
    )
  }
  if (group.kind === 'length') {
    return (
      <span
        className="bbm-showcase__swatch"
        style={{ width: `var(${token})`, background: 'var(--bbm-color-surface-selected)' }}
        aria-hidden="true"
      />
    )
  }
  return (
    <span style={{ fontSize: `var(${token})` }} aria-hidden="true">
      Аа
    </span>
  )
}

function TokenSection({ group }: { group: TokenGroup }) {
  return (
    <section className="bbm-showcase__section">
      <h2 className="bbm-showcase__section-title">{group.title}</h2>
      <div className="bbm-showcase__panel">
        <ul className="bbm-showcase__tokens">
          {group.tokens.map((token) => (
            <li className="bbm-showcase__token" key={token}>
              {tokenDemo(group, token)}
              <code className="bbm-showcase__token-name">{token}</code>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}

function ComponentSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="bbm-showcase__section">
      <h2 className="bbm-showcase__section-title">{title}</h2>
      <div className="bbm-showcase__panel">{children}</div>
      {SECTION_STATES[title] ? (
        <p className="bbm-showcase__states">{SECTION_STATES[title]}</p>
      ) : null}
    </section>
  )
}

export default function UiKitShowcasePage() {
  return (
    <div className="bbm-showcase">
      <Container as="main">
        <PageHeader
          title="UI-кит рабочего пространства"
          subtitle="Токены и базовые компоненты src/ui. Значения выведены из design-source/p-launcher.html и design-source/p-admin-shell.html."
        />

        {TOKEN_GROUPS.map((group) => (
          <TokenSection group={group} key={group.title} />
        ))}

        <ComponentSection title="TopBar">
          <TopBar homeHref="/p" memberName="Анна Ковалёва" />
          <div style={{ height: 'var(--bbm-space-16)' }} />
          <TopBar
            homeHref="/p"
            appName="Часы"
            memberName="Анна Ковалёва"
            switcher={<Button>Приложения ▾</Button>}
            actions={<Button variant="plain">Выйти</Button>}
          />
        </ComponentSection>

        <ComponentSection title="AppTile">
          <TileGrid>
            <AppTile
              name="Часы"
              description="Самооценка часов"
              href="/p/hours"
              status="Период «август 2026» открыт до 1 сентября"
            />
            <AppTile name="OKR" description="Цели квартала" href="/p/okr" />
            <AppTile variant="admin" name="Админка" href="/p/admin" />
            <AppTile
              variant="external"
              name="Plane"
              description="Задачи и проекты"
              href="https://plane.bbm.academy"
            />
            <AppTile variant="planned" name="Финансы" />
          </TileGrid>
        </ComponentSection>

        <ComponentSection title="PageHeader">
          <PageHeader
            title="Рабочее пространство BBM"
            subtitle="Всё, что открыто для вас сегодня."
          />
          <PageHeader
            size="md"
            title="Участники"
            subtitle="Правка записи и деактивация. Удаление не поддерживается."
          />
        </ComponentSection>

        <ComponentSection title="Button">
          <div className="bbm-showcase__row">
            <Button>Приложения ▾</Button>
            <Button variant="work">Добавить участника</Button>
            <Button variant="plain">Выйти</Button>
            <Button disabled>Недоступно</Button>
          </div>
        </ComponentSection>

        <ComponentSection title="Tag">
          <div className="bbm-showcase__row">
            <Tag>активен</Tag>
            <Tag muted>деактивирован</Tag>
            <Tag>↗ внешний</Tag>
          </div>
        </ComponentSection>

        <ComponentSection title="Eyebrow">
          <div className="bbm-showcase__row">
            <Eyebrow>Разделы</Eyebrow>
            <Eyebrow size="xs">только администратор</Eyebrow>
          </div>
        </ComponentSection>

        <ComponentSection title="Container">
          <p className="bbm-showcase__note">
            Мера рабочего пространства — 1160 px с полями по 24 px. Эта страница целиком лежит в
            нём: правый и левый край панелей выше и есть его граница.
          </p>
        </ComponentSection>
      </Container>
    </div>
  )
}
