'use client';

import {Button} from '@/components/ui/button';

export default function OperatorV3Error({reset}: {error: Error & {digest?: string}; reset: () => void}) {
  return <main className="mx-auto min-h-[60dvh] max-w-7xl px-4 py-6"><section role="alert" className="rounded-xl border border-destructive/40 bg-destructive/5 p-5"><h1 className="text-lg font-semibold">Не удалось открыть смену оператора</h1><p className="mt-2 text-sm text-muted-foreground">Обновите данные или повторите попытку позже</p><Button className="mt-4" onClick={reset}>Повторить</Button></section></main>;
}
