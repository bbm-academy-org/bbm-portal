import { Card, CardContent, CardHeader } from '@/ui/card'
import { Skeleton } from '@/ui/skeleton'

export default function FinanceLoading() {
  return (
    <section aria-label="Загружаем финансы" className="space-y-6">
      <div className="space-y-2">
        <Skeleton className="h-8 w-36" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>
      <Card>
        <CardHeader className="gap-2">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-4 w-72 max-w-full" />
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            {['one', 'two', 'three', 'total'].map((tile) => (
              <Card key={tile} size="sm" className="min-w-0">
                <CardContent className="space-y-2">
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-6 w-32" />
                </CardContent>
              </Card>
            ))}
          </div>
        </CardContent>
      </Card>
    </section>
  )
}
