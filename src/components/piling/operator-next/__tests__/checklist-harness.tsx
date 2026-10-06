import {useState} from 'react';
import type {ChecklistAnswer, ChecklistView, WorkWarning} from '@/modules/operator-mobile/contracts';
import {ChecklistRunScreen} from '../checklist-run';
import type {ChecklistDrafts} from '../drafts';

/**
 * Оболочка ответов осмотра для одиночных экранов.
 *
 * Экран осмотра управляемый: ответы живут выше (в приложении — в оболочке
 * `operator-next-app.tsx`). Тесту нужна такая же оболочка, иначе проверялось бы
 * не то поведение, что в продукте.
 */
export function ChecklistHarness({
  checklist, warnings = [], busy = false, error = null, commandId = 'cmd-1',
  onSubmit = () => {}, onExit,
}: {
  checklist: ChecklistView;
  warnings?: WorkWarning[];
  busy?: boolean;
  error?: string | null;
  commandId?: string;
  onSubmit?: (answers: ChecklistAnswer[]) => void;
  onExit?: () => void;
}) {
  const [drafts, setDrafts] = useState<ChecklistDrafts>({});
  return (
    <ChecklistRunScreen
      checklist={checklist}
      warnings={warnings}
      busy={busy}
      error={error}
      commandId={commandId}
      drafts={drafts}
      onDraftsChange={(updater) => setDrafts((current) => updater(current))}
      onSubmit={onSubmit}
      onExit={onExit}
    />
  );
}
