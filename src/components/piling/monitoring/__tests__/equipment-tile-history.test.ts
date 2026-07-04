import { describe, expect, it } from 'vitest';
import { createTemplateHistory } from '../equipment-tile-history';
import { DEFAULT_EQUIPMENT_TILE_TEMPLATE } from '../equipment-tile-template';

describe('equipment tile history', () => {
  it('supports undo and redo without mutating snapshots', () => {
    const initial = structuredClone(DEFAULT_EQUIPMENT_TILE_TEMPLATE);
    const history = createTemplateHistory(initial);
    const changed = structuredClone(initial);
    changed.card.width = 360;

    history.push(changed);
    changed.card.width = 999;

    expect(history.present.card.width).toBe(360);
    expect(history.undo().card.width).toBe(initial.card.width);
    expect(history.redo().card.width).toBe(360);
  });

  it('drops redo states after a new change', () => {
    const history = createTemplateHistory(DEFAULT_EQUIPMENT_TILE_TEMPLATE);
    history.push({ ...DEFAULT_EQUIPMENT_TILE_TEMPLATE, card: { ...DEFAULT_EQUIPMENT_TILE_TEMPLATE.card, width: 300 } });
    history.undo();
    history.push({ ...DEFAULT_EQUIPMENT_TILE_TEMPLATE, card: { ...DEFAULT_EQUIPMENT_TILE_TEMPLATE.card, width: 320 } });

    expect(history.canRedo).toBe(false);
    expect(history.redo().card.width).toBe(320);
  });

  it('ignores identical snapshots', () => {
    const history = createTemplateHistory(DEFAULT_EQUIPMENT_TILE_TEMPLATE);
    history.push(structuredClone(DEFAULT_EQUIPMENT_TILE_TEMPLATE));

    expect(history.canUndo).toBe(false);
  });

  it('retains at most fifty undo snapshots', () => {
    const history = createTemplateHistory(DEFAULT_EQUIPMENT_TILE_TEMPLATE);
    for (let width = 201; width <= 260; width += 1) {
      history.push({ ...DEFAULT_EQUIPMENT_TILE_TEMPLATE, card: { ...DEFAULT_EQUIPMENT_TILE_TEMPLATE.card, width } });
    }

    let undoCount = 0;
    while (history.canUndo) {
      history.undo();
      undoCount += 1;
    }
    expect(undoCount).toBe(50);
  });
});
