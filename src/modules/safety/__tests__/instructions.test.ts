import { describe, expect, it } from 'vitest';
import { SAFETY_INSTRUCTIONS } from '../instructions';
import { SAFETY_BRIEFING } from '@/modules/operator-mobile/domain/safety-briefing';
import { SLINGER_BRIEFING } from '@/modules/operator-mobile/domain/slinger-briefing';

/**
 * Каталог и сами тексты — два источника одной версии, и разойтись им нельзя.
 *
 * Журнал записывает ту версию, что стоит в каталоге, а человек читает ту, что
 * стоит в тексте. Разойдясь на одну редакцию, они превращают запись
 * «ознакомлен с в. 1.1» в утверждение о документе, которого никто не открывал.
 * Поднимая версию инструкции, поднимите её в обоих местах — этот тест об этом
 * и напомнит.
 */
describe('Каталог инструкций по охране труда', () => {
  it.each([
    ['машиниста', SAFETY_BRIEFING],
    ['помощника', SLINGER_BRIEFING],
  ])('совпадает с текстом инструкции %s', (_who, briefing) => {
    const listed = SAFETY_INSTRUCTIONS.find((item) => item.code === briefing.code);
    expect(listed, `инструкция ${briefing.code} отсутствует в каталоге`).toBeDefined();
    expect(listed?.title).toBe(briefing.title);
    expect(listed?.version).toBe(briefing.version);
  });

  it('не содержит инструкций без текста', () => {
    const texts = new Set<string>([SAFETY_BRIEFING.code, SLINGER_BRIEFING.code]);
    for (const instruction of SAFETY_INSTRUCTIONS) {
      expect(texts.has(instruction.code), `${instruction.code} некому показать`).toBe(true);
    }
  });
});
