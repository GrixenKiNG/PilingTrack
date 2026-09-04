import {db} from '@/lib/db';
import type {DefectView} from '../domain/view-contracts';

/**
 * Неисправность к виду, в котором её читают на телефоне.
 *
 * ПОЧЕМУ ОБЩЕЕ МЕСТО. Список открытых неисправностей показывают два экрана —
 * машиниста и помощника, — и собирают его из одних и тех же строк. Две копии
 * сборки означали бы, что одна и та же поломка на двух телефонах подписана
 * по-разному, а разойтись им достаточно одной правки.
 *
 * ПОЧЕМУ ИМЯ ОТДЕЛЬНЫМ ЗАПРОСОМ. У `EquipmentDefect.reportedById` нет связи с
 * пользователем — это просто идентификатор. Достаём имена одним запросом на
 * весь список: по машине их единицы, а join взять неоткуда.
 *
 * ЧТО ЕСЛИ АВТОРА НЕ НАШЛИ. Учётку могли отключить или удалить, а запись
 * остаётся — она про машину, а не про человека. Тогда подписываем честно
 * «неизвестно кто»: пустая строка на её месте читалась бы как «никто не
 * заводил», и это хуже, чем признать, что автор потерялся.
 */
export interface DefectRow {
  id: string;
  title: string;
  severity: string;
  status: string;
  reportedAt: Date;
  reportedById: string;
}

export async function toDefectViews(input: {
  tenantId: string;
  /** Кто смотрит: его собственные записи подписываются иначе. */
  viewerId: string;
  defects: DefectRow[];
}): Promise<DefectView[]> {
  if (input.defects.length === 0) return [];

  const ids = [...new Set(input.defects.map((defect) => defect.reportedById))];
  // Строгое равенство по тенанту: имя человека из другой организации в этот
  // список попасть не может, даже если идентификатор совпал.
  const people = await db.user.findMany({
    where: {tenantId: input.tenantId, id: {in: ids}},
    select: {id: true, name: true},
  });
  const names = new Map(people.map((person) => [person.id, person.name]));

  return input.defects.map((defect) => ({
    id: defect.id,
    title: defect.title,
    severity: defect.severity,
    status: defect.status,
    reportedAt: defect.reportedAt.toISOString(),
    reportedByName: names.get(defect.reportedById) ?? 'неизвестно кто',
    reportedByMe: defect.reportedById === input.viewerId,
  }));
}
