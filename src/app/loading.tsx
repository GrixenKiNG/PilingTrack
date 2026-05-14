import { HardHat } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';

export default function Loading() {
  return (
    <div className="min-h-screen bg-slate-50">
      <div className="sticky top-0 z-30 border-b bg-white pt-safe">
        <div className="flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-orange-500">
              <HardHat className="h-4 w-4 text-white" />
            </div>
            <div>
              <p className="text-sm font-bold text-slate-900">PilingTrack</p>
              <p className="text-[10px] text-slate-500">Загрузка приложения...</p>
            </div>
          </div>

          <Skeleton className="h-8 w-20 rounded-full bg-slate-200" />
        </div>
      </div>

      <main className="mx-auto max-w-7xl space-y-6 p-4 lg:p-6">
        <section className="space-y-2">
          <Skeleton className="h-8 w-56 bg-slate-200" />
          <Skeleton className="h-4 w-72 bg-slate-200" />
        </section>

        <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <div
              key={index}
              className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
            >
              <div className="mb-4 flex items-center gap-2">
                <Skeleton className="h-9 w-9 rounded-xl bg-orange-100" />
                <Skeleton className="h-4 w-24 bg-slate-200" />
              </div>
              <Skeleton className="h-8 w-16 bg-slate-200" />
              <Skeleton className="mt-3 h-3 w-28 bg-slate-200" />
            </div>
          ))}
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-5 flex items-center justify-between gap-4">
            <Skeleton className="h-5 w-40 bg-slate-200" />
            <Skeleton className="h-4 w-24 bg-slate-200" />
          </div>

          <div className="space-y-4">
            {Array.from({ length: 3 }).map((_, index) => (
              <div key={index} className="space-y-2">
                <div className="flex items-center justify-between gap-4">
                  <Skeleton className="h-4 w-28 bg-slate-200" />
                  <Skeleton className="h-4 w-20 bg-slate-200" />
                </div>
                <Skeleton className="h-3 w-full rounded-full bg-slate-200" />
              </div>
            ))}
          </div>
        </section>

        <section className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          {Array.from({ length: 2 }).map((_, index) => (
            <div
              key={index}
              className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
            >
              <Skeleton className="mb-4 h-5 w-44 bg-slate-200" />
              <div className="space-y-3">
                {Array.from({ length: 4 }).map((__, rowIndex) => (
                  <div key={rowIndex} className="flex items-center justify-between gap-4">
                    <Skeleton className="h-4 w-40 bg-slate-200" />
                    <Skeleton className="h-4 w-16 bg-slate-200" />
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
