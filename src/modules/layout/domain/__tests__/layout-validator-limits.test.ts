/**
 * Валидаторы шаблонов не пропускают разбухание строки JSONB лишними полями
 * и неограниченными строками цвета карточки (разбор Codex N21X2B).
 */
import { describe, expect, it } from 'vitest';
import { createTemplateValidator } from '../layout-template';
import { createPageLayoutValidator } from '../page-layout-template';

const hugeExtra = () => ({ items: Array.from({ length: 10_000 }, () => 'x'.repeat(100)) });

const cardTemplate = () => ({
  version: 1,
  card: {
    width: 300, minHeight: 240, rowHeight: 24, gap: 0,
    background: '#fff', borderColor: '#000', borderWidth: 0, borderRadius: 0, padding: 0,
  },
  blocks: [],
});

describe('пределы размера шаблонов layout', () => {
  it('принимает обычный шаблон карточки и страницы', () => {
    expect(createTemplateValidator([])(cardTemplate())).not.toBeNull();
    expect(createPageLayoutValidator(['summary'])({ version: 1, widgets: [{ id: 'summary', visible: true, size: 'md', order: 0 }] })).not.toBeNull();
  });

  it('отклоняет огромную структуру в неизвестном поле карточки', () => {
    expect(createTemplateValidator([])({ ...cardTemplate(), extra: hugeExtra() })).toBeNull();
  });

  it('отклоняет огромную структуру в неизвестном поле страницы', () => {
    expect(createPageLayoutValidator(['summary'])({ version: 1, widgets: [], extra: hugeExtra() })).toBeNull();
  });

  it.each(['background', 'borderColor'] as const)('ограничивает card.%s до 200 символов', (key) => {
    const template = cardTemplate();
    template.card[key] = 'x'.repeat(201);
    expect(createTemplateValidator([])(template)).toBeNull();
  });
});
