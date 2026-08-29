'use client';

import {useState} from 'react';
import {Button} from '@/components/ui/button';
import {Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle} from '@/components/ui/dialog';
import {PilingIcon, type PilingIconName} from '@/components/piling/icons/piling-icon';
import type {OperatorAction} from './api/contracts';
import {createOperatorCommandId, operatorFormForAction} from './api/action-registry';
import {DefectForm} from './forms/defect-form';
import {SafetyIncidentForm} from './forms/safety-incident-form';

const icons: Record<string, PilingIconName> = {'report-defect': 'defect', 'report-incident': 'risk', 'add-photo': 'camera'};

interface Props {
  actions: OperatorAction[];
  busyActionId: string | null;
  onAction: (action: OperatorAction, payload?: Record<string, unknown>, commandId?: string) => Promise<boolean>;
}

export function PersistentSafetyActions({actions, busyActionId, onAction}: Props) {
  const [activeAction, setActiveAction] = useState<OperatorAction | null>(null);
  const [preparedCommandId, setPreparedCommandId] = useState<string | null>(null);
  const [waitingForServer, setWaitingForServer] = useState(false);
  const form = activeAction ? operatorFormForAction(activeAction) : null;

  const open = (action: OperatorAction) => {
    const actionForm = operatorFormForAction(action);
    if (!actionForm) { void onAction(action); return; }
    setActiveAction(action);
    setPreparedCommandId(actionForm === 'PHOTO' ? null : createOperatorCommandId());
  };
  const close = () => { if (!busyActionId && !waitingForServer) { setActiveAction(null); setPreparedCommandId(null); } };
  const submit = async (payload: Record<string, unknown>) => {
    if (!activeAction || activeAction.kind !== 'COMMAND' || !preparedCommandId) return;
    setWaitingForServer(true);
    const confirmed = await onAction(activeAction, payload, preparedCommandId);
    setWaitingForServer(false);
    if (confirmed) {
      setActiveAction(null);
      setPreparedCommandId(null);
    }
  };
  const choosePhotoPurpose = (id: 'report-defect' | 'report-incident') => {
    const target = actions.find((action) => action.id === id && action.kind === 'COMMAND');
    if (!target) return;
    setActiveAction(target);
    setPreparedCommandId(createOperatorCommandId());
  };

  return <>
    <section aria-labelledby="safety-actions-title"><h2 id="safety-actions-title" className="mb-3 text-sm font-semibold">Быстрые действия безопасности</h2><div className="grid grid-cols-1 gap-2 sm:grid-cols-3">{actions.map((action) => <Button key={action.id} data-testid="operator-safety-action" variant="outline" className={`min-h-12 justify-start whitespace-normal text-left ${action.id === 'report-incident' ? 'border-destructive/50 text-destructive hover:bg-destructive/5 hover:text-destructive' : ''}`} disabled={busyActionId === action.id} onClick={() => open(action)}><PilingIcon name={icons[action.id] ?? 'activity'} size={18} decorative />{action.label}</Button>)}</div></section>
    <Dialog open={activeAction !== null} onOpenChange={(isOpen) => { if (!isOpen) close(); }}>
      <DialogContent className="max-h-[100dvh] max-w-none overflow-y-auto rounded-none sm:max-h-[90dvh] sm:max-w-xl sm:rounded-lg">
        <DialogHeader><DialogTitle>{form === 'DEFECT' ? 'Сообщить о дефекте' : form === 'SAFETY_INCIDENT' ? 'Сообщить об опасном событии' : 'Добавить фотографию'}</DialogTitle><DialogDescription>{form === 'PHOTO' ? 'Выберите, к какому факту относится доказательство.' : 'Зафиксируйте только наблюдаемые факты. Критичность определит серверное правило.'}</DialogDescription></DialogHeader>
        {form === 'DEFECT' && activeAction && <DefectForm action={activeAction} commandId={preparedCommandId ?? undefined} busy={waitingForServer || busyActionId === activeAction.id} onCancel={close} onSubmit={(payload) => void submit(payload)} />}
        {form === 'SAFETY_INCIDENT' && activeAction && <SafetyIncidentForm action={activeAction} commandId={preparedCommandId ?? undefined} busy={waitingForServer || busyActionId === activeAction.id} onCancel={close} onSubmit={(payload) => void submit(payload)} />}
        {form === 'PHOTO' && <div className="grid gap-3"><Button variant="outline" className="min-h-12 justify-start" disabled={!actions.some((action) => action.id === 'report-defect' && action.kind === 'COMMAND')} onClick={() => choosePhotoPurpose('report-defect')}>Фотография к дефекту</Button><Button variant="outline" className="min-h-12 justify-start" disabled={!actions.some((action) => action.id === 'report-incident' && action.kind === 'COMMAND')} onClick={() => choosePhotoPurpose('report-incident')}>Фотография к опасному событию</Button><p className="text-sm text-muted-foreground">Фотография будет загружена внутри выбранной формы и сохранена только вместе с серверным событием.</p></div>}
      </DialogContent>
    </Dialog>
  </>;
}
