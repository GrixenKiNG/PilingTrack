'use client';

import {useState} from 'react';
import {
  INCIDENT_CATEGORIES, INCIDENT_CATEGORY_HINTS, INCIDENT_CATEGORY_LABELS,
  INCIDENT_DESCRIPTION_MIN, INCIDENT_SEVERITY_LABELS, INCIDENT_SIGN_LABELS, INCIDENT_SIGNS,
  isIncidentOpen,
  type IncidentCategory, type IncidentSign, type OperatorMobileState,
} from '@/modules/operator-mobile/contracts';
import {cn} from '@/lib/utils';
import {uploadPhoto} from '../api';
import {BigButton, ErrorNote, Panel, PanelTitle, Sign} from '../ui';

/**
 * Происшествия смены: журнал и запись нового.
 *
 * ЧЕМ ОТЛИЧАЕТСЯ ОТ НЕИСПРАВНОСТИ. Неисправность — про машину, её чинит
 * механик. Происшествие — про смену: человек ушибся, посторонний зашёл в
 * опасную зону, разлили масло. Его не чинят, его разбирают, и поэтому оно
 * живёт здесь, а не в карточке техники.
 *
 * ПОЧЕМУ ЗАПИСЬ НИЧЕГО НЕ ЗАПИРАЕТ. Правило по названным признакам само
 * решает, насколько это опасно, и может сказать «работы прекращают». Но
 * прекращает их человек: приложение не видит площадку и не знает, чем
 * обернётся остановка посреди погружения сваи. Запись поднимает красное
 * предупреждение машинисту и диспетчеру и остаётся на виду до разбора.
 */
export function IncidentsTab({state, busy, error, commandId, onReport}: {
  state: OperatorMobileState;
  busy: boolean;
  error: string | null;
  /**
   * Ключ команды. Снимки привязываются к нему: записи происшествия в момент
   * съёмки ещё нет, а привязать фото к чему-то надо — иначе сервер не сможет
   * проверить, что снимок относится именно к этому событию.
   */
  commandId: string;
  /** Возвращает признак удачи: по нему форма закрывается или остаётся. */
  onReport: (input: {
    category: IncidentCategory; signs: IncidentSign[]; injured: boolean; description: string;
    mediaIds: string[];
  }) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<IncidentCategory | null>(null);
  const [signs, setSigns] = useState<IncidentSign[]>([]);
  const [injured, setInjured] = useState(false);
  const [description, setDescription] = useState('');
  const [mediaIds, setMediaIds] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);

  const toggleSign = (sign: IncidentSign) => setSigns((current) => (
    current.includes(sign) ? current.filter((item) => item !== sign) : [...current, sign]
  ));

  const ready = category !== null
    && signs.length > 0
    && description.trim().length >= INCIDENT_DESCRIPTION_MIN;

  // Форма закрывается только после ответа сервера. Описание происшествия
  // человек пишет один раз и своими словами; заставить его вспоминать
  // формулировку заново из-за оборвавшейся связи — верный способ получить в
  // журнале «прочее» вместо того, что было на самом деле.
  const attach = async (file: File | undefined) => {
    if (!file) return;
    setPhotoError(null);
    setUploading(true);
    try {
      const mediaId = await uploadPhoto({file, clientCommandId: commandId, entityType: 'safety_incident'});
      setMediaIds((current) => [...current, mediaId]);
    } catch (uploadError) {
      setPhotoError(uploadError instanceof Error ? uploadError.message : 'Снимок не загрузился');
    } finally {
      setUploading(false);
    }
  };

  const submit = async () => {
    if (!category || !ready) return;
    const recorded = await onReport({
      category, signs, injured, description: description.trim(), mediaIds,
    });
    if (!recorded) return;

    setOpen(false);
    setCategory(null);
    setSigns([]);
    setInjured(false);
    setDescription('');
    setMediaIds([]);
    setPhotoError(null);
  };

  if (!open) {
    return (
      <>
        <BigButton tone="danger" onClick={() => setOpen(true)}>Записать происшествие</BigButton>

        {state.incidents.length === 0 ? (
          <Panel tone="ok">
            <PanelTitle tone="ok">Происшествий на смене нет</PanelTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              Записывайте и то, что чуть не кончилось плохо, — даже если обошлось. Разбор таких
              случаев дешевле разбора настоящих.
            </p>
          </Panel>
        ) : (
          state.incidents.map((incident) => {
            // Разобранное происшествие перестаёт кричать, но не исчезает:
            // машинист должен видеть, что его запись дошла и по ней ответили.
            const open = isIncidentOpen(incident.reviewedAt);
            const tone = !open ? 'ok' : incident.severity === 'NORMAL' ? 'warning' : 'danger';
            return (
            <Panel key={incident.id} tone={tone}>
              <div className="flex gap-2">
                <Sign tone={tone === 'ok' ? 'ok' : tone === 'warning' ? 'warning' : 'danger'} />
                <div className="min-w-0 flex-1">
                  <PanelTitle tone={tone}>
                    {INCIDENT_CATEGORY_LABELS[incident.category] ?? incident.category}
                  </PanelTitle>
                  <p className="mt-1 text-sm">{incident.description}</p>
                  <p className="mt-1 text-2xs text-muted-foreground">
                    {INCIDENT_SEVERITY_LABELS[incident.severity] ?? incident.severity}
                    {incident.injured ? ' · есть пострадавшие' : ''}
                    {' · '}
                    {new Date(incident.occurredAt).toLocaleTimeString('ru-RU', {
                      hour: '2-digit', minute: '2-digit',
                    })}
                  </p>
                  <p className="mt-1 text-2xs text-muted-foreground">
                    {incident.signs.map((sign) => INCIDENT_SIGN_LABELS[sign] ?? sign).join(', ')}
                    {incident.photos > 0 ? ` · снимков: ${incident.photos}` : ''}
                  </p>
                  {incident.stopRequired && open ? (
                    <p className="mt-2 text-2xs font-semibold text-destructive">
                      Правило требует прекратить работы и привести машину в безопасное состояние.
                    </p>
                  ) : null}
                  {open ? null : (
                    <p className="mt-2 text-2xs font-semibold text-success">Разобрано диспетчером</p>
                  )}
                </div>
              </div>
            </Panel>
            );
          })
        )}
      </>
    );
  }

  return (
    <>
      <ErrorNote message={error} />

      <div className="space-y-2">
        <h2 className="text-3xs font-semibold uppercase tracking-wider text-muted-foreground">
          Что произошло
        </h2>
        {INCIDENT_CATEGORIES.map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => setCategory(option)}
            className={cn(
              'min-h-12 w-full rounded-lg border bg-card px-4 py-2 text-left shadow-xs transition-colors',
              category === option ? 'border-signal bg-signal/10' : 'hover:bg-secondary',
            )}
          >
            <span className="block text-sm font-semibold">{INCIDENT_CATEGORY_LABELS[option]}</span>
            <span className="block text-2xs text-muted-foreground">
              {INCIDENT_CATEGORY_HINTS[option]}
            </span>
          </button>
        ))}
      </div>

      <div className="space-y-2">
        <h2 className="text-3xs font-semibold uppercase tracking-wider text-muted-foreground">
          Что вы видели или слышали
        </h2>
        <p className="text-2xs text-muted-foreground">
          Отметьте всё подходящее. Опасность оценивается по этим признакам, а не по тому,
          насколько подробно написано в описании.
        </p>
        <div className="flex flex-wrap gap-2">
          {INCIDENT_SIGNS.map((sign) => (
            <button
              key={sign}
              type="button"
              onClick={() => toggleSign(sign)}
              className={cn(
                'min-h-11 rounded-lg border bg-card px-3 text-sm font-medium shadow-xs transition-colors',
                signs.includes(sign) ? 'border-signal bg-signal/10' : 'hover:bg-secondary',
              )}
            >
              {INCIDENT_SIGN_LABELS[sign]}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <h2 className="text-3xs font-semibold uppercase tracking-wider text-muted-foreground">
          Пострадавшие
        </h2>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setInjured(false)}
            className={cn(
              'min-h-12 rounded-lg border bg-card px-3 text-sm font-semibold shadow-xs transition-colors',
              injured ? 'hover:bg-secondary' : 'border-signal bg-signal/10',
            )}
          >
            Нет
          </button>
          <button
            type="button"
            onClick={() => setInjured(true)}
            className={cn(
              'min-h-12 rounded-lg border bg-card px-3 text-sm font-semibold shadow-xs transition-colors',
              injured ? 'border-destructive bg-destructive/10 text-destructive' : 'hover:bg-secondary',
            )}
          >
            Есть
          </button>
        </div>
        {injured ? (
          <p className="text-2xs font-semibold text-destructive">
            Сначала помогите человеку и вызовите помощь. Запись подождёт.
          </p>
        ) : null}
      </div>

      <div className="space-y-2">
        <label
          htmlFor="incident-description"
          className="block text-3xs font-semibold uppercase tracking-wider text-muted-foreground"
        >
          Как было дело
        </label>
        <textarea
          id="incident-description"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          rows={4}
          placeholder="Своими словами: где, когда, что делали, чем кончилось"
          className="w-full rounded-lg border bg-card px-3 py-2 text-base shadow-xs"
        />
        {description.trim().length > 0 && description.trim().length < INCIDENT_DESCRIPTION_MIN ? (
          <p className="text-2xs text-muted-foreground">
            Ещё немного: через неделю по этой записи будут разбираться.
          </p>
        ) : null}
      </div>

      <div className="space-y-2">
        <span className="block text-3xs font-semibold uppercase tracking-wider text-muted-foreground">
          Снимки
        </span>
        {/*
          Фото необязательно намеренно: у происшествия с человеком первое
          действие — помочь, а не снимать. Но если снять есть чем и когда,
          снимок объясняет разбору больше, чем страница текста.
        */}
        <label className="flex min-h-12 w-full cursor-pointer items-center justify-center rounded-lg border border-dashed bg-card px-4 text-sm font-medium shadow-xs hover:bg-secondary">
          <input
            type="file"
            accept="image/*"
            capture="environment"
            className="sr-only"
            onChange={(event) => {
              void attach(event.target.files?.[0]);
              event.target.value = '';
            }}
          />
          {uploading ? 'Загружаем…' : mediaIds.length > 0 ? `Снимков: ${mediaIds.length}. Добавить ещё` : 'Добавить снимок'}
        </label>
        {photoError ? (
          <p className="text-2xs font-semibold text-destructive">{photoError}</p>
        ) : null}
      </div>

      <div className="space-y-2">
        <BigButton tone="danger" onClick={() => void submit()} disabled={!ready || busy || uploading}>
          {busy ? 'Записываем…' : 'Записать происшествие'}
        </BigButton>
        <BigButton tone="ghost" onClick={() => setOpen(false)}>Отмена</BigButton>
      </div>
    </>
  );
}
