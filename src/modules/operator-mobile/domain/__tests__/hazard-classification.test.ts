import {describe, expect, it} from 'vitest';
import {
  classifyObservedHazard,
  type ObservedHazardSign,
} from '../hazard-classification';

describe('серверная классификация опасного события', () => {
  it.each<{
    signs: ObservedHazardSign[];
    expected: {severity: string; stopRequired: boolean};
  }>([
    {signs: ['UNUSUAL_NOISE'], expected: {severity: 'NORMAL', stopRequired: false}},
    {signs: ['LEAK'], expected: {severity: 'HIGH', stopRequired: false}},
    {signs: ['SMOKE'], expected: {severity: 'CRITICAL', stopRequired: true}},
    {signs: ['PROTECTIVE_SYSTEM_FAILURE'], expected: {severity: 'CRITICAL', stopRequired: true}},
    {signs: ['UNCONTROLLED_MOVEMENT'], expected: {severity: 'CRITICAL', stopRequired: true}},
  ])('классифицирует наблюдаемые признаки $signs без выбора критичности оператором', ({signs, expected}) => {
    expect(classifyObservedHazard({observedSigns: signs, injured: false})).toMatchObject(expected);
  });

  it('требует остановки при пострадавшем независимо от выбранных признаков', () => {
    expect(classifyObservedHazard({observedSigns: ['OTHER'], injured: true})).toMatchObject({
      severity: 'CRITICAL',
      stopRequired: true,
    });
  });

  it('отклоняет пустой или неизвестный перечень признаков', () => {
    expect(() => classifyObservedHazard({observedSigns: [], injured: false})).toThrow(/признак/i);
    expect(() => classifyObservedHazard({observedSigns: ['CLIENT_CRITICAL'] as unknown as ObservedHazardSign[], injured: false}))
      .toThrow(/неизвест/i);
  });
});
