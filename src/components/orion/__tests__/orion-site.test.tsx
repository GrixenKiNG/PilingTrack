import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../orion-site.module.css', () => ({
  default: new Proxy({}, {
    get: (_target, property) => property === 'then' ? undefined : 'orion-test-class',
  }),
}));
import { OrionSite } from '../orion-site';
import { orionEquipment, orionProcessSteps, orionProofPoints, orionStories } from '../orion-content';
import {
  ORION_PROFILE_DISCLAIMER,
  orionEquipmentProfiles,
} from '../orion-equipment-profiles';

describe('ORION public site', () => {
  it('uses the eight confirmed fleet units and no fictional project stories', () => {
    expect(orionEquipment.map(({ name }) => name)).toEqual([
      'PVE 50PR',
      'Liebherr LRH 100 №1',
      'Liebherr LRH 100 №2',
      'КБУРГ-16.02 №1',
      'КБУРГ-16.02 №2',
      'Kopernik-SD-20',
      'Banut 655',
      'Bauer RTG RM20',
    ]);
    expect(orionStories).toEqual([]);
    expect(orionProofPoints).toEqual([
      { value: '8', label: 'единиц собственного парка' },
      { value: 'ППР', label: 'работа по проекту' },
      { value: 'Экипаж', label: 'аренда с оператором' },
    ]);
    expect(orionProcessSteps).toEqual([
      expect.objectContaining({ number: '01', title: 'Исходные данные' }),
      expect.objectContaining({ number: '02', title: 'Технология и ППР' }),
      expect.objectContaining({ number: '03', title: 'Мобилизация' }),
      expect.objectContaining({ number: '04', title: 'Производство' }),
      expect.objectContaining({ number: '05', title: 'Документация' }),
    ]);
    expect(orionEquipment.every(({ photoSlots }) => photoSlots === 5)).toBe(true);
    for (const equipment of orionEquipment) {
      expect(equipment.photos).toHaveLength(5);
      expect(equipment.photos.every(({ sourceUrl }) => sourceUrl.startsWith('https://'))).toBe(true);
    }
    expect(new Set(orionEquipment.map((item) => item.profileKey))).toHaveLength(6);

    for (const profile of Object.values(orionEquipmentProfiles)) {
      expect(profile.description.length).toBeGreaterThan(80);
      expect(profile.specifications.length).toBeGreaterThanOrEqual(3);
      expect(profile.features.length).toBeGreaterThanOrEqual(3);
      expect(profile.source.url).toMatch(/^https:\/\//);
      expect(profile.pdfPath).toMatch(/^\/orion\/specs\/.+\.pdf$/);
      expect(profile.disclaimer).toBe(ORION_PROFILE_DISCLAIMER);
    }
  });

  it('offers an engineering consultation and labels future project stories honestly', () => {
    render(<OrionSite />);
    expect(screen.getByRole('heading', { level: 1, name: /держатся большие проекты/i })).toBeInTheDocument();
    for (const link of screen.getAllByRole('link', { name: /обсудить объект/i })) {
      expect(link).toHaveAttribute('href', '#contact');
    }
    expect(screen.getByText(/готовим портфолио реализованных объектов/i)).toBeInTheDocument();
    expect(screen.getAllByText(/проверено фото/i)).toHaveLength(8);
    expect(screen.getByText('единиц собственного парка')).toBeInTheDocument();
    expect(screen.getByText('работа по проекту')).toBeInTheDocument();
    expect(screen.getByText('аренда с оператором')).toBeInTheDocument();
    expect(screen.getByText(/референс модели/i)).toBeInTheDocument();
    expect(screen.queryByText('24/7')).not.toBeInTheDocument();

    const submitButton = screen.getByRole('button', { name: /отправить запрос/i });
    const form = submitButton.closest('form');
    expect(form).not.toBeNull();
    fireEvent.submit(form!);

    expect(screen.queryByText(/запрос принят/i)).not.toBeInTheDocument();
    expect(screen.getByText(/онлайн-отправка ещё не подключена/i)).toBeInTheDocument();
  });

  it('reveals an accessible technical passport with document actions', () => {
    render(<OrionSite />);

    const toggle = screen.getByRole('button', {
      name: /все характеристики pve 50pr/i,
    });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(toggle).toHaveAttribute('aria-controls', 'orion-profile-0-pve-50pr');
    expect(screen.getByRole('region', {
      name: /технические характеристики pve 50pr/i,
    })).toBeVisible();
    expect(screen.getByRole('link', {
      name: /скачать pdf на русском/i,
    })).toHaveAttribute('href', '/orion/specs/pve-50pr.pdf');
    expect(screen.getByRole('link', {
      name: /источник характеристик/i,
    })).toHaveAttribute('target', '_blank');
  });

  it('keeps equipment passports expanded independently', () => {
    render(<OrionSite />);

    const pveToggle = screen.getByRole('button', {
      name: /все характеристики pve 50pr/i,
    });
    const banutToggle = screen.getByRole('button', {
      name: /все характеристики banut 655/i,
    });

    fireEvent.click(pveToggle);
    fireEvent.click(banutToggle);

    expect(pveToggle).toHaveAttribute('aria-expanded', 'true');
    expect(banutToggle).toHaveAttribute('aria-expanded', 'true');
  });
});
