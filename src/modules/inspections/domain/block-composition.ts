/**
 * Checklist block composition (pure domain logic).
 *
 * A machine's inspection checklist is assembled from up to three reusable
 * blocks selected by the equipment's attributes:
 *   - BASE   — by brand/model (manufacturer regulation)
 *   - HAMMER — by hammer kind (hydraulic / diesel), skipped when no hammer
 *   - ROTARY — only for combined rigs (have a rotary head / вращатель)
 *
 * `requiredBlockTypes` decides WHICH blocks a machine needs (the application
 * layer then queries them, tenant-scoped). `composeChecklist` flattens the
 * found blocks into the snapshot stored on the inspection.
 */

import type { AnswerType } from './inspection-logic';

export type BlockType = 'BASE' | 'HAMMER' | 'ROTARY';
export type HammerKind = 'HYDRAULIC' | 'DIESEL' | 'NONE';

export interface BlockItem {
  id: string;
  text: string;
  answerType: AnswerType;
  unit: string | null;
  norm: string | null;
  provenance: string | null;
  required: boolean;
  photoRequired: boolean;
  order: number;
}

export interface BlockSection {
  title: string;
  order: number;
  items: BlockItem[];
}

export interface TemplateBlock {
  blockType: BlockType;
  name: string;
  sections: BlockSection[];
}

/** Flattened snapshot item — one row per checklist line, stamped with provenance. */
export interface ComposedItem {
  id: string;
  blockType: BlockType;
  blockName: string;
  sectionTitle: string;
  text: string;
  answerType: AnswerType;
  unit: string | null;
  norm: string | null;
  provenance: string | null;
  required: boolean;
  photoRequired: boolean;
}

const BLOCK_ORDER: Record<BlockType, number> = { BASE: 0, HAMMER: 1, ROTARY: 2 };

/** Which block types this machine's checklist needs, in assembly order. */
export function requiredBlockTypes(eq: { hammerKind: HammerKind; isCombined: boolean }): BlockType[] {
  const types: BlockType[] = ['BASE'];
  if (eq.hammerKind !== 'NONE') types.push('HAMMER');
  if (eq.isCombined) types.push('ROTARY');
  return types;
}

export interface CandidateBlock extends TemplateBlock {
  id: string;                            // template id (для FK Inspection.templateId)
  appliesToModel: string | null;
  appliesToHammerKind: HammerKind | null;
}

/**
 * Pick one block per required type from the candidate pool (pure selection).
 *   BASE   — exact model match, else a generic block (appliesToModel = null).
 *   HAMMER — match the machine's hammer kind.
 *   ROTARY — first available (combined rigs only).
 * Blocks not found are simply omitted; composeChecklist enforces BASE presence.
 */
export function selectBlocks(
  candidates: CandidateBlock[],
  eq: { model: string; hammerKind: HammerKind; isCombined: boolean },
): CandidateBlock[] {
  const needed = requiredBlockTypes(eq);
  const out: CandidateBlock[] = [];
  for (const type of needed) {
    let pick: CandidateBlock | undefined;
    if (type === 'BASE') {
      pick = candidates.find((c) => c.blockType === 'BASE' && c.appliesToModel === eq.model)
        ?? candidates.find((c) => c.blockType === 'BASE' && c.appliesToModel == null);
    } else if (type === 'HAMMER') {
      pick = candidates.find((c) => c.blockType === 'HAMMER' && c.appliesToHammerKind === eq.hammerKind);
    } else {
      pick = candidates.find((c) => c.blockType === 'ROTARY');
    }
    if (pick) out.push(pick);
  }
  return out;
}

/**
 * Flatten selected blocks into an ordered snapshot.
 * Order: BASE → HAMMER → ROTARY; then section.order, then item.order.
 * Throws if no BASE block is present — a checklist without a base is invalid.
 */
export function composeChecklist(blocks: TemplateBlock[]): ComposedItem[] {
  if (!blocks.some((b) => b.blockType === 'BASE')) {
    throw new Error('Невозможно собрать чек-лист: нет блока «База» для этой машины');
  }
  const ordered = [...blocks].sort((a, b) => BLOCK_ORDER[a.blockType] - BLOCK_ORDER[b.blockType]);
  const out: ComposedItem[] = [];
  for (const block of ordered) {
    const sections = [...block.sections].sort((a, b) => a.order - b.order);
    for (const section of sections) {
      const items = [...section.items].sort((a, b) => a.order - b.order);
      for (const item of items) {
        out.push({
          id: item.id,
          blockType: block.blockType,
          blockName: block.name,
          sectionTitle: section.title,
          text: item.text,
          answerType: item.answerType,
          unit: item.unit,
          norm: item.norm,
          provenance: item.provenance,
          required: item.required,
          photoRequired: item.photoRequired,
        });
      }
    }
  }
  return out;
}
