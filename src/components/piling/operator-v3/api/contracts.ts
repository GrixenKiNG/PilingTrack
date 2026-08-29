import type {z} from 'zod';
import {operatorActionSchema, operatorPhaseSchema, operatorWorkplaceWireSchema} from './wire-contracts';

export type OperatorAction = z.infer<typeof operatorActionSchema>;
export type OperatorPhase = z.infer<typeof operatorPhaseSchema>;
export type OperatorWorkplace = z.infer<typeof operatorWorkplaceWireSchema>;

export interface PhotoEvidence {
  mediaId: string;
  fileName: string;
  contentType: string;
  size: number;
}
