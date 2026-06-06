import { describe, it, expect } from 'vitest';
import {
  requiredBlockTypes,
  composeChecklist,
  selectBlocks,
  type TemplateBlock,
  type CandidateBlock,
} from '../block-composition';

describe('requiredBlockTypes', () => {
  it('always includes BASE', () => {
    expect(requiredBlockTypes({ hammerKind: 'NONE', isCombined: false })).toEqual(['BASE']);
  });

  it('adds HAMMER when a hammer is present', () => {
    expect(requiredBlockTypes({ hammerKind: 'HYDRAULIC', isCombined: false })).toEqual(['BASE', 'HAMMER']);
    expect(requiredBlockTypes({ hammerKind: 'DIESEL', isCombined: false })).toEqual(['BASE', 'HAMMER']);
  });

  it('adds ROTARY only when combined', () => {
    expect(requiredBlockTypes({ hammerKind: 'NONE', isCombined: true })).toEqual(['BASE', 'ROTARY']);
  });

  it('includes all three for a combined rig with a hammer', () => {
    expect(requiredBlockTypes({ hammerKind: 'HYDRAULIC', isCombined: true })).toEqual(['BASE', 'HAMMER', 'ROTARY']);
  });
});

const baseBlock: TemplateBlock = {
  blockType: 'BASE',
  name: 'Banut 655',
  sections: [
    { title: 'Двигатель', order: 1, items: [
      { id: 'b1', text: 'Уровень масла', answerType: 'STATUS4', unit: null, norm: '3/4', provenance: null, required: true, photoRequired: false, order: 1 },
    ] },
  ],
};
const hammerBlock: TemplateBlock = {
  blockType: 'HAMMER',
  name: 'Гидромолот',
  sections: [
    { title: 'Гидросистема', order: 1, items: [
      { id: 'h1', text: 'Давление', answerType: 'MEASURE', unit: 'бар', norm: '200-230', provenance: null, required: true, photoRequired: false, order: 1 },
    ] },
  ],
};
const rotaryBlock: TemplateBlock = {
  blockType: 'ROTARY',
  name: 'Вращатель',
  sections: [
    { title: 'Редуктор', order: 1, items: [
      { id: 'r1', text: 'Масло редуктора', answerType: 'YES_NO', unit: null, norm: null, provenance: null, required: true, photoRequired: false, order: 1 },
    ] },
  ],
};

describe('composeChecklist', () => {
  it('flattens blocks in BASE → HAMMER → ROTARY order', () => {
    const snap = composeChecklist([rotaryBlock, hammerBlock, baseBlock]);
    expect(snap.map((s) => s.id)).toEqual(['b1', 'h1', 'r1']);
    expect(snap.map((s) => s.blockType)).toEqual(['BASE', 'HAMMER', 'ROTARY']);
  });

  it('stamps each item with its block name and section title', () => {
    const snap = composeChecklist([baseBlock, hammerBlock]);
    expect(snap[0]).toMatchObject({ id: 'b1', blockType: 'BASE', blockName: 'Banut 655', sectionTitle: 'Двигатель', text: 'Уровень масла', norm: '3/4' });
    expect(snap[1]).toMatchObject({ id: 'h1', blockType: 'HAMMER', blockName: 'Гидромолот', sectionTitle: 'Гидросистема', unit: 'бар' });
  });

  it('orders sections and items within a block by order', () => {
    const block: TemplateBlock = {
      blockType: 'BASE', name: 'X',
      sections: [
        { title: 'Второй', order: 2, items: [{ id: 'i2', text: 't', answerType: 'YES_NO', unit: null, norm: null, provenance: null, required: true, photoRequired: false, order: 1 }] },
        { title: 'Первый', order: 1, items: [
          { id: 'i1b', text: 't', answerType: 'YES_NO', unit: null, norm: null, provenance: null, required: true, photoRequired: false, order: 2 },
          { id: 'i1a', text: 't', answerType: 'YES_NO', unit: null, norm: null, provenance: null, required: true, photoRequired: false, order: 1 },
        ] },
      ],
    };
    expect(composeChecklist([block]).map((s) => s.id)).toEqual(['i1a', 'i1b', 'i2']);
  });

  it('throws when no BASE block is provided', () => {
    expect(() => composeChecklist([hammerBlock])).toThrow(/база/i);
  });
});

describe('selectBlocks', () => {
  const cand = (over: Partial<CandidateBlock>): CandidateBlock => ({
    id: 't', blockType: 'BASE', name: 'n', sections: [], appliesToModel: null, appliesToHammerKind: null, ...over,
  });

  it('picks BASE by exact model, HAMMER by kind, ROTARY for combined', () => {
    const pool: CandidateBlock[] = [
      cand({ blockType: 'BASE', name: 'Banut 655', appliesToModel: 'Banut 655' }),
      cand({ blockType: 'BASE', name: 'Junttan', appliesToModel: 'Junttan PM25' }),
      cand({ blockType: 'HAMMER', name: 'Гидро', appliesToHammerKind: 'HYDRAULIC' }),
      cand({ blockType: 'HAMMER', name: 'Дизель', appliesToHammerKind: 'DIESEL' }),
      cand({ blockType: 'ROTARY', name: 'Вращатель' }),
    ];
    const picked = selectBlocks(pool, { model: 'Banut 655', hammerKind: 'HYDRAULIC', isCombined: true });
    expect(picked.map((b) => b.name)).toEqual(['Banut 655', 'Гидро', 'Вращатель']);
  });

  it('falls back to a generic BASE (appliesToModel=null) when model has no exact block', () => {
    const pool: CandidateBlock[] = [cand({ blockType: 'BASE', name: 'Общий', appliesToModel: null })];
    const picked = selectBlocks(pool, { model: 'Неизвестная', hammerKind: 'NONE', isCombined: false });
    expect(picked.map((b) => b.name)).toEqual(['Общий']);
  });

  it('omits HAMMER when no hammer and ROTARY when not combined', () => {
    const pool: CandidateBlock[] = [
      cand({ blockType: 'BASE', name: 'B', appliesToModel: 'M' }),
      cand({ blockType: 'HAMMER', name: 'H', appliesToHammerKind: 'HYDRAULIC' }),
      cand({ blockType: 'ROTARY', name: 'R' }),
    ];
    const picked = selectBlocks(pool, { model: 'M', hammerKind: 'NONE', isCombined: false });
    expect(picked.map((b) => b.name)).toEqual(['B']);
  });
});
