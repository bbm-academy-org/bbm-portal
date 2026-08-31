import { Card, CardContent, CardHeader } from '@/ui/card'
import { Skeleton } from '@/ui/skeleton'

export default function FinanceLoading() {
  return (
    <section aria-label="Загружаем финансы" className="space-y-6">
      <div className="space-y-2">
        <Skeleton className="h-8 w-36" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>

      <Card className="bg-primary">
        <CardHeader>
          <div className="flex items-center justify-between gap-2">
            <Skeleton className="h-4 w-16 bg-primary-foreground/20" />
            <Skeleton className="h-7 w-14 bg-primary-foreground/20" />
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <Skeleton className="h-10 w-56 max-w-full bg-primary-foreground/20" />
          <Skeleton className="h-4 w-72 max-w-full bg-primary-foreground/20" />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="gap-2">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-4 w-72 max-w-full" />
        </CardHeader>
        <CardContent>
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            {['one', 'two', 'three', 'four'].map((tile) => (
              <div
                key={tile}
                className="min-w-0 space-y-1 rounded-lg px-3 py-2.5 ring-1 ring-foreground/10"
              >
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-6 w-28" />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </section>
  )
}
