/**
 * Undo/redo snapshot history for layout templates (shared editor engine).
 * Extracted 1:1 from the monitoring equipment-tile history.
 */

import { cloneLayoutTemplate, type LayoutTemplate } from './layout-template';

const MAX_UNDO_SNAPSHOTS = 50;

export interface TemplateHistory<T extends LayoutTemplate = LayoutTemplate> {
  readonly present: T;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  push(next: T): T;
  undo(): T;
  redo(): T;
}

export function createTemplateHistory<T extends LayoutTemplate>(initial: T): TemplateHistory<T> {
  let snapshots = [cloneLayoutTemplate(initial)];
  let index = 0;

  const current = () => cloneLayoutTemplate(snapshots[index]);

  return {
    get present() {
      return current();
    },
    get canUndo() {
      return index > 0;
    },
    get canRedo() {
      return index < snapshots.length - 1;
    },
    push(next) {
      const snapshot = cloneLayoutTemplate(next);
      if (JSON.stringify(snapshot) === JSON.stringify(snapshots[index])) return current();
      snapshots = [...snapshots.slice(0, index + 1), snapshot];
      if (snapshots.length > MAX_UNDO_SNAPSHOTS + 1) snapshots.shift();
      index = snapshots.length - 1;
      return current();
    },
    undo() {
      if (index > 0) index -= 1;
      return current();
    },
    redo() {
      if (index < snapshots.length - 1) index += 1;
      return current();
    },
  };
}
