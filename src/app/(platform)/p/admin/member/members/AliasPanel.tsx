'use client'

import React from 'react'

import { memberAliasSchema, type MemberAliasInput, type MemberAliasRecord } from '@/lib/member'
import { Alert, AlertDescription } from '@/ui/alert'
import { Badge } from '@/ui/badge'
import { Button } from '@/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/ui/card'
import { Input } from '@/ui/input'
import { Label } from '@/ui/label'
import { Skeleton } from '@/ui/skeleton'
import { Textarea } from '@/ui/textarea'

interface AliasEnvelope {
  data?: unknown
  error?: { message?: unknown }
}

function aliasesUrl(memberId: number, aliasId?: number): string {
  const root = `/api/p/member/admin/members/${memberId}/aliases`
  return aliasId === undefined ? root : `${root}/${aliasId}`
}

async function responseBody(response: Response): Promise<AliasEnvelope> {
  try {
    return (await response.json()) as AliasEnvelope
  } catch {
    return {}
  }
}

function refusal(response: Response, body: AliasEnvelope): string {
  return typeof body.error?.message === 'string' && body.error.message.trim()
    ? body.error.message
    : `Запрос алиасов отклонён (HTTP ${response.status}).`
}

export function AliasPanel({ memberId, editable }: { memberId: number; editable: boolean }) {
  const [aliases, setAliases] = React.useState<MemberAliasRecord[]>([])
  const [loading, setLoading] = React.useState(true)
  const [pending, setPending] = React.useState(false)
  const [failure, setFailure] = React.useState<string>()
  const [editing, setEditing] = React.useState<MemberAliasRecord | null>(null)
  const [adding, setAdding] = React.useState(false)

  React.useEffect(() => {
    let cancelled = false
    void fetch(aliasesUrl(memberId), { headers: { accept: 'application/json' } })
      .then(async (response) => ({ response, body: await responseBody(response) }))
      .then(({ response, body }) => {
        if (!response.ok) throw new Error(refusal(response, body))
        const parsed = memberAliasSchema.array().safeParse(body.data)
        if (!parsed.success) throw new Error('Ответ алиасов не соответствует схеме модуля.')
        if (!cancelled) setAliases(parsed.data)
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setFailure(error instanceof Error ? error.message : 'Не удалось прочитать алиасы.')
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
      const response = await fetch(aliasesUrl(memberId, editing?.id), {
        method: editing ? 'PATCH' : 'POST',
        headers: { accept: 'application/json', 'content-type': 'application/json' },
        body: JSON.stringify(alias),
      })
      const body = await responseBody(response)
      if (!response.ok) throw new Error(refusal(response, body))
      const parsed = memberAliasSchema.safeParse(body.data)
      if (!parsed.success) throw new Error('Сохранённый алиас не соответствует схеме модуля.')
      setAliases((current) =>
        editing
          ? current.map((item) => (item.id === parsed.data.id ? parsed.data : item))
          : [...current, parsed.data],
      )
      setAdding(false)
      setEditing(null)
    } catch (error) {
      setFailure(error instanceof Error ? error.message : 'Не удалось сохранить алиас.')
    } finally {
      setPending(false)
    }
  }

  async function remove(alias: MemberAliasRecord) {
    setPending(true)
    setFailure(undefined)
    try {
      const response = await fetch(aliasesUrl(memberId, alias.id), {
        method: 'DELETE',
        headers: { accept: 'application/json' },
      })
      const body = await responseBody(response)
      if (!response.ok) throw new Error(refusal(response, body))
      setAliases((current) => current.filter((item) => item.id !== alias.id))
      if (editing?.id === alias.id) setEditing(null)
    } catch (error) {
      setFailure(error instanceof Error ? error.message : 'Не удалось удалить алиас.')
    } finally {
      setPending(false)
    }
  }

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
                      onClick={() => void remove(alias)}
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
        {editable && (adding || editing) ? (
          <AliasForm
            initial={editing ?? undefined}
            pending={pending}
            onCancel={() => {
              setAdding(false)
              setEditing(null)
            }}
            onSave={(value) => void save(value)}
          />
        ) : null}
      </CardContent>
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
  const [kind, setKind] = React.useState(initial?.kind ?? '')
  const [value, setValue] = React.useState(initial?.value ?? '')
  const [note, setNote] = React.useState(initial?.note ?? '')
  const [validation, setValidation] = React.useState<string>()

  function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!/^[a-z][a-z0-9_]*$/.test(kind.trim())) {
      setValidation('Тип алиаса должен быть в lower_snake_case.')
      return
    }
    if (!value.trim()) {
      setValidation('Укажите значение алиаса.')
      return
    }
    setValidation(undefined)
    onSave({ kind: kind.trim(), value: value.trim(), note: note.trim() || null })
  }

  return (
    <form className="space-y-4 rounded-md border p-4" onSubmit={submit} noValidate>
      {validation ? <p className="text-sm text-destructive">{validation}</p> : null}
      <div className="grid gap-2">
        <Label htmlFor="alias-kind">Тип алиаса</Label>
        <Input
          id="alias-kind"
          value={kind}
          disabled={pending}
          placeholder="mattermost"
          onChange={(event) => setKind(event.target.value)}
        />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="alias-value">Значение алиаса</Label>
        <Input
          id="alias-value"
          value={value}
          disabled={pending}
          onChange={(event) => setValue(event.target.value)}
        />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="alias-note">Примечание</Label>
        <Textarea
          id="alias-note"
          value={note}
          disabled={pending}
          onChange={(event) => setNote(event.target.value)}
        />
      </div>
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? 'Сохраняем…' : 'Сохранить алиас'}
        </Button>
        <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={onCancel}>
          Отмена
        </Button>
      </div>
    </form>
  )
}
