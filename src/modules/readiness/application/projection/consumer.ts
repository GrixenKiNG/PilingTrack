import {projectReadinessEvent} from './project-event';

export function isReadinessProjectionEvent(event: {type?: string}): boolean {
  return event.type === 'ReadinessSnapshotRequested';
}

export async function consumeReadinessProjectionEvent(event: {id?: string; type?: string}) {
  if (!isReadinessProjectionEvent(event)) return false;
  if (!event.id) throw new Error('Readiness projection event id is required');
  await projectReadinessEvent(event.id);
  return true;
}
