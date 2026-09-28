'use client';

import {useEffect, useRef, type ReactNode} from 'react';
import {loadPassportDraft, savePassportDraft, type PassportDraftData} from './draft-storage';

/**
 * Память черновика паспорта сваи.
 *
 * ПОЧЕМУ ЧЕРЕЗ DOM, А НЕ ЧЕРЕЗ ПРОПСЫ. Форма паспорта — общий компонент
 * `operator-mobile`, вне зоны правок: своими полями она владеет сама и ни
 * значений наружу не отдаёт, ни начальных не принимает. Чтобы черновик пережил
 * перезагрузку страницы и уход в обходной экран, обёртка снимает значения с
 * полей по событиям (`input`/`change`) и возвращает их, когда форма снова
 * смонтирована. Обёртка ничего не рисует от себя — это ровно та же форма.
 *
 * ЧТО НЕ ПЕРЕНОСИТСЯ. Снимки и служебные состояния загрузки — не черновик;
 * восстанавливаются только введённые человеком значения.
 */
export function PassportPersist({
  userId, shiftId, enabled, children,
}: {
  userId: string | null;
  shiftId: string | null;
  enabled: boolean;
  children: ReactNode;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!enabled || !shiftId) return;
    const root = rootRef.current;
    if (!root) return;
    const saved = loadPassportDraft(userId, shiftId);
    if (saved) restorePassport(root, saved);
  }, [userId, shiftId, enabled]);

  useEffect(() => {
    if (!enabled || !shiftId) return;
    const root = rootRef.current;
    if (!root) return;
    const capture = () => {
      const data = readPassport(root);
      if (data) savePassportDraft(userId, shiftId, data);
    };
    root.addEventListener('input', capture, true);
    root.addEventListener('change', capture, true);
    return () => {
      root.removeEventListener('input', capture, true);
      root.removeEventListener('change', capture, true);
    };
  }, [userId, shiftId, enabled]);

  return <div ref={rootRef}>{children}</div>;
}

/** Поля с подписью вида `<label><span>Подпись…</span><input/></label>`. */
function numberInputsByLabel(root: HTMLElement, startsWith: string): HTMLInputElement[] {
  const found: HTMLInputElement[] = [];
  for (const label of Array.from(root.querySelectorAll('label'))) {
    const caption = label.querySelector('span')?.textContent?.trim() ?? '';
    if (!caption.startsWith(startsWith)) continue;
    const input = label.querySelector('input[type="number"]') as HTMLInputElement | null;
    if (input) found.push(input);
  }
  return found;
}

function checkboxByLabel(root: HTMLElement, startsWith: string): HTMLInputElement | null {
  for (const label of Array.from(root.querySelectorAll('label'))) {
    const caption = label.querySelector('span')?.textContent?.trim() ?? '';
    if (!caption.startsWith(startsWith)) continue;
    const box = label.querySelector('input[type="checkbox"]') as HTMLInputElement | null;
    if (box) return box;
  }
  return null;
}

function readPassport(root: HTMLElement): PassportDraftData | null {
  const grade = (root.querySelector('select') as HTMLSelectElement | null)?.value ?? '';
  const number = (root.querySelector('input[placeholder="С-130"]') as HTMLInputElement | null)?.value ?? '';
  const designHead = numberInputsByLabel(root, 'Проектная головы')[0]?.value ?? '';
  const actualHead = numberInputsByLabel(root, 'Фактическая головы')[0]?.value ?? '';
  const depth = numberInputsByLabel(root, 'Глубина погружения')[0]?.value ?? '';
  const blows = numberInputsByLabel(root, 'Ударов').map((input) => input.value);
  const penetration = numberInputsByLabel(root, 'Погружение').map((input) => input.value);
  const setHeights = numberInputsByLabel(root, 'Высота, м').map((input) => input.value);
  const sets = blows.map((value, index) => ({
    blows: value,
    penetration: penetration[index] ?? '',
    dropHeight: setHeights[index] ?? '',
  }));
  const data: PassportDraftData = {
    grade,
    number,
    designHead,
    actualHead,
    depth,
    sets,
    designRefusal: numberInputsByLabel(root, 'Проектный отказ')[0]?.value ?? '',
    totalBlows: numberInputsByLabel(root, 'Всего')[0]?.value ?? '',
    blowsLastMeter: numberInputsByLabel(root, 'На последний метр')[0]?.value ?? '',
    dropHeight: numberInputsByLabel(root, 'Высота падения молота')[0]?.value ?? '',
    planDeviation: numberInputsByLabel(root, 'В плане')[0]?.value ?? '',
    tilt: numberInputsByLabel(root, 'От вертикали')[0]?.value ?? '',
    redriven: checkboxByLabel(root, 'Добивка')?.checked ?? false,
    followerUsed: checkboxByLabel(root, 'Погружение добойником')?.checked ?? false,
    headCutOff: checkboxByLabel(root, 'Голова срублена')?.checked ?? false,
    note: (root.querySelector('textarea') as HTMLTextAreaElement | null)?.value ?? '',
  };
  const touched = Boolean(
    grade || number || designHead || actualHead || depth || data.designRefusal
    || data.totalBlows || data.blowsLastMeter || data.dropHeight || data.planDeviation
    || data.tilt || data.note || data.redriven || data.followerUsed || data.headCutOff
    || sets.some((set) => set.penetration || set.dropHeight),
  );
  return touched ? data : null;
}

function restorePassport(root: HTMLElement, data: PassportDraftData) {
  const grade = root.querySelector('select') as HTMLSelectElement | null;
  if (grade && data.grade) setControlValue(grade, data.grade);
  setText(root, 'input[placeholder="С-130"]', data.number);
  setNumber(root, 'Проектная головы', data.designHead);
  setNumber(root, 'Фактическая головы', data.actualHead);
  setNumber(root, 'Глубина погружения', data.depth);

  // Залоги: доводим число строк до сохранённого и заполняем по порядку.
  const addButton = Array.from(root.querySelectorAll('button'))
    .find((button) => button.textContent?.trim() === '+ Добавить залог');
  let guard = 0;
  while (addButton && numberInputsByLabel(root, 'Ударов').length < data.sets.length && guard < 30) {
    addButton.click();
    guard += 1;
  }
  const blows = numberInputsByLabel(root, 'Ударов');
  const penetration = numberInputsByLabel(root, 'Погружение');
  const setHeights = numberInputsByLabel(root, 'Высота, м');
  data.sets.forEach((set, index) => {
    if (blows[index]) setControlValue(blows[index], set.blows);
    if (penetration[index]) setControlValue(penetration[index], set.penetration);
    if (setHeights[index]) setControlValue(setHeights[index], set.dropHeight);
  });

  setNumber(root, 'Проектный отказ', data.designRefusal);
  setNumber(root, 'Всего', data.totalBlows);
  setNumber(root, 'На последний метр', data.blowsLastMeter);
  setNumber(root, 'Высота падения молота', data.dropHeight);
  setNumber(root, 'В плане', data.planDeviation);
  setNumber(root, 'От вертикали', data.tilt);
  setCheckbox(checkboxByLabel(root, 'Добивка'), data.redriven);
  setCheckbox(checkboxByLabel(root, 'Погружение добойником'), data.followerUsed);
  setCheckbox(checkboxByLabel(root, 'Голова срублена'), data.headCutOff);
  const note = root.querySelector('textarea') as HTMLTextAreaElement | null;
  if (note && data.note) setControlValue(note, data.note);
}

function setNumber(root: HTMLElement, label: string, value: string) {
  if (!value) return;
  const input = numberInputsByLabel(root, label)[0];
  if (input) setControlValue(input, value);
}

function setText(root: HTMLElement, selector: string, value: string) {
  if (!value) return;
  const input = root.querySelector(selector) as HTMLInputElement | null;
  if (input) setControlValue(input, value);
}

/**
 * Значение в контролируемое поле — через родной сеттер и событие.
 *
 * Присваивание `input.value` напрямую React не увидит: состояние живёт у него,
 * а не в DOM. Событие `input`/`change` доходит до обработчика формы так же, как
 * от настоящего нажатия.
 */
function setControlValue(
  element: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement,
  value: string,
) {
  const proto = element instanceof HTMLSelectElement
    ? HTMLSelectElement.prototype
    : element instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  setter?.call(element, value);
  element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? 'change' : 'input', {bubbles: true}));
}

function setCheckbox(box: HTMLInputElement | null, value: boolean) {
  if (box && box.checked !== value) box.click();
}
