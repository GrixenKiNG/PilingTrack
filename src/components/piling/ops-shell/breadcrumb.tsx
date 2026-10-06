'use client';

import Link from 'next/link';

export interface OpsCrumb {
  label: string;
  /** Ссылка на раздел; у текущего экрана её нет. */
  href?: string;
}

/**
 * Хлебные крошки вложенного экрана: «Раздел → Текущий».
 *
 * Вложенный экран показывал одну ссылку «← К списку установок» — при переходе
 * по прямой ссылке или из уведомления человек не видел, где он и как подняться
 * выше одного уровня. Промежуточные уровни на узком экране сворачиваются до
 * «…»: путь остаётся виден, но строка не распирает телефон.
 */
export function OpsBreadcrumb({ items }: { items: OpsCrumb[] }) {
  if (items.length === 0) return null;

  const [first, ...rest] = items;
  const middle = rest.slice(0, -1);
  const last = rest[rest.length - 1];

  const crumb = (item: OpsCrumb, className: string) => (
    item.href
      ? (
        <Link
          key={item.label}
          href={item.href}
          className={`inline-flex min-h-11 items-center sm:min-h-0 ${className} hover:text-foreground`}
        >
          {item.label}
        </Link>
      )
      : <span key={item.label} className={className}>{item.label}</span>
  );

  return (
    <nav aria-label="Путь к экрану" className="mb-3 flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
      {crumb(first, '')}
      {middle.length > 0 && <span aria-hidden="true" className="sm:hidden">→ …</span>}
      {middle.map((item) => (
        <span key={item.label} className="hidden items-center gap-1 sm:inline-flex">
          <span aria-hidden="true">→</span>
          {crumb(item, '')}
        </span>
      ))}
      {last && (
        <>
          <span aria-hidden="true">→</span>
          <span aria-current="page" className="font-medium text-foreground">{last.label}</span>
        </>
      )}
    </nav>
  );
}