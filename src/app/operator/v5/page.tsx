import type {Metadata} from 'next';
import {Oswald, PT_Sans} from 'next/font/google';
import {OperatorV5App} from '@/components/piling/operator-v5/operator-v5-app';
import {DeviceFrame} from '@/components/piling/operator-mobile/v7/device-frame';
import './operator-v5-screens.css';
import './operator-v5-app.css';

/*
 * Шрифты макета. `--font-jetbrains` уже объявлен корневой раскладкой, здесь
 * добавляются два недостающих семейства. next/font скачивает файлы на этапе
 * сборки и раздаёт со своего домена: ссылку на fonts.googleapis.com, как в
 * исходном HTML, срезал бы CSP из `src/proxy.ts`.
 */
const oswald = Oswald({subsets: ['latin', 'cyrillic'], weight: ['400', '500', '600'], variable: '--font-oswald', display: 'swap'});
const ptSans = PT_Sans({subsets: ['latin', 'cyrillic'], weight: ['400', '700'], variable: '--font-pt-sans', display: 'swap'});

export const metadata: Metadata = {title: 'Смена оператора'};

/**
 * Мобильное рабочее место оператора по макету
 * `docs/product/operator-v1-screens.html`: тридцать четыре экрана восьми фаз,
 * по которым можно пройти смену от входа по коду до закрытия.
 *
 * Это прототип. Данные в нём те же, что в макете (Сидоров А. В., Liebherr
 * LRH 100, наряд № 118), к снимку рабочего места он не подключён. Экран на
 * живых данных — `/operator`.
 *
 * Маршрут намеренно лежит вне группы `(app)`: её раскладка добавляет шапку и
 * собственную нижнюю навигацию, а у макета своя — `.dock` внутри экрана.
 */
export default function OperatorV5Page() {
  return (
    <DeviceFrame>
      <div className={`v5 ${oswald.variable} ${ptSans.variable}`}>
        <OperatorV5App />
      </div>
    </DeviceFrame>
  );
}
