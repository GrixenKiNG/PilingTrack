/**
 * Право вести работу: что именно запрещает продолжать операцию.
 *
 * ЗАЧЕМ ОТДЕЛЬНО ОТ ПРЕДУПРЕЖДЕНИЙ. Предупреждение сообщает, запрет —
 * останавливает. До 19.09.2026 в продукте были только предупреждения: открытый
 * критический дефект, просроченное удостоверение и отсутствующая каска
 * подсвечивались красным и не мешали ничему. Аудит назвал это первым по
 * тяжести расхождением с требованием владельца, и владелец решил: продолжать
 * операцию нельзя, запись фактов остаётся открытой всегда.
 *
 * ЭТО РАЗНЫЕ ВЕЩИ, И В ЭТОМ ВСЯ СУТЬ. Запрещается ВЫРАБОТКА — сваи, бурение,
 * паспорт сваи: действия, которыми машина продолжает работать. Не запрещается
 * НИЧЕГО ИЗ ТОГО, ЧЕМ ЧЕЛОВЕК РАССКАЗЫВАЕТ О ПРОИСХОДЯЩЕМ: простой, дефект,
 * происшествие, осмотр, поправка к уже записанному, отчёт и закрытие смены.
 * Запрет, закрывающий журнал, учит не останавливаться, а молчать: невозможность
 * записать четыре часа простоя из-за просроченной справки не отменит простой —
 * она отменит запись о нём. Поэтому остановка бьёт по работе и никогда по
 * журналу.
 *
 * ПОЧЕМУ ПОГОДЫ ЗДЕСЬ НЕТ. Ветер и мороз приходят от внешнего сервиса по
 * координатам телефона, и сервер в момент записи выработки их не знает. Молчащий
 * или ошибшийся сервис погоды не должен уметь остановить объект — он остаётся
 * предупреждением уровня STOP в `work-warnings.ts`. Здесь только то, что
 * записано в нашей же базе и проверяемо.
 *
 * ПОЧЕМУ КРИТИЧЕСКИЙ, А НЕ ЛЮБОЙ ДЕФЕКТ. Машина с неустранённым замечанием
 * работает каждый день — это нормальная эксплуатация. Критический дефект
 * заводится тогда, когда эксплуатация запрещена; до сих пор эта запись ничего
 * не запрещала, и слово расходилось с делом.
 *
 * Чистые данные и функции: файл попадает в браузерный пакет.
 */
import type {DocumentCheck} from './operator-admission';
import {missingPpeLabels} from './ppe';

export type ProductionBlockCode =
  | 'DOCUMENT_INVALID'
  | 'PPE_MISSING'
  | 'CRITICAL_DEFECT'
  | 'STOP_INCIDENT'
  | 'EQUIPMENT_INACTIVE';

export interface ProductionBlock {
  code: ProductionBlockCode;
  title: string;
  detail: string;
  /** Что сделать, чтобы снять запрет. Действием, а не описанием состояния. */
  resolution: string;
}

export interface ProductionPermitFacts {
  documents: readonly DocumentCheck[];
  /** Коды СИЗ, которых нет — из отметки оператора за эти сутки. */
  ppeMissing: readonly string[];
  openDefects: readonly {title: string; severity: string}[];
  openIncidents: readonly {description: string; stopRequired: boolean}[];
  equipmentActive: boolean;
}

/**
 * Что запрещает выработку прямо сейчас. Пусто — работать можно.
 *
 * Порядок не случаен: сначала человек, потом машина. Оператору без
 * действующего удостоверения бесполезно чинить гидравлику.
 */
export function productionBlocks(facts: ProductionPermitFacts): ProductionBlock[] {
  const blocks: ProductionBlock[] = [];

  const invalid = facts.documents.filter(
    (document) => document.required
      && (document.verdict === 'MISSING' || document.verdict === 'EXPIRED'),
  );
  if (invalid.length > 0) {
    blocks.push({
      code: 'DOCUMENT_INVALID',
      title: 'Нет действующего допуска',
      detail: invalid
        .map((d) => `${d.name}: ${d.verdict === 'MISSING' ? 'не заведён' : 'просрочен'}`)
        .join('; '),
      resolution: 'Работать нельзя. Сообщите диспетчеру и оформите документ. Простой и происшествия записывайте как обычно.',
    });
  }

  if (facts.ppeMissing.length > 0) {
    const labels = missingPpeLabels([...facts.ppeMissing]);
    blocks.push({
      code: 'PPE_MISSING',
      title: labels.length === 1 ? 'Нет средства защиты' : `Нет средств защиты: ${labels.length}`,
      detail: labels.join(', '),
      resolution: 'Получите недостающее у мастера. Отметку о нехватке не снимайте — она и есть основание выдать.',
    });
  }

  if (!facts.equipmentActive) {
    blocks.push({
      code: 'EQUIPMENT_INACTIVE',
      title: 'Установка выведена из эксплуатации',
      detail: 'Машина отмечена как неактивная.',
      resolution: 'Уточните у диспетчера, на какой машине работать.',
    });
  }

  const critical = facts.openDefects.filter((defect) => defect.severity === 'CRITICAL');
  if (critical.length > 0) {
    blocks.push({
      code: 'CRITICAL_DEFECT',
      title: critical.length === 1
        ? 'Критическая неисправность не устранена'
        : `Критических неисправностей: ${critical.length}`,
      detail: critical.map((defect) => defect.title).join('; '),
      resolution: 'Эксплуатация запрещена до устранения. Вызовите механика, простой записывайте с причиной.',
    });
  }

  const stopping = facts.openIncidents.filter((incident) => incident.stopRequired);
  if (stopping.length > 0) {
    blocks.push({
      code: 'STOP_INCIDENT',
      title: 'Происшествие требует остановки',
      detail: stopping.map((incident) => incident.description).join('; ').slice(0, 300),
      resolution: 'Приведите машину в безопасное состояние и дождитесь разбора. Запрет снимет тот, кто разберёт происшествие.',
    });
  }

  return blocks;
}

export interface ProductionPermit {
  allowed: boolean;
  blocks: ProductionBlock[];
}

export function productionPermit(facts: ProductionPermitFacts): ProductionPermit {
  const blocks = productionBlocks(facts);
  return {allowed: blocks.length === 0, blocks};
}

/** Одной строкой — для отказа сервера и заголовка на экране. */
export function productionRefusal(blocks: readonly ProductionBlock[]): string {
  return blocks.map((block) => block.title).join('; ');
}
