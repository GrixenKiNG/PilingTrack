/**
 * Благодарность машинисту после закрытия смены (владелец 16.10.2026).
 *
 * Один блок на все версии рабочего места: раньше закрытая смена сообщала только
 * «Смена закрыта», а в v2 — мелкое «Спасибо!». Слова благодарности — часть
 * продукта, поэтому текст живёт здесь, а не в пяти экранах отдельно.
 */

/**
 * «Имя Отчество» из полного имени «Фамилия Имя Отчество», либо null.
 *
 * ПОЧЕМУ ОСТОРОЖНО. В базе имена бывают разные: «Герасимова ЕА», «Иванов И.П.»,
 * «QA_AUDIT Машинист». Обратиться «Герасимова ЕА» к человеку — хуже, чем не
 * обратиться вовсе. Поэтому берём имя только из трёх слов, где последнее
 * похоже на отчество; во всех остальных случаях благодарим без имени.
 */
export function thanksAddress(fullName: string | null | undefined): string | null {
  const words = (fullName ?? '').trim().split(/\s+/).filter(Boolean);
  if (words.length !== 3) return null;
  const [, first, patronymic] = words;
  if (!first || !patronymic || !/(?:вич|вна|ична|мич)$/i.test(patronymic)) return null;
  return `${first} ${patronymic}`;
}

export function ShiftThanks({operatorName, reportSent = true}: {
  operatorName?: string | null;
  /**
   * Сервер подтвердил приём отчёта. Пока нет — не обещаем, что он «ушёл»:
   * благодарность остаётся, а про диспетчера не сказано ничего.
   */
  reportSent?: boolean;
}) {
  const address = thanksAddress(operatorName);
  const closed = reportSent ? 'смена закрыта, отчёт ушёл диспетчеру' : 'смена закрыта';
  const line = address
    ? `${address}, ${closed}. Хорошего отдыха.`
    : `${closed[0]?.toUpperCase() ?? ''}${closed.slice(1)}. Хорошего отдыха.`;

  return (
    <div role="status" className="rounded-2xl border border-success/25 bg-success/10 px-4 py-5 text-center">
      <div
        aria-hidden="true"
        className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full border-2 border-success bg-card text-2xl font-bold text-success"
      >
        ✓
      </div>
      <p className="text-2xl font-semibold leading-tight text-success-strong">Спасибо за работу!</p>
      <p className="mt-2 text-sm text-foreground/80">{line}</p>
    </div>
  );
}
