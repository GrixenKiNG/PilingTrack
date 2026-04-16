#!/usr/bin/env node
/**
 * Interactive Test Runner for PilingTrack
 * 
 * Usage:
 *   npx ts-node scripts/test-runner.ts
 *   или: npm run test:interactive
 */

import * as readline from 'readline';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

const question = (prompt: string): Promise<string> => {
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      resolve(answer.toLowerCase().trim());
    });
  });
};

const clearScreen = () => {
  console.clear();
};

const printHeader = (title: string) => {
  console.log('\n╔────────────────────────────────────────────╗');
  console.log(`║ ${title.padEnd(42)} ║`);
  console.log('╚────────────────────────────────────────────╝\n');
};

const printSection = (title: string) => {
  console.log(`\n✓ ${title}`);
  console.log('─'.repeat(44));
};

const printChecklist = (items: string[]) => {
  items.forEach((item, i) => {
    console.log(`  ${i + 1}. [ ] ${item}`);
  });
};

const results: { [key: string]: boolean } = {};

async function testDashboard() {
  printSection('ДАШБОРД');
  printChecklist([
    'Страница загружается без ошибок',
    'Видны виджеты статистики',
    'Нет ошибок в консоли браузера'
  ]);
  
  const passed = await question('\nДашборд работает? (y/n): ');
  results['Дашборд'] = passed === 'y';
}

async function testSites() {
  printSection('ОБЪЕКТЫ (Sites)');
  printChecklist([
    'Список объектов загружается',
    'Видны объекты в списке',
    'Кнопка "Добавить" работает'
  ]);
  
  const passed = await question('\nОбъекты работают? (y/n): ');
  results['Объекты'] = passed === 'y';
}

async function testEquipment() {
  printSection('УСТАНОВКИ (Equipment) ⭐ ВАЖНО');
  console.log('  ПРОВЕРЬТЕ:');
  printChecklist([
    '✓ Список НЕ ПУСТ (должно быть 5 установок)',
    '✓ Бауман-100 есть в списке',
    '✓ Бауман-80 есть в списке',
    '✓ Виброрам РВ-80 есть в списке',
    '✓ Кнопка "Добавить установку" работает'
  ]);
  
  const passed = await question('\nУстановки работают? (y/n): ');
  results['Установки'] = passed === 'y';
  
  if (passed !== 'y') {
    console.log('\n⚠️  ОШИБКА: Установки должны быть видны!');
    console.log('Запустите: npm run seed\n');
  }
}

async function testCrews() {
  printSection('БРИГАДЫ (Crews)');
  printChecklist([
    'Список загружается',
    'Видны бригады в списке',
    'При создании видны все поля'
  ]);
  
  const passed = await question('\nБригады работают? (y/n): ');
  results['Бригады'] = passed === 'y';
}

async function testReports() {
  printSection('ОТЧЕТЫ (Reports)');
  console.log('  ПРОВЕРЬТЕ PDF PREVIEW:');
  printChecklist([
    'Нажмите "PDF Предпросмотр"',
    'Кнопки остаются в видимой зоне (не уходят за границу)',
    'Кнопки Печать, Скачать, Закрыть работают',
    'Нет переполнения диалога'
  ]);
  
  const pdf = await question('\nPDF Preview работает? (y/n): ');
  results['PDF Preview'] = pdf === 'y';
  
  console.log('\n  ПРОВЕРЬТЕ ФИЛЬТР ПО ДАТАМ:');
  printChecklist([
    'Выберите период 08.04.2026 - 15.04.2026',
    'Нажмите "Применить"',
    'Нажмите "Скачать PDF"',
    'PDF генерируется без ошибок'
  ]);
  
  const filter = await question('\nФильтр по датам работает? (y/n): ');
  results['Фильтр отчетов'] = filter === 'y';
  
  results['Отчеты'] = pdf === 'y' && filter === 'y';
}

async function testReportEdit() {
  printSection('РЕДАКТИРОВАНИЕ ОТЧЕТА ⭐ КРИТИЧНО');
  console.log('  ОТКРОЙТЕ ДИАЛОГ РЕДАКТИРОВАНИЯ ОТЧЕТА И ПРОВЕРЬТЕ:');
  printChecklist([
    'Поле "Установка" ВИДНО и заполнено',
    'Раздел "Забитые сваи" ВИДНО',
    'Раздел "Лидерное бурение" ВИДНО',
    'Раздел "Причины простоев" ВИДНО'
  ]);
  
  const equipment = await question('\nПоле "Установка" видно? (y/n): ');
  const piles = await question('Раздел "Забитые сваи" видно? (y/n): ');
  const drilling = await question('Раздел "Лидерное бурение" видно? (y/n): ');
  const downtime = await question('Раздел "Причины простоев" видно? (y/n): ');
  
  const allVisible = equipment === 'y' && piles === 'y' && drilling === 'y' && downtime === 'y';
  results['Редактирование отчета'] = allVisible;
  
  if (!allVisible) {
    console.log('\n❌ ОШИБКА: Не все поля видны в форме редактирования!');
  }
}

async function testRoles() {
  printSection('ТЕСТ ВСЕХ РОЛЕЙ');
  console.log('  ПРОВЕРЬТЕ ДЛЯ КАЖДОЙ РОЛИ:');
  printChecklist([
    'Админ (admin@pilingtrack.local) - видны все модули',
    'Диспетчер (dispatcher@pilingtrack.local) - видны допустимые модули',
    'Оператор (operator@pilingtrack.local) - видны их модули'
  ]);
  
  const admin = await question('\nАдмин работает? (y/n): ');
  const dispatcher = await question('Диспетчер работает? (y/n): ');
  const operator = await question('Оператор работает? (y/n): ');
  
  results['Роль Админ'] = admin === 'y';
  results['Роль Диспетчер'] = dispatcher === 'y';
  results['Роль Оператор'] = operator === 'y';
}

async function testConsole() {
  printSection('ПРОВЕРКА ОШИБОК');
  console.log('  Откройте F12 → Developer Tools → Console');
  printChecklist([
    'Нет красных ошибок (Error)',
    'Нет серыйных предупреждений (Warning) по API',
    'Приложение стабильно работает'
  ]);
  
  const noErrors = await question('\nНет критических ошибок? (y/n): ');
  results['Консоль браузера'] = noErrors === 'y';
}

async function showResults() {
  clearScreen();
  printHeader('РЕЗУЛЬТАТЫ ТЕСТИРОВАНИЯ');
  
  let passCount = 0;
  let totalCount = 0;
  
  for (const [test, passed] of Object.entries(results)) {
    totalCount++;
    const status = passed ? '✅' : '❌';
    console.log(`${status} ${test}`);
    if (passed) passCount++;
  }
  
  console.log(`\nРезультат: ${passCount}/${totalCount} тестов пройдено`);
  
  if (passCount === totalCount) {
    console.log('\n🎉 ВСЕ ТЕСТЫ ПРОЙДЕНЫ! Приложение готово к использованию.');
  } else {
    console.log(`\n⚠️  ${totalCount - passCount} тестов НЕ ПРОЙДЕНЫ`);
    console.log('Перепроверьте найденные ошибки и исправьте их.');
  }
  
  rl.close();
}

async function main() {
  clearScreen();
  printHeader('🧪 ТЕСТИРОВАНИЕ PilingTrack');
  
  console.log('Убедитесь что:');
  console.log('✓ npm run seed - выполнена');
  console.log('✓ npm run dev - сервер запущен');
  console.log('✓ http://localhost:3000 открыта в браузере\n');
  
  const confirmed = await question('Готовы начать? (y/n): ');
  if (confirmed !== 'y') {
    console.log('Отмена.');
    rl.close();
    return;
  }
  
  clearScreen();
  await testDashboard();
  await testSites();
  await testEquipment();
  await testCrews();
  await testReports();
  await testReportEdit();
  await testRoles();
  await testConsole();
  
  await showResults();
}

main().catch(console.error);
