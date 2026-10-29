import { ToModule } from '@/components/piling/to/to-module';
import { MyClearanceScreen } from '@/components/piling/to/readiness/screens/my-clearance-screen';
import { readPageSessionUser } from '@/lib/page-session';

/**
 * «ТБ и допуски» — модуль охраны труда: допуски работников, документы, журнал
 * инструктажей, разбор происшествий и наряды-допуски.
 *
 * Оболочка та же, что у «Техготовности» (`ToModule`), и это сделано нарочно:
 * данные оба модуля берут из одного bootstrap контура готовности, а различает
 * их набор вкладок. Своя копия загрузки рабочего пространства означала бы два
 * расходящихся представления об одних и тех же правах и правилах.
 * Помощнику нужен только личный допуск: bootstrap готовности ему закрыт,
 * поэтому этот экран читается своим запросом, без загрузки рабочего пространства парка.
 */
export default async function SafetyPage() {
  const user = await readPageSessionUser();
  if (user?.role === 'ASSISTANT') return <MyClearanceScreen />;
  return <ToModule surface="safety" />;
}
