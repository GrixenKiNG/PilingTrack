import {
  cloneEquipmentTileTemplate,
  type EquipmentTileTemplate,
} from './equipment-tile-template';

const MAX_UNDO_SNAPSHOTS = 50;

export interface TemplateHistory {
  readonly present: EquipmentTileTemplate;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  push(next: EquipmentTileTemplate): EquipmentTileTemplate;
  undo(): EquipmentTileTemplate;
  redo(): EquipmentTileTemplate;
}

export function createTemplateHistory(initial: EquipmentTileTemplate): TemplateHistory {
  let snapshots = [cloneEquipmentTileTemplate(initial)];
  let index = 0;

  const current = () => cloneEquipmentTileTemplate(snapshots[index]);

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
      const snapshot = cloneEquipmentTileTemplate(next);
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
