export type OperatorChecklistStage =
  | 'PRE_SHIFT'
  | 'SITE'
  | 'STARTUP'
  | 'PILE_SAFETY'
  | 'DRILLING_SAFETY'
  | 'PRE_WORK_SERVICE'
  | 'POST_SHIFT'
  | 'FLUIDS';

export type OperatorChecklistAnswerType =
  | 'PASS_FAIL_NA'
  | 'YES_NO'
  | 'NUMBER'
  | 'TEMPERATURE'
  | 'PRESSURE'
  | 'QUANTITY'
  | 'TEXT'
  | 'PHOTO'
  | 'SIGNATURE'
  | 'ACTION_STATUS';

export type OperatorChecklistCriticality = 'INFO' | 'NORMAL' | 'IMPORTANT' | 'CRITICAL';

export interface OperatorChecklistItemDefinition {
  id: string;
  text: string;
  answerType: OperatorChecklistAnswerType;
  criticality: OperatorChecklistCriticality;
  required: boolean;
  photoOnFailure: boolean;
  unit: string | null;
  ruleCode: string | null;
}

export interface OperatorChecklistSectionDefinition {
  id: string;
  title: string;
  items: OperatorChecklistItemDefinition[];
}

export interface OperatorChecklistTemplateDefinition {
  id: string;
  version: string;
  name: string;
  stage: OperatorChecklistStage;
  equipmentModel: string;
  technology: 'PILE_DRIVING' | 'LEADER_DRILLING' | null;
  sections: OperatorChecklistSectionDefinition[];
}

export interface SelectOperatorChecklistTemplateInput {
  stage: OperatorChecklistStage;
  equipmentModel: string;
  technology: 'PILE_DRIVING' | 'LEADER_DRILLING' | null;
}
