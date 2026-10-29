# ДЕФЕКТ P3: выбор объекта v3 перекрыт навигацией на desktop

Кандидат появился как BLOCKED в старом crawler. Отдельный тест обычного клика подтвердил его: после штатной прокрутки нижний nav перехватывал pointer events у combobox. Никаких force-click, удаления overlay или изменения DOM в проверке нет.

| Запуск | Источник приложения | Passed / failed / skipped | Exit | Время |
|---|---|---|---:|---:|
|v3-site-selector-repro|host build7e3aa7e, до CSS-правки|2 / 1 / 0: Chromium failed, оба mobile passed|1|38 с wrapper,36,6с PW|
|v3-selector-green|host build1b0a2663|3 / 0 / 0|0|54 с wrapper,49,3с PW|
|host npm run build|1b0a2663|—|0|260 с|

Роль в отдельном regression-test — OPERATOR, реальные синтетические учётная запись и закреплённый объект. Chromium — Desktop Chrome; Mobile Safari/iPhone13 и Mobile Chrome/GalaxyS24 — браузерные профили Playwright, не физические телефоны.

Причина: src/components/piling/operator-v3/operator-dashboard-v3.tsx:95 содержит p-4 pb-28 sm:p-5. На ширине sm правило sm:p-5 перезаписывает нижний отступ, рассчитанный под постоянную нижнюю навигацию. На телефонах pb-28 сохраняется, поэтому они прошли исходный тест.

RED оставлен отдельным коммитом f87c2b50. Исправление 1b0a2663 — единственная строка: добавлено sm:pb-28. Тексты, запросы, функции, роли и версии экранов не менялись. Новый host пересобран после остановки только собственного предыдущего app/worker, чтобы не проверять старый CSS.

## GitNexus и границы

До правки impact OperatorDashboardV3: LOW, один directcaller OperatorV3Page; проверено текстом (определение, импорт, render). Полный detect_changes перед CSS-коммитом: HIGH, 7 affected processes; partial/truncated отсутствуют. Это не LOW-результат: все семь процессов отмечают changed_steps=OperatorDashboardV3 step1, их хвосты идут в FetchWithTimeout/Cleanup/circuitbreaker/logger. Код этих функций не менялся. Пользователь отдельно уведомлён о HIGH, raw detect-1b0a2663.json сохранён. Проверка функционального риска — буквальный однострочный diff, новая сборка и обычный UI-клик в трёх браузерах.

Глобальный GitNexus process-index сообщил бюджетное усечение перечня flows. Отсутствие других flows не принято за доказательство отсутствия влияния; конкретный detect не был partial/truncated. Никакие функции не удалены.

Это доказательство достижимости selector, не полного цикла v3. Дубликат crawler BLOCKED для ASSISTANT отдельно этим тестом не воспроизведён; общий компонент получил тот же CSS, но отдельный полный процесс помощника не объявляется проверенным.

Raw до/после и скриншоты: D:/PillingR/night-logs/night-evidence-1026/v3-site-selector-repro* и v3-selector-green*. Остальные финальные проверки на 1b0a2663 фиксируются по мере завершения в VERIFICATION.md/SUMMARY.md.
