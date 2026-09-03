import { z } from 'zod'

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

/**
 * The member profile form's shape and its rules, in ONE place.
 *
 * Before #434 the same rules lived twice: as `MemberFormValue` (a hand-written
 * interface) and as an `if` ladder inside `MemberForm.submit` that pushed
 * Russian sentences into a `useState<string[]>`. The schema is now the single
 * source — `zodResolver` gives react-hook-form the validation, `z.infer` gives
 * TypeScript the type, and the messages below are what `<FormMessage>` renders
 * under the field that is actually wrong instead of in a summary Alert above
 * the form.
 *
 * It deliberately does NOT reuse the zod schemas of `@/lib/member`: these
 * screens are client components, and `member-admin-client-boundary.spec.ts`
 * holds them to `import type` only from that module (a value import would drag
 * the server contract into the browser bundle).
 */
export const memberFormSchema = z.object({
  name: z.string().trim().min(1, 'Укажите имя.'),
  email: z
    .string()
    .trim()
    .regex(/^\S+@\S+\.\S+$/, 'Укажите корректный email.'),
  role: z.string(),
  timezone: z.string().trim().min(1, 'Укажите часовой пояс.'),
  status: z.enum(['active', 'inactive']),
})

export type MemberFormValue = z.infer<typeof memberFormSchema>

/** The alias sub-form of the member record screen — same reasoning as above. */
export const aliasFormSchema = z.object({
  kind: z.string().min(1, 'Выберите тип алиаса.'),
  value: z.string().trim().min(1, 'Укажите значение алиаса.'),
  note: z.string(),
})

export type AliasFormValue = z.infer<typeof aliasFormSchema>
