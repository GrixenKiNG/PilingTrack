import {redirect} from 'next/navigation';

/**
 * Модуль оператора, воспроизведённый по визуализации.
 *
 * Сам модуль — самодостаточный HTML-прототип в `public/prototypes/operator-module/`:
 * плеер всех 36 экранов и презентационный борд (5 баннеров). Маршрут нужен, чтобы
 * модуль открывался из приложения по короткому адресу, а не только по пути к
 * статике. Рендер прототипа — на стороне статики Next (`public/`), сборка и живые
 * контуры (`/operator`, `/operator/v2`, `/operator/v5`) не затрагиваются.
 */
export default function OperatorModulePage() {
  redirect('/prototypes/operator-module/index.html');
}
