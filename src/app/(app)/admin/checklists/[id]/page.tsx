'use client';

import { use } from 'react';
import { TemplateEditor } from '@/components/piling/inspections/template-editor';

export default function ChecklistEditorPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  return <TemplateEditor templateId={id} />;
}
