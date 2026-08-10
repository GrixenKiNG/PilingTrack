import { HardHat } from '@/components/piling/icons/unified-icons';
import { Skeleton } from '@/components/ui/skeleton';

export default function Loading() {
  return (
    <div className="min-h-screen bg-muted">
      <div className="sticky top-0 z-30 border-b bg-card pt-safe">
        <div className="flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-signal">
              <HardHat className="h-4 w-4 text-white" />
            </div>
            <div>
              <p className="text-sm font-bold text-foreground">PilingTrack</p>
              <p className="text-3xs text-muted-foreground">Загрузка приложения...</p>
            </div>
          </div>

          <Skeleton className="h-8 w-20 rounded-full bg-muted" />
        </div>
      </div>

      <main className="mx-auto max-w-7xl space-y-6 p-4 lg:p-6">
        <section className="space-y-2">
          <Skeleton className="h-8 w-56 bg-muted" />
          <Skeleton className="h-4 w-72 bg-muted" />
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

        <section className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          {Array.from({ length: 2 }).map((_, index) => (
            <div
              key={index}
              className="rounded-2xl border border-border bg-card p-5 shadow-sm"
            >
              <Skeleton className="mb-4 h-5 w-44 bg-muted" />
              <div className="space-y-3">
                {Array.from({ length: 4 }).map((__, rowIndex) => (
                  <div key={rowIndex} className="flex items-center justify-between gap-4">
                    <Skeleton className="h-4 w-40 bg-muted" />
                    <Skeleton className="h-4 w-16 bg-muted" />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </section>
      </main>
    </div>
  );
}
