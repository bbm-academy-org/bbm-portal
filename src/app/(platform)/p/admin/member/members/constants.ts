import type { DocumentedAliasKind } from '@/lib/member'

export const MEMBER_RESOURCE = 'member.members'

const aliasKindLabels = {
  phone: 'Телефон',
  telegram: 'Telegram',
  instagram: 'Instagram',
  mattermost_id: 'Mattermost — логин',
  mattermost_email: 'Mattermost — email',
  zoom_id: 'Zoom — идентификатор',
  email_personal: 'Личный email',
} as const satisfies Record<DocumentedAliasKind, string>

export const MEMBER_ALIAS_KIND_OPTIONS = Object.entries(aliasKindLabels).map(([value, label]) => ({
  value: value as DocumentedAliasKind,
  label,
}))

export const MEMBER_TIMEZONE_OPTIONS = [
  { value: 'Europe/Kaliningrad', label: 'Калининград — Europe/Kaliningrad' },
  { value: 'Europe/Moscow', label: 'Москва — Europe/Moscow' },
  { value: 'Europe/Samara', label: 'Самара — Europe/Samara' },
  { value: 'Asia/Yekaterinburg', label: 'Екатеринбург — Asia/Yekaterinburg' },
  { value: 'Asia/Omsk', label: 'Омск — Asia/Omsk' },
  { value: 'Asia/Novosibirsk', label: 'Новосибирск — Asia/Novosibirsk' },
  { value: 'Asia/Krasnoyarsk', label: 'Красноярск — Asia/Krasnoyarsk' },
  { value: 'Asia/Irkutsk', label: 'Иркутск — Asia/Irkutsk' },
  { value: 'Asia/Yakutsk', label: 'Якутск — Asia/Yakutsk' },
  { value: 'Asia/Vladivostok', label: 'Владивосток — Asia/Vladivostok' },
  { value: 'Asia/Magadan', label: 'Магадан — Asia/Magadan' },
  { value: 'Asia/Kamchatka', label: 'Камчатка — Asia/Kamchatka' },
  { value: 'Asia/Bangkok', label: 'Бангкок — Asia/Bangkok' },
  { value: 'Asia/Tbilisi', label: 'Тбилиси — Asia/Tbilisi' },
] as const

export type ReferenceOption = { value: string; label: string }

export function withSavedReference(
  options: readonly ReferenceOption[],
  value: string,
  savedLabel: string,
): readonly ReferenceOption[] {
  if (!value || options.some((option) => option.value === value)) return options
  return [...options, { value, label: `${savedLabel} — ${value}` }]
}

export function errorMessage(error: unknown, fallback: string): string {
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const message = (error as { message?: unknown }).message
    if (typeof message === 'string' && message.trim()) return message
  }
  return fallback
}
