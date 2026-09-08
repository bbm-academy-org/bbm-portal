import { Skeleton } from '@/ui/skeleton'

export default function RequestsLoading() {
  return (
    <section aria-label="Загружаем заявки" className="space-y-6">
      <div className="space-y-2">
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
      <Skeleton className="h-9 w-72 max-w-full" />
      <div className="grid gap-3 lg:grid-cols-4">
        {['submitted', 'approved', 'posted', 'refused'].map((column) => (
          <Skeleton key={column} className="h-64 w-full" />
        ))}
      </div>
    </section>
  )
}
