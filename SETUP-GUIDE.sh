#!/bin/bash
# PilingTrack — Complete Testing & Setup Guide
# Copy-paste commands for quick setup

echo "╔════════════════════════════════════════════════════╗"
echo "║     PilingTrack — Полный Гайд по Тестированию    ║"
echo "╚════════════════════════════════════════════════════╝"
echo ""

# ============================================================
# ШАГИ ДЛЯ БЫСТРОГО СТАРТА
# ============================================================

echo "📋 ШАГИ ДЛЯ БЫСТРОГО СТАРТА:"
echo ""
echo "1️⃣  ДОБАВИТЬ ТЕСТОВЫЕ ДАННЫЕ:"
echo "    npm run seed"
echo ""
echo "2️⃣  ЗАПУСТИТЬ ПРИЛОЖЕНИЕ:"
echo "    npm run dev"
echo ""
echo "3️⃣  ОТКРЫТЬ В БРАУЗЕРЕ:"
echo "    http://localhost:3000"
echo ""
echo "4️⃣  ВОЙТИ КАК АДМИН:"
echo "    Email:    admin@pilingtrack.local"
echo "    Password: password123"
echo ""
echo "5️⃣  ПРОВЕСТИ ТЕСТИРОВАНИЕ:"
echo "    Пройдитесь по чеклисту из TESTING-QUICK-START.md"
echo ""

# ============================================================
# АККАУНТЫ ДЛЯ ТЕСТИРОВАНИЯ
# ============================================================

echo "👤 АККАУНТЫ ДЛЯ ТЕСТИРОВАНИЯ:"
echo ""
echo "┌─────────────────────────────────────────────────────┐"
echo "│ Администратор (admin)                                │"
echo "│ Email: admin@pilingtrack.local                       │"
echo "│ Password: password123                                │"
echo "├─────────────────────────────────────────────────────┤"
echo "│ Диспетчер (dispatcher)                               │"
echo "│ Email: dispatcher@pilingtrack.local                  │"
echo "│ Password: password123                                │"
echo "├─────────────────────────────────────────────────────┤"
echo "│ Оператор (operator)                                  │"
echo "│ Email: operator@pilingtrack.local                    │"
echo "│ Password: password123                                │"
echo "├─────────────────────────────────────────────────────┤"
echo "│ Помощник/Ассистент (assistant)                      │"
echo "│ Email: assistant@pilingtrack.local                   │"
echo "│ Password: password123                                │"
echo "└─────────────────────────────────────────────────────┘"
echo ""

# ============================================================
# ОСНОВНЫЕ КОМАНДЫ
# ============================================================

echo "⚙️  ОСНОВНЫЕ КОМАНДЫ:"
echo ""
echo "Тестирование и запуск:"
echo "  npm run dev                 # Запустить разработку сервер"
echo "  npm run build               # Собрать production версию"
echo "  npm run seed                # Добавить тестовые данные"
echo "  npm run test:interactive    # Интерактивный тест"
echo ""
echo "Проверка качества:"
echo "  npm run lint                # ESLint проверка"
echo "  npm run typecheck           # TypeScript strict проверка"
echo "  npm run test:unit           # Unit tests"
echo "  npm run test:e2e            # E2E tests (Playwright)"
echo ""
echo "Docker:"
echo "  docker compose up -d        # Запустить все сервисы"
echo "  docker compose logs -f app  # Логи приложения"
echo "  docker compose down         # Остановить"
echo ""

# ============================================================
# ЧЕКЛИСТ БЫСТРОЙ ПРОВЕРКИ
# ============================================================

echo "✅ БЫСТРАЯ ПРОВЕРКА (5-10 мин):"
echo ""
echo "□ Установки (Equipment)"
echo "  - Перейти на вкладку 'Установки'"
echo "  - Должно быть 5 установок (Бауман-100, Бауман-80, и т.д.)"
echo ""
echo "□ PDF Preview"
echo "  - Перейти на вкладку 'Отчеты'"
echo "  - Нажать 'PDF Предпросмотр'"
echo "  - Проверить кнопки остаются в видимой зоне"
echo ""
echo "□ Редактирование отчета"
echo "  - Нажать на кнопку редактирования отчета"
echo "  - Проверить видны поля:"
echo "    - Установка"
echo "    - Забитые сваи"
echo "    - Лидерное бурение"
echo "    - Причины простоев"
echo ""
echo "□ Фильтр по датам"
echo "  - Выбрать 08.04.2026 - 15.04.2026"
echo "  - Нажать 'Применить'"
echo "  - Нажать 'Скачать PDF' - должен генерироваться"
echo ""

# ============================================================
# ЕСЛИ ЧТО-ТО НЕ РАБОТАЕТ
# ============================================================

echo "🔧 ЕСЛИ ЧТО-ТО НЕ РАБОТАЕТ:"
echo ""
echo "Установки пусты:"
echo "  npm run seed"
echo "  (потом обновить браузер F5)"
echo ""
echo "Порт 3000 занят:"
echo "  # Убить процесс на порте 3000"
echo "  Get-Process -Id (Get-NetTCPConnection -LocalPort 3000).OwningProcess | Stop-Process -Force"
echo ""
echo "БД проблемы:"
echo "  npx prisma migrate deploy"
echo "  npm run seed"
echo ""
echo "TypeScript ошибки:"
echo "  npm run typecheck"
echo ""
echo "Консоль браузера (F12):"
echo "  - Проверить нет красных ошибок подоб:"
echo "    Cannot read properties of undefined"
echo "    Error: Equipment not found"
echo "    TypeError"
echo ""

# ============================================================
# ДОКУМЕНТАЦИЯ
# ============================================================

echo "📚 ДОКУМЕНТАЦИЯ:"
echo ""
echo "├─ TESTING-QUICK-START.md"
echo "│  └─ Быстрый старт тестирования, ответы на вопросы"
echo ""
echo "├─ TEST-CHECKLIST.md"
echo "│  └─ Полный чеклист всех модулей и ролей"
echo ""
echo "├─ FIXES-SUMMARY.md"
echo "│  └─ Подробная сводка всех 7 исправлений"
echo ""
echo "├─ DOCKER-SETUP.md"
echo "│  └─ Инструкции для Docker Desktop"
echo ""
echo "└─ README.md"
echo "   └─ Основная документация проекта"
echo ""

echo "┌────────────────────────────────────────────────────┐"
echo "│  ✅ ГОТОВО!                                        │"
echo "│  Начните с: npm run seed && npm run dev           │"
echo "└────────────────────────────────────────────────────┘"
echo ""
