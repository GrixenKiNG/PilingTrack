'use client';

import {useState} from 'react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Label} from '@/components/ui/label';

export function MeterReadingForm({current, onSubmit}: {current: number | null; onSubmit: (value: number) => void}) {
  const [value, setValue] = useState(current === null ? '' : String(current));
  const number = Number(value.replace(',', '.'));
  const invalid = !Number.isFinite(number) || number < 0 || (current !== null && number < current);
  return <form className="rounded-lg border bg-background p-4" onSubmit={(event) => {event.preventDefault(); if (!invalid) onSubmit(number);}}><Label htmlFor="operator-v3-meter">Текущее показание моточасов</Label><div className="mt-2 flex flex-col gap-2 sm:flex-row"><Input id="operator-v3-meter" inputMode="decimal" value={value} onChange={(event) => setValue(event.target.value)} aria-invalid={invalid} className="min-h-11 sm:max-w-56" /><Button type="submit" disabled={invalid} className="min-h-11">Записать моточасы</Button></div>{invalid && <p className="mt-2 text-sm text-destructive">Укажите число не меньше последнего показания</p>}</form>;
}
