import { Skeleton } from '@/components/ui/skeleton';

/**
 * Загрузка раздела внутри оболочки. Файл лежит в сегменте `(app)`, поэтому
 * рендерится в области содержимого `(app)/layout.tsx`: боковое меню, шапка и
 * нижняя навигация остаются на месте, подменяется только сам раздел. Корневой
 * `src/app/loading.tsx` при этом больше не всплывает на переходы внутри
 * приложения (механика Next: запасной экран сегмента берётся у ближайшего
 * родителя, у которого он объявлен).
 */
export default function Loading() {
  return (
    <div className="mx-auto max-w-7xl space-y-6 p-4 lg:p-6" aria-busy="true">
      <section className="space-y-2">
        <Skeleton className="h-8 w-56 bg-muted" />
        <Skeleton className="h-4 w-72 bg-muted" />
        <p className="text-3xs text-muted-foreground">Загрузка раздела...</p>
      </section>

      <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <div
            key={index}
            className="rounded-2xl border border-border bg-card p-5 shadow-sm"
          >
            <div className="mb-4 flex items-center gap-2">
              <Skeleton className="h-9 w-9 rounded-xl bg-signal/10" />
              <Skeleton className="h-4 w-24 bg-muted" />
            </div>
            <Skeleton className="h-8 w-16 bg-muted" />
            <Skeleton className="mt-3 h-3 w-28 bg-muted" />
          </div>
        ))}
      </section>

      <section className="rounded-2xl border border-border bg-card p-5 shadow-sm">
        <div className="mb-5 flex items-center justify-between gap-4">
          <Skeleton className="h-5 w-40 bg-muted" />
          <Skeleton className="h-4 w-24 bg-muted" />
        </div>

        <div className="space-y-4">
          {Array.from({ length: 3 }).map((_, index) => (
            <div key={index} className="space-y-2">
              <div className="flex items-center justify-between gap-4">
                <Skeleton className="h-4 w-28 bg-muted" />
                <Skeleton className="h-4 w-20 bg-muted" />
              </div>
              <Skeleton className="h-3 w-full rounded-full bg-muted" />
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}