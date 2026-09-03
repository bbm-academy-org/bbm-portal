'use client'

import { zodResolver } from '@hookform/resolvers/zod'
import React from 'react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'

import type { MemberAliasInput, MemberAliasRecord } from '@/lib/member'
import { createModuleApiClient } from '@/lib/platform/cabinet'
import { Alert, AlertDescription } from '@/ui/alert'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/ui/alert-dialog'
import { Badge } from '@/ui/badge'
import { Button } from '@/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/ui/dialog'
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/ui/form'
import { Input } from '@/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/select'
import { Skeleton } from '@/ui/skeleton'
import { Textarea } from '@/ui/textarea'

import { validateAliasResponse } from './alias-actions'
import {
  aliasFormSchema,
  errorMessage,
  MEMBER_ALIAS_KIND_OPTIONS,
  withSavedReference,
  type AliasFormValue,
} from './constants'

const aliasClient = createModuleApiClient({ validateResponse: validateAliasResponse })
const ALIAS_RESOURCE = 'member.aliases'

function aliasesUrl(memberId: number, aliasId?: number): string {
  const root = `/member/admin/members/${memberId}/aliases`
  return aliasId === undefined ? root : `${root}/${aliasId}`
}

/**
 * A member's external identifiers (#316), rebuilt on the kit's blocks (#434).
 *
 * COMPOSITION (the agent's call, owner ruling 2026-09-02). The panel's job is
 * to be READ — «which Mattermost login is this person?» — so the list stays
 * the whole panel and editing no longer grows an inline form underneath it that
 * pushes the list down and leaves the reader unsure which row is being edited.
 * Add and edit both open a `Dialog` titled with the act; the list underneath is
 * unchanged while it is open, so the row being edited stays visible behind it.
 *
 * DESTRUCTIVE ACTS ARE CONFIRMED. Deleting an alias used to happen on a single
 * click of a ghost button sitting next to «Изменить», with no undo anywhere in
 * the module. It now goes through an `AlertDialog` that names the value being
 * removed — the smallest thing that turns a misclick into a question.
 *
 * FEEDBACK. This panel talks to its module API directly rather than through
 * Refine, so it raises its own toasts on the same sonner channel the shell's
 * notification provider uses. A read failure stays inline: with nothing else in
 * the panel to look at, a toast that fades would leave an empty card.
 */
export function AliasPanel({ memberId, editable }: { memberId: number; editable: boolean }) {
  const [aliases, setAliases] = React.useState<MemberAliasRecord[]>([])
  const [loading, setLoading] = React.useState(true)
  const [pending, setPending] = React.useState(false)
  const [failure, setFailure] = React.useState<string>()
  const [editing, setEditing] = React.useState<MemberAliasRecord | null>(null)
  const [adding, setAdding] = React.useState(false)
  const [removing, setRemoving] = React.useState<MemberAliasRecord | null>(null)

  React.useEffect(() => {
    let cancelled = false
    void aliasClient
      .list<MemberAliasRecord>({ resource: ALIAS_RESOURCE, path: aliasesUrl(memberId) })
      .then(({ data }) => {
        if (!cancelled) setAliases(data)
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setFailure(errorMessage(error, 'Не удалось прочитать алиасы.'))
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [memberId])

  async function save(alias: MemberAliasInput) {
    setPending(true)
    setFailure(undefined)
    try {
      const saved = await aliasClient.one<MemberAliasRecord>({
        resource: ALIAS_RESOURCE,
        path: aliasesUrl(memberId, editing?.id),
        init: {
          method: editing ? 'PATCH' : 'POST',
          body: JSON.stringify(alias),
        },
      })
      setAliases((current) =>
        editing
          ? current.map((item) => (item.id === saved.id ? saved : item))
          : [...current, saved],
      )
      setAdding(false)
      setEditing(null)
      toast.success('Алиас сохранён.', { description: saved.value, richColors: true })
    } catch (error) {
      const message = errorMessage(error, 'Не удалось сохранить алиас.')
      setFailure(message)
      toast.error('Не удалось сохранить алиас.', { description: message, richColors: true })
    } finally {
      setPending(false)
    }
  }

  async function remove(alias: MemberAliasRecord) {
    setPending(true)
    setFailure(undefined)
    try {
      await aliasClient.one<MemberAliasRecord>({
        resource: ALIAS_RESOURCE,
        path: aliasesUrl(memberId, alias.id),
        init: { method: 'DELETE' },
      })
      setAliases((current) => current.filter((item) => item.id !== alias.id))
      if (editing?.id === alias.id) setEditing(null)
      toast.success('Алиас удалён.', { description: alias.value, richColors: true })
    } catch (error) {
      const message = errorMessage(error, 'Не удалось удалить алиас.')
      setFailure(message)
      toast.error('Не удалось удалить алиас.', { description: message, richColors: true })
    } finally {
      setPending(false)
      setRemoving(null)
    }
  }

  const dialogOpen = editable && (adding || editing !== null)

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-4">
        <div>
          <CardTitle>
            <h2>Алиасы</h2>
          </CardTitle>
          <CardDescription>Идентификаторы участника во внешних системах.</CardDescription>
        </div>
        {editable ? (
          <Button
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() => {
              setEditing(null)
              setAdding(true)
            }}
          >
            Добавить алиас
          </Button>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-4">
        {failure ? (
          <Alert variant="destructive" role="alert">
            <AlertDescription>{failure}</AlertDescription>
          </Alert>
        ) : null}
        {loading ? (
          <div className="space-y-3" aria-label="Загружаем алиасы">
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-14 w-full" />
          </div>
        ) : aliases.length === 0 ? (
          <p className="text-sm text-muted-foreground">Алиасов пока нет</p>
        ) : (
          <ul className="divide-y rounded-md border">
            {aliases.map((alias) => (
              <li key={alias.id} className="flex flex-wrap items-center gap-3 p-3">
                <Badge variant="outline">{alias.kind}</Badge>
                <span className="min-w-0 flex-1 break-all text-sm">{alias.value}</span>
                {editable ? (
                  <div className="flex gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={pending}
                      aria-label={`Изменить алиас ${alias.value}`}
                      onClick={() => {
                        setAdding(false)
                        setEditing(alias)
                      }}
                    >
                      Изменить
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={pending}
                      aria-label={`Удалить алиас ${alias.value}`}
                      onClick={() => setRemoving(alias)}
                    >
                      Удалить
                    </Button>
                  </div>
                ) : null}
                {alias.note ? (
                  <p className="basis-full text-xs text-muted-foreground">{alias.note}</p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </CardContent>

      <Dialog
        open={dialogOpen}
        onOpenChange={(open) => {
          if (!open) {
            setAdding(false)
            setEditing(null)
          }
        }}
      >
        <DialogContent data-bbm-ui className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? 'Изменить алиас' : 'Новый алиас'}</DialogTitle>
            <DialogDescription>
              Идентификатор участника в одной внешней системе. Тип и значение обязательны.
            </DialogDescription>
          </DialogHeader>
          <AliasForm
            key={editing ? `edit-${editing.id}` : 'add'}
            initial={editing ?? undefined}
            pending={pending}
            onCancel={() => {
              setAdding(false)
              setEditing(null)
            }}
            onSave={(value) => void save(value)}
          />
        </DialogContent>
      </Dialog>

      <AlertDialog open={removing !== null} onOpenChange={(open) => !open && setRemoving(null)}>
        <AlertDialogContent data-bbm-ui>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить алиас?</AlertDialogTitle>
            <AlertDialogDescription>
              {removing
                ? `${removing.value} перестанет связывать участника с внешней системой. Действие необратимо.`
                : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Отмена</AlertDialogCancel>
            <AlertDialogAction
              disabled={pending}
              onClick={(event) => {
                event.preventDefault()
                if (removing) void remove(removing)
              }}
            >
              Удалить алиас
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  )
}

function AliasForm({
  initial,
  pending,
  onSave,
  onCancel,
}: {
  initial?: MemberAliasRecord
  pending: boolean
  onSave: (value: MemberAliasInput) => void
  onCancel: () => void
}) {
  const form = useForm<AliasFormValue>({
    resolver: zodResolver(aliasFormSchema),
    defaultValues: {
      kind: initial?.kind ?? '',
      value: initial?.value ?? '',
      note: initial?.note ?? '',
    },
    mode: 'onSubmit',
  })
  const kind = form.watch('kind')
  const kindOptions = withSavedReference(MEMBER_ALIAS_KIND_OPTIONS, kind, 'Сохранённый тип')

  function submit(value: AliasFormValue) {
    onSave({ kind: value.kind.trim(), value: value.value.trim(), note: value.note.trim() || null })
  }

  return (
    <Form {...form}>
      <form className="space-y-4" onSubmit={form.handleSubmit(submit)} noValidate>
        <FormField
          control={form.control}
          name="kind"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Тип алиаса</FormLabel>
              <Select value={field.value} disabled={pending} onValueChange={field.onChange}>
                <FormControl>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Выберите тип алиаса" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent data-bbm-ui>
                  {kindOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="value"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Значение алиаса</FormLabel>
              <FormControl>
                <Input {...field} disabled={pending} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="note"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Примечание</FormLabel>
              <FormControl>
                <Textarea {...field} disabled={pending} />
              </FormControl>
              <FormDescription>Необязательно — зачем этот идентификатор нужен.</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        <DialogFooter>
          <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={onCancel}>
            Отмена
          </Button>
          <Button type="submit" size="sm" disabled={pending}>
            {pending ? 'Сохраняем…' : 'Сохранить алиас'}
          </Button>
        </DialogFooter>
      </form>
    </Form>
  )
}
