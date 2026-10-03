/**
 * Общая фабрика состояния смены для тестов экрана машиниста v1 (F-R90-TEST-FIXTURE).
 *
 * Фикстура `workState` была целиком скопирована в `operator-mobile-app.test.tsx`
 * и `queue-flow.test.tsx` и отличалась одним-двумя полями. Две копии одного
 * контракта `OperatorMobileState` расходятся молча: новое обязательное поле
 * состояния приходится добавлять в оба литерала, а расхождение обнаруживается
 * только упавшим тестом. Здесь база одна, отличия сценария задаются через
 * `overrides` в самом тесте.
 *
 * Файл НЕ тестовый: ни `describe`, ни `it`, имя не `*.test.*` — поэтому vitest
 * его не собирает (`vitest.config.ts`, ключ `include`).
 */
import type {OperatorMobileState} from '@/modules/operator-mobile/contracts';

/**
 * Состояние смены в фазе работы (как его видит открытый рабочий экран).
 *
 * Приведение через `unknown` — так же, как в исходных копиях: фикстура
 * описывает только читаемые тестами поля, а не весь контракт целиком.
 */
const baseWorkState = {
  phase: 'WORK',
  productionDate: '2026-09-20',
  shift: {id: 'shift-1', productionDate: '2026-09-20'},
  assignment: {equipmentId: 'eq-1', equipmentName: 'Установка 12', siteName: 'Площадка А', lastMeter: null},
  identity: {
    ppe: {confirmed: true, missing: []},
    briefing: {ok: true, acknowledgedAt: '2026-09-20T05:00:00.000Z'},
    knowledge: {ok: true}, documents: [],
  },
  checklists: ['PRESHIFT_INSPECTION', 'SITE_READY', 'EO_BEFORE'].map((stage) => ({stage, done: true})),
  permit: {allowed: true, blocks: []},
  dictionaries: {pileGrades: [], drillingTypes: [], downtimeReasons: []},
  production: {
    piles: {count: 12, meters: 60},
    drilling: {count: 4, meters: 24},
    downtimeHours: 0,
  },
  entries: [], warnings: [], defects: [], incidents: [], progress: [],
} as unknown as OperatorMobileState;

export function workStateFixture(overrides: Partial<OperatorMobileState> = {}): OperatorMobileState {
  return {...baseWorkState, ...overrides};
}
