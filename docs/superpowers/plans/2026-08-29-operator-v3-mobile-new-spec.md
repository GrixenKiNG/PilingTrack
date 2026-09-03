# Мобильный модуль оператора v3 по новой спецификации — план реализации

> **Для агентных исполнителей:** обязательно использовать `superpowers:executing-plans`. Шаги отмечаются флажками и выполняются последовательно через цикл «красный тест — минимальная реализация — зелёный тест».

**Цель:** реализовать полный мобильный цикл оператора из новой спецификации, сохранив серверную техническую готовность, безопасную остановку и автономную очередь.

**Архитектура:** содержание процесса задаётся версионируемыми динамическими шаблонами. Рабочее место получает один серверный снимок, отображает восемь мобильных этапов и отправляет все изменения через существующий конверт команд. Решение о допуске и блокировках принимает сервер.

**Технологии:** Next.js 16, React 19, TypeScript 6, Tailwind CSS 4, Zod 4, Prisma 7, PostgreSQL, Vitest, Testing Library, Playwright.

**Спецификация:** `docs/superpowers/specs/2026-08-29-operator-v3-mobile-new-spec-design.md`

## Общие ограничения

- Все подписи интерфейса — на русском языке.
- Пункты проверок поступают только из каталога новой спецификации.
- Контрольные ширины: 360, 390 и 430 px.
- Не добавлять новый клиентский источник решения о готовности.
- Не ослаблять безопасную остановку, роли, версии команд и автономную авторизацию.
- Не смешивать изменения с посторонними незакоммиченными файлами.

---

### Задача 1. Канонический каталог новой спецификации

**Файлы:**
- Создать: `src/modules/operator-v3/domain/checklists/operator-checklist-types.ts`
- Создать: `src/modules/operator-v3/domain/checklists/operator-checklist-catalog.ts`
- Создать: `src/modules/operator-v3/domain/checklists/operator-checklist-rules.ts`
- Создать: `src/modules/operator-v3/domain/checklists/__tests__/operator-checklist-catalog.test.ts`

**Интерфейсы:**

```ts
export type OperatorChecklistAnswerType =
  | 'PASS_FAIL_NA' | 'YES_NO' | 'NUMBER' | 'TEMPERATURE'
  | 'PRESSURE' | 'QUANTITY' | 'TEXT' | 'PHOTO' | 'SIGNATURE';

export type OperatorChecklistCriticality = 'INFO' | 'NORMAL' | 'IMPORTANT' | 'CRITICAL';

export interface OperatorChecklistItemDefinition {
  id: string;
  text: string;
  answerType: OperatorChecklistAnswerType;
  criticality: OperatorChecklistCriticality;
  required: boolean;
  photoOnFailure: boolean;
  unit: string | null;
  ruleCode: string | null;
}

export function selectOperatorChecklistTemplate(input: {
  stage: 'PRE_SHIFT' | 'SITE' | 'STARTUP' | 'PILE_SAFETY' |
    'DRILLING_SAFETY' | 'PRE_WORK_SERVICE' | 'POST_SHIFT' | 'FLUIDS';
  equipmentModel: string;
  technology: 'PILE_DRIVING' | 'LEADER_DRILLING' | null;
}): OperatorChecklistTemplateDefinition;
```

- [ ] Написать тест, перечисляющий каждый раздел и каждый пункт из утверждённой спецификации.
- [ ] Запустить `npx vitest run src/modules/operator-v3/domain/checklists/__tests__/operator-checklist-catalog.test.ts` и подтвердить падение из-за отсутствующего каталога.
- [ ] Реализовать типы, каталог и выбор версионированного шаблона без старых пунктов.
- [ ] Проверить уникальность идентификаторов, русские подписи, критичность троса, мачты, ходовой и гидравлики.
- [ ] Повторно запустить тест до полного прохождения.

### Задача 2. Выполнение динамической проверки и блокировки

**Файлы:**
- Создать: `src/modules/operator-v3/domain/checklists/checklist-execution.ts`
- Создать: `src/modules/operator-v3/domain/blockers/operator-blocker-engine.ts`
- Создать: `src/modules/operator-v3/domain/checklists/__tests__/checklist-execution.test.ts`
- Создать: `src/modules/operator-v3/domain/blockers/__tests__/operator-blocker-engine.test.ts`
- Изменить: `src/modules/operator-v3/domain/contracts.ts`

**Интерфейсы:**

```ts
export interface OperatorChecklistAnswer {
  itemId: string;
  result: string;
  value: number | string | null;
  note: string | null;
  mediaIds: string[];
  answeredAt: string;
}

export function evaluateChecklistExecution(
  template: OperatorChecklistTemplateDefinition,
  answers: OperatorChecklistAnswer[],
): {complete: boolean; blockers: OperatorBlocker[]; progress: {answered: number; total: number}};
```

- [x] Написать падающие тесты для обязательного ответа, фотографии при дефекте, критической блокировки и «не применяется».
- [x] Выполнить обязательный GitNexus `impact` для изменяемых символов контрактов.
- [x] Реализовать чистую доменную оценку без обращений к базе.
- [x] Подтвердить, что критический ответ запрещает продолжение, а важный формирует предупреждение или блокировку по правилу.
- [x] Запустить оба набора доменных тестов.

### Задача 3. Хранение шаблонов, выполнений, погоды и обслуживания

**Файлы:**
- Изменить: `prisma/schema.prisma`
- Создать: `prisma/migrations/<timestamp>_operator_v3_mobile_new_spec/migration.sql`
- Создать: `src/modules/operator-v3/infrastructure/operator-checklist-repository.ts`
- Создать: `src/modules/operator-v3/infrastructure/operator-shift-evidence-repository.ts`
- Создать: `tests/integration/operator-v3-new-spec-storage.spec.ts`

**Хранение:**

```ts
type OperatorEvidenceKind =
  | 'KNOWLEDGE_TEST' | 'WEATHER_SNAPSHOT' | 'SITE_CHECK'
  | 'STARTUP_READING' | 'MAINTENANCE_ACTION' | 'FLUID_READING'
  | 'PILE_DRIVING' | 'LEADER_DRILLING';
```

- [x] Написать интеграционный тест версионированного снимка шаблона и неизменяемых ответов.
- [x] Запустить тест и зафиксировать ожидаемое падение из-за отсутствующих таблиц.
- [x] Выполнить анализ влияния изменяемых моделей Prisma.
- [x] Добавить tenant-scoped таблицы, внешние ключи, уникальность клиентской команды и индексы чтения смены.
- [x] Хранить снимок текста и правил шаблона внутри выполнения, чтобы последующее редактирование шаблона не меняло историю.
- [x] Сгенерировать клиент Prisma и запустить интеграционный тест.

### Задача 4. Команды новой спецификации и серверный шлюз

**Файлы:**
- Изменить: `src/modules/operator-v3/application/commands/operator-command-registry.ts`
- Изменить: `src/modules/operator-v3/application/commands/envelope-schema.ts`
- Создать: `src/modules/operator-v3/application/commands/new-spec-checklist-commands.ts`
- Создать: `src/modules/operator-v3/application/commands/new-spec-work-commands.ts`
- Изменить: `src/modules/operator-v3/application/commands/execute-operator-command.ts`
- Изменить: `tests/contract/operator-v3-commands.spec.ts`

**Новые команды:**

```ts
type NewSpecCommandName =
  | 'start-checklist' | 'save-checklist-answer' | 'complete-checklist'
  | 'submit-knowledge-test' | 'capture-weather' | 'confirm-site-check'
  | 'record-startup' | 'record-warmup' | 'complete-function-check'
  | 'record-maintenance-action' | 'record-fluid-reading'
  | 'record-pile-driving' | 'record-leader-drilling';
```

- [x] Сначала расширить контрактные тесты командами, допустимыми и недопустимыми полезными данными.
- [x] Запустить контрактный тест и подтвердить отказ неизвестных команд.
- [x] Выполнить GitNexus impact для реестра и `executeOperatorCommand`; предупредить при высоком риске.
- [x] Зарегистрировать команды, повторно используя общий конверт, версии, контрольную сумму и идемпотентность.
- [x] Для критических решений сохранить запрет автономного серверного подтверждения; разрешить автономный сбор доказательств по действующей политике.
- [x] Запустить контрактные и командные модульные тесты.

### Задача 5. Серверный снимок восьми этапов

**Файлы:**
- Изменить: `src/modules/operator-v3/domain/contracts.ts`
- Изменить: `src/modules/operator-v3/domain/resolve-operator-workplace.ts`
- Изменить: `src/modules/operator-v3/application/workplace-query.ts`
- Изменить: `src/modules/operator-v3/application/russian-labels.ts`
- Изменить: `src/modules/operator-v3/domain/__tests__/resolve-operator-workplace.test.ts`
- Изменить: `tests/integration/operator-v3-workplace.contract.spec.ts`

**Проекция:**

```ts
export type OperatorPhaseNumber = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

interface OperatorWorkplaceSnapshot {
  eligibility: OperatorEligibilityPresentation;
  weather: OperatorWeatherSnapshot | null;
  checklistExecutions: OperatorChecklistExecutionView[];
  workZone: OperatorSiteCheckView | null;
  startup: OperatorStartupView | null;
  service: OperatorMaintenanceView;
  work: OperatorWorkSummary;
}
```

- [x] Написать падающие тесты переходов по всем восьми этапам и каждой обязательной блокировке.
- [x] Выполнить impact для `resolveOperatorWorkplace`; проверить прямых потребителей API.
- [x] Реализовать проекцию без удаления текущих полей безопасности, ремонта, передачи и синхронизации.
- [x] Заполнить `workZone`, доказательства готовности, контакты и подробности профиля фактическими данными или явным состоянием «данные не предоставлены».
- [x] Запустить доменные, контрактные и интеграционные тесты рабочего места.

### Задача 6. Строгий клиентский контракт и автономная очередь

**Файлы:**
- Изменить: `src/components/piling/operator-v3/api/wire-contracts.ts`
- Изменить: `src/components/piling/operator-v3/api/action-registry.ts`
- Изменить: `src/components/piling/operator-v3/offline/command-envelope.ts`
- Изменить: `src/components/piling/operator-v3/offline/operator-offline-services.ts`
- Изменить: `src/components/piling/operator-v3/__tests__/wire-contracts.test.ts`
- Изменить: `src/components/piling/operator-v3/offline/__tests__/command-queue.test.ts`

- [x] Написать падающие тесты строгого снимка восьми этапов и новых типов ответа.
- [x] Написать падающий тест сохранения ответа с фотографией и повторной идемпотентной отправки.
- [x] Выполнить impact для изменяемых схем и реестра действий.
- [x] Расширить Zod-схемы и очередь без ослабления `.strict()`.
- [x] Убедиться, что автономный черновик не превращается в авторитетное решение о допуске.
- [x] Запустить тесты контрактов и автономного контура.

### Задача 7. Мобильная оболочка в стиле PilingTrack

**Файлы:**
- Создать: `src/components/piling/operator-v3/mobile/operator-mobile-shell.tsx`
- Создать: `src/components/piling/operator-v3/mobile/operator-bottom-navigation.tsx`
- Создать: `src/components/piling/operator-v3/mobile/operator-stage-progress.tsx`
- Создать: `src/components/piling/operator-v3/mobile/operator-primary-action.tsx`
- Изменить: `src/components/piling/operator-v3/operator-workplace-screen.tsx`
- Изменить: `src/components/piling/operator-v3/phase-route.tsx`
- Изменить: `src/components/piling/operator-v3/__tests__/operator-workplace-screen.test.tsx`

- [x] Написать тесты пяти вкладок, этапа «N из 8», закреплённого действия и безопасной области.
- [x] Запустить тест и подтвердить падение на текущей семиколоночной ленте.
- [x] Выполнить impact для `OperatorWorkplaceScreen` и `PhaseRoute`.
- [x] Реализовать одноколоночный телефонный контейнер `max-w-[430px]`, фон и компоненты текущей дизайн-системы.
- [x] Удалить горизонтальную семиколоночную ленту из мобильного представления; добавить раскрываемый маршрут.
- [x] Сохранить полноэкранную безопасную остановку выше обычной навигации.
- [x] Запустить компонентные тесты.

### Задача 8. Мобильные этапы допуска, установки, площадки и запуска

**Файлы:**
- Создать: `src/components/piling/operator-v3/mobile/screens/admission-screen.tsx`
- Создать: `src/components/piling/operator-v3/mobile/screens/equipment-screen.tsx`
- Создать: `src/components/piling/operator-v3/mobile/screens/checklist-runner-screen.tsx`
- Создать: `src/components/piling/operator-v3/mobile/screens/site-check-screen.tsx`
- Создать: `src/components/piling/operator-v3/mobile/screens/startup-screen.tsx`
- Создать: `src/components/piling/operator-v3/mobile/__tests__/pre-work-mobile-flow.test.tsx`
- Изменить: `src/components/piling/operator-v3/steps/current-phase-panel.tsx`

- [ ] Написать сквозной компонентный тест от личного допуска до разрешения работы.
- [ ] Зафиксировать падение из-за отсутствующих восьми экранов и блокировок.
- [ ] Выполнить impact для `CurrentPhasePanel`, `PreWorkInspectionStep` и `ReadinessStartStep`; это зона высокого риска.
- [ ] Реализовать карточки документов, тест знаний, оборудование, погоду, последовательный исполнитель проверок, площадку, прогрев и функциональную проверку.
- [ ] Показывать только одно главное действие; вторичные сведения раскрывать.
- [ ] Запустить тест мобильного предрабочего пути.

### Задача 9. Мобильная работа, дефекты и события

**Файлы:**
- Создать: `src/components/piling/operator-v3/mobile/screens/work-screen.tsx`
- Создать: `src/components/piling/operator-v3/mobile/forms/pile-driving-form.tsx`
- Создать: `src/components/piling/operator-v3/mobile/forms/leader-drilling-form.tsx`
- Создать: `src/components/piling/operator-v3/mobile/screens/defects-screen.tsx`
- Изменить: `src/components/piling/operator-v3/steps/work-execution-step.tsx`
- Создать: `src/components/piling/operator-v3/mobile/__tests__/work-mobile-flow.test.tsx`

- [ ] Написать тесты обязательной проверки перед забивкой и бурением, полного состава записей и причин простоя.
- [ ] Подтвердить падение существующей обобщённой формы на новых требованиях.
- [ ] Выполнить impact для `WorkExecutionStep` и действующих форм производства.
- [ ] Реализовать отдельные русские формы и вкладку дефектов; опасное событие не смешивать с дефектом.
- [ ] Сохранить существующее поведение безопасной остановки для критического события.
- [ ] Запустить компонентные, контрактные и интеграционные тесты работы.

### Задача 10. Послесменное обслуживание, отчёт и передача

**Файлы:**
- Создать: `src/components/piling/operator-v3/mobile/screens/post-shift-screen.tsx`
- Создать: `src/components/piling/operator-v3/mobile/screens/shift-summary-screen.tsx`
- Изменить: `src/components/piling/operator-v3/forms/shift-report-form.tsx`
- Изменить: `src/components/piling/operator-v3/forms/handover-form.tsx`
- Изменить: `src/modules/operator-v3/application/commands/completion-commands.ts`
- Изменить: `tests/integration/operator-v3-completion.spec.ts`

- [ ] Написать падающие тесты обслуживания, жидкостей, топлива, открытого простоя, передачи и неизменяемого снимка.
- [ ] Выполнить impact для команд завершения и связанных форм.
- [ ] Реализовать последовательность «остановка работы → обслуживание → осмотр → жидкости → итог → передача → закрытие».
- [ ] Не разрешать закрытие при любом невыполненном обязательном условии.
- [ ] Запустить интеграционный тест завершения и тесты форм.

### Задача 11. Проверка телефона и всех ролей

**Файлы:**
- Создать: `e2e/operator-v3/mobile-new-spec.spec.ts`
- Изменить: `playwright.operator-v3.config.ts`
- Изменить: `scripts/operator-v3-preflight.ts`

- [ ] Написать сценарии оператора: нормальная смена, критический дефект, опасное событие, автономный сбор данных, конфликт и повторная синхронизация.
- [ ] Добавить проверки механика и проверяющего для ремонта и независимого подтверждения; оператор не должен видеть административные действия.
- [ ] Проверить 360×800, 390×844 и 430×932: отсутствие горизонтальной прокрутки, видимость главной кнопки, доступность нижней навигации и камеры.
- [ ] Запустить целевые модульные тесты, затем `npm.cmd run test:contract`, `npm.cmd run test:integration`, `npm.cmd run build` и операторский Playwright.
- [ ] Выполнить `node .gitnexus/run.cjs detect-changes --scope compare --base-ref chore/april-accumulated-work` и проверить только ожидаемые процессы.
- [ ] Сверить каждый раздел спецификации с тестом или экраном; не заявлять 9,5/10 при незакрытом пункте.

## Матрица готовности 9,5/10

- Полнота новой спецификации: 100% пунктов каталога присутствуют и покрыты тестом.
- Безопасность: критические ответы, дефекты и события блокируют опасные команды на сервере.
- Мобильность: три контрольные ширины пройдены в браузере.
- Автономность: доказательства не теряются, решения о допуске не подделываются.
- Связь с технической готовностью: итог каждого обязательного этапа становится доказательством повторной оценки.
- Завершение: отчёт, передача и неизменяемый снимок подтверждены интеграционным тестом.
