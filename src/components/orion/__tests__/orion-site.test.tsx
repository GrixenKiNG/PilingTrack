import { fireEvent, render, screen, within } from '@testing-library/react';
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
    expect(orionEquipment.map(({ name, profileKey }) => ({ name, profileKey }))).toEqual([
      { name: 'PVE 50PR', profileKey: 'pve-50pr' },
      { name: 'Liebherr LRH 100 №1', profileKey: 'liebherr-lrh100' },
      { name: 'Liebherr LRH 100 №2', profileKey: 'liebherr-lrh100' },
      { name: 'КБУРГ-16.02 №1', profileKey: 'kburg-16' },
      { name: 'КБУРГ-16.02 №2', profileKey: 'kburg-16' },
      { name: 'Kopernik-SD-20', profileKey: 'kopernik-sd20c' },
      { name: 'Banut 655', profileKey: 'banut-655' },
      { name: 'Bauer RTG RM20', profileKey: 'bauer-rtg-rm20' },
    ]);

    for (const profile of Object.values(orionEquipmentProfiles)) {
      expect(profile.description.length).toBeGreaterThan(80);
      expect(profile.specifications.length).toBeGreaterThanOrEqual(3);
      expect(profile.features.length).toBeGreaterThanOrEqual(3);
      expect(profile.source.url).toMatch(/^https:\/\//);
      expect(profile.pdfPath).toMatch(/^\/orion\/specs\/.+\.pdf$/);
      expect(profile.disclaimer).toBe(ORION_PROFILE_DISCLAIMER);
    }
    expect(Object.fromEntries(
      Object.entries(orionEquipmentProfiles).map(([key, profile]) => [key, profile.source.url]),
    )).toEqual({
      'pve-50pr': 'https://www.agd-equipment.co.uk/images/articles/large/folder_pve_piling_1005_lr.pdf',
      'liebherr-lrh100': 'https://www.liebherr.com/shared/media/construction-machinery/deep-foundation/pdf/data-sheet-archive/lrb-series/liebherr-lrh-100-piling-rig-english-technical-data-sheet-specifications-10538148-english.pdf',
      'kburg-16': 'https://www.gruzovik.com/stroitelnaya-tehnika/svaeboynye-ustanovki/bashstroy-kburg-16-a9759783.html',
      'kopernik-sd20c': 'https://exkavator.ru/excapedia/technic/kopernik_sd-20c',
      'banut-655': 'https://www.prommashini.ru/upload/burovie_ust/BANUT%20655.pdf',
      'bauer-rtg-rm20': 'https://www.agd-equipment.co.uk/images/pdf/RTG_RM20_Specification_Details.pdf',
    });
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

  it('reveals a complete accessible technical passport and closes it again', () => {
    render(<OrionSite />);

    const highlights = screen.getByLabelText('Ключевые характеристики PVE 50PR');
    expect(within(highlights).getAllByRole('term')).toHaveLength(3);
    expect(within(highlights).getAllByRole('definition')).toHaveLength(3);

    const toggle = screen.getByRole('button', {
      name: /все характеристики pve 50pr/i,
    });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(toggle).toHaveAttribute('aria-controls', 'orion-profile-0-pve-50pr');
    const region = screen.getByRole('region', {
      name: /технические характеристики pve 50pr/i,
    });
    expect(region).toBeVisible();
    expect(within(region).getByText(ORION_PROFILE_DISCLAIMER, { exact: true })).toBeVisible();
    expect(within(region).getByText('Подготовлено 15.07.2026.', { exact: true })).toBeVisible();

    const downloadLink = within(region).getByRole('link', {
      name: 'Скачать PDF на русском — PVE 50PR',
    });
    expect(downloadLink).toHaveAttribute('href', '/orion/specs/pve-50pr.pdf');
    expect(downloadLink).toHaveAttribute('download');

    const sourceLink = within(region).getByRole('link', {
      name: /Источник характеристик — PVE 50PR: PVE — 50PR technical brochure/i,
    });
    expect(sourceLink).toHaveAttribute('href', 'https://www.agd-equipment.co.uk/images/articles/large/folder_pve_piling_1005_lr.pdf');
    expect(sourceLink).toHaveAttribute('target', '_blank');
    expect(sourceLink).toHaveAttribute('rel', 'noreferrer');

    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('region', {
      name: /технические характеристики pve 50pr/i,
    })).not.toBeInTheDocument();
  });

  it('keeps duplicate-model equipment passports expanded independently', () => {
    render(<OrionSite />);

    const firstToggle = screen.getByRole('button', {
      name: /все характеристики liebherr lrh 100 №1/i,
    });
    const secondToggle = screen.getByRole('button', {
      name: /все характеристики liebherr lrh 100 №2/i,
    });

    fireEvent.click(firstToggle);
    fireEvent.click(secondToggle);

    expect(firstToggle).toHaveAttribute('aria-expanded', 'true');
    expect(secondToggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('region', {
      name: /технические характеристики liebherr lrh 100 №1/i,
    })).toBeVisible();
    expect(screen.getByRole('region', {
      name: /технические характеристики liebherr lrh 100 №2/i,
    })).toBeVisible();

    fireEvent.click(firstToggle);

    expect(firstToggle).toHaveAttribute('aria-expanded', 'false');
    expect(secondToggle).toHaveAttribute('aria-expanded', 'true');
  });
});
