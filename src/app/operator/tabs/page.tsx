import {redirect} from 'next/navigation';

/**
 * Модуль оператора — все вкладки.
 *
 * Раздел отдаёт статический HTML-прототип из `public/prototypes/operator-tabs/`:
 * экран машиниста, собранный по визуализации «Все вкладки оператора» (9 экранов;
 * без «Паспорта сваи»; «Передача смены» → «Закрытие смены» без подписей).
 * Живой контур смены остаётся на `/operator`, `/operator/v2` и `/operator/v5`.
 */
export default function OperatorTabsPage() {
  redirect('/prototypes/operator-tabs/index.html');
}
