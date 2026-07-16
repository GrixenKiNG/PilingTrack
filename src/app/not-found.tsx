import Link from 'next/link';
import { HardHat, ArrowLeft } from '@/components/piling/icons/unified-icons';

/**
 * Русская страница 404 в стиле приложения. Заменяет дефолтную англоязычную
 * «This page could not be found.» из Next.js.
 */
export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-background px-6 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-orange-100 text-orange-600">
        <HardHat className="h-8 w-8" />
      </div>
      <p className="mt-6 font-mono text-5xl font-bold text-slate-900">404</p>
      <h1 className="mt-2 text-lg font-semibold text-slate-800">Страница не найдена</h1>
      <p className="mt-1 max-w-sm text-sm text-slate-500">
        Такой страницы нет или она была перемещена. Проверьте адрес или вернитесь на главную.
      </p>
      <Link
        href="/"
        className="mt-6 inline-flex h-11 items-center gap-2 rounded-lg bg-orange-600 px-5 text-sm font-semibold text-white transition-colors hover:bg-orange-700"
      >
        <ArrowLeft className="h-4 w-4" />
        На главную
      </Link>
    </main>
  );
}
