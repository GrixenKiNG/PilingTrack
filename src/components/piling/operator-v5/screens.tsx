import type {ReactNode} from 'react';

/**
 * Содержимое тридцати четырёх экранов смены, перенесённое из макета
 * `docs/product/operator-v1-screens.html` без изменений: та же разметка, те же
 * классы, тот же текст и те же данные (Сидоров А. В., Liebherr LRH 100,
 * наряд № 118).
 *
 * Файл собран скриптом из макета, поэтому правки вносятся в макет, а не сюда:
 * иначе прототип и согласованный документ разойдутся.
 *
 * Экраны не знают, куда ведут их кнопки. Переходы объявлены отдельно в
 * `flow.ts`, а обработчик один на всё приложение — так разметка остаётся
 * дословно макетной, без единого onClick внутри.
 */
export interface OperatorScreen {
  /** Название экрана из подписи в макете. */
  title: string;
  /** «основной», «подэкран» или «состояние» — тоже из подписи. */
  kind: string;
  content: ReactNode;
}

export const SCREEN_ORDER = ['A1', 'A2', 'A3', 'A4', 'B1', 'B2', 'B3', 'B4', 'B5', 'C1', 'C2', 'C3', 'C4', 'D1', 'D2', 'D3', 'D4', 'E1', 'E2', 'E3', 'E4', 'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'G1', 'G2', 'G3', 'G4', 'G5', 'H1', 'H2'] as const;

export type ScreenId = (typeof SCREEN_ORDER)[number];

export const SCREENS: Record<ScreenId, OperatorScreen> = {
  'A1': {
    title: "Вход по коду",
    kind: "основной",
    content: (
      <>
      <div className="bar"><span><span className="dot"></span>На связи</span><span>06:52</span></div>
      <div className="scr" style={{gap: '1rem'}}>
      <p className="kicker">Вход</p>
      <p className="h">Сидоров А. В.<br />Машинист</p>
      <p className="m">Смена 29.08 · дневная</p>
      <div className="bignum">• • • •</div>
      <div className="keys"><span>1</span><span>2</span><span>3</span><span>4</span><span>5</span><span>6</span><span>7</span><span>8</span><span>9</span><span>⌫</span><span>0</span><span>✓</span></div>
      <p className="note">Не вы? Сменить пользователя.</p>
      </div>
      </>
    ),
  },
  'A2': {
    title: "Допуск: сводка",
    kind: "основной",
    content: (
      <>
      <div className="bar"><span><span className="dot"></span>На связи</span><span>06:53</span></div>
      <div className="ok-head"><span className="t">Допуск открыт</span><span className="s">Все документы действуют</span></div>
      <div className="scr">
      <div className="rowline"><span>Удостоверение машиниста</span><span className="badge ok">до 14.03.27</span></div>
      <div className="rowline"><span>Медицинская справка</span><span className="badge ok">до 02.11.26</span></div>
      <div className="rowline"><span>Проверка знаний по ОТ</span><span className="badge warn">28 дней</span></div>
      <div className="rowline"><span>Допуск к Liebherr LRH&nbsp;100</span><span className="badge ok">есть</span></div>
      <button className="b" type="button">Дальше — приёмка машины</button>
      <p className="note warn">Проверка знаний истекает 26.09. Ответственный за ТБ уже уведомлён.</p>
      </div>
      </>
    ),
  },
  'A3': {
    title: "Карточка документов",
    kind: "подэкран",
    content: (
      <>
      <div className="nav"><span className="back">‹ Назад</span><span className="ttl">Документы</span></div>
      <div className="scr">
      <div className="card"><span className="lbl">Удостоверение машиниста</span><p>№ 4471 · выдано 14.03.24 · действует до 14.03.27</p><p className="m">Скан загружен 15.03.24</p></div>
      <div className="card"><span className="lbl">Медицинская справка</span><p>Годен · до 02.11.26</p><p className="m">Скан загружен 03.11.25</p></div>
      <div className="card"><span className="lbl">Проверка знаний по ОТ</span><p>Протокол № 12 от 26.09.25 · действует 12 мес.</p><p className="m">Зарегистрировал: Волков П. С., ответственный за ТБ</p></div>
      <p className="note">Загружает документы администратор. Оператор их только видит.</p>
      </div>
      </>
    ),
  },
  'A4': {
    title: "Допуск закрыт",
    kind: "состояние",
    content: (
      <>
      <div className="bar"><span><span className="dot"></span>На связи</span><span>06:54</span></div>
      <div className="stop-head"><span className="t">Работать нельзя</span><span className="s">Медицинская справка просрочена 12 дней</span></div>
      <div className="scr">
      <div className="chain">
      <div><span className="k">Условие</span><span>Действующая медсправка</span></div>
      <div><span className="k">Данные</span><span>Срок истёк 17.08.26</span></div>
      <div><span className="k">Правило</span><span>Просрочка документа — жёсткий стоп</span></div>
      <div><span className="k">Результат</span><span>Смена не открывается</span></div>
      </div>
      <button className="b dn" type="button">Сообщить администратору</button>
      <p className="note bad">Эту блокировку нельзя снять разрешением. Нужна новая справка.</p>
      </div>
      </>
    ),
  },
  'B1': {
    title: "Что ждёт подтверждения",
    kind: "основной",
    content: (
      <>
      <div className="bar"><span><span className="dot"></span>На связи</span><span>06:56</span></div>
      <div className="nav"><span className="ttl">Инструктажи</span></div>
      <div className="scr">
      <p className="kicker">Ждёт вашего подтверждения · 2</p>
      <div className="rowline"><span>Инструкция по охране труда<br /><span className="r">машинист копра · ред. 4 от 12.08.26</span></span><span className="badge warn">новая</span></div>
      <div className="rowline"><span>Целевой инструктаж<br /><span className="r">наряд № 118 · куст 7</span></span><span className="badge warn">к наряду</span></div>
      <div className="rowline"><span>Повторный инструктаж<br /><span className="r">проведён 04.08.26 · Волков П. С.</span></span><span className="badge ok">учтён</span></div>
      <button className="b" type="button">Открыть инструкцию</button>
      <p className="note">Пока не подтверждены обе — смена не откроется.</p>
      </div>
      </>
    ),
  },
  'B2': {
    title: "Чтение и подтверждение",
    kind: "подэкран",
    content: (
      <>
      <div className="nav"><span className="back">‹ Назад</span><span className="ttl">Инструкция · ред. 4</span></div>
      <div className="pbar"><i style={{width: '78%'}}></i></div>
      <div className="scr">
      <p className="m">Утвердил: Волков П. С. · 12.08.26</p>
      <div className="doc">
      <b>3.4.</b> Перед подъёмом сваи убедиться, что в опасной зоне молота нет людей и техники.
      Опасной зоной считается участок радиусом не менее высоты мачты плюс пять метров.<br /><br />
      <b>3.5.</b> Запрещается находиться под поднятым грузом и в створе натянутого троса.<br /><br />
      <b>3.6.</b> При обнаружении обрыва прядей троса работу прекратить…
      </div>
      <p className="m">Прочитано 78 % · осталось 2 страницы</p>
      <button className="b dis" type="button">Подтвердить ознакомление</button>
      <p className="note">Кнопка включится, когда документ пролистан до конца.</p>
      </div>
      </>
    ),
  },
  'B3': {
    title: "Проверка знаний",
    kind: "подэкран",
    content: (
      <>
      <div className="nav"><span className="back">‹ Выйти</span><span className="ttl">Проверка знаний</span></div>
      <div className="pbar"><i style={{width: '60%'}}></i></div>
      <div className="scr">
      <p className="kicker">Вопрос 3 из 5 · опасная зона</p>
      <p className="p"><b>Оператор заметил обрыв двух прядей троса в середине смены. Что он делает?</b></p>
      <div className="qz">
      <div className="opt">Дорабатывает куст и сообщает в конце смены</div>
      <div className="opt sel">Прекращает работу и фиксирует дефект</div>
      <div className="opt">Снижает высоту подъёма и продолжает</div>
      </div>
      <button className="b" type="button">Ответить</button>
      <p className="note">Нужно 4 правильных из 5. Балл нигде не показывается — он только для разбора.</p>
      </div>
      </>
    ),
  },
  'B4': {
    title: "Провал теста",
    kind: "состояние",
    content: (
      <>
      <div className="bar"><span><span className="dot"></span>На связи</span><span>07:01</span></div>
      <div className="stop-head"><span className="t">Не сдано</span><span className="s">3 правильных из 5 — нужно 4</span></div>
      <div className="scr">
      <p className="p">Ошибки в темах: <b>опасная зона молота</b>, <b>повреждение троса</b>.</p>
      <div className="card"><span className="lbl">Что дальше</span><p>Волкову П. С. отправлено уведомление. Он проводит повторный инструктаж и снимает блокировку.</p></div>
      <button className="b gh" type="button">Позвонить ответственному за ТБ</button>
      <p className="note bad">До повторного инструктажа смена не открывается. Пересдать самому нельзя.</p>
      </div>
      </>
    ),
  },
  'B5': {
    title: "Целевой инструктаж",
    kind: "подэкран",
    content: (
      <>
      <div className="nav"><span className="back">‹ Назад</span><span className="ttl">Целевой инструктаж</span></div>
      <div className="scr">
      <p className="kicker">Наряд № 118 · куст 7 · забивка</p>
      <div className="card"><span className="lbl">Особые условия работ</span><p>ЛЭП 10 кВ в 18 м восточнее. Подъём мачты в секторе востока запрещён.</p></div>
      <div className="card"><span className="lbl">Провёл</span><p>Волков П. С. · 06:40 · по связи</p></div>
      <button className="b" type="button">Подтверждаю, инструктаж получен</button>
      <p className="note warn">Ваша подпись — первая. Вторую поставит Волков П. С. при регистрации в журнале.</p>
      </div>
      </>
    ),
  },
  'C1': {
    title: "Выбор установки",
    kind: "основной",
    content: (
      <>
      <div className="bar"><span><span className="dot"></span>На связи</span><span>07:04</span></div>
      <div className="nav"><span className="ttl">Ваши установки</span></div>
      <div className="scr">
      <div className="rowline"><span>Liebherr LRH 100 · №4<br /><span className="r">объект «Северный» · свободна</span></span><span className="badge ok">выбрать</span></div>
      <div className="rowline"><span>Woltman PVE 50PR · №2<br /><span className="r">объект «Северный» · в ремонте</span></span><span className="badge bad">нельзя</span></div>
      <div className="rowline"><span>Banut 655 · №1<br /><span className="r">занята: Петров И.</span></span><span className="badge warn">занята</span></div>
      <p className="note">Показаны только закреплённые за вами машины.</p>
      </div>
      </>
    ),
  },
  'C2': {
    title: "Приёмка",
    kind: "основной",
    content: (
      <>
      <div className="bar"><span><span className="dot"></span>На связи</span><span>07:06</span></div>
      <div className="top"><span className="mach">Liebherr LRH 100 · №4</span><span className="where">Объект «Северный» · поле 3</span></div>
      <div className="scr">
      <p className="kicker">Шаг 2 из 7 · приёмка машины</p>
      <p className="h">Снять моточасы</p>
      <p className="m">1284 м/ч · до ТО 116 ч</p>
      <div className="card"><span className="lbl">Передача от смены</span><p>Петров И. · вчера 19:40</p><p className="m">Замечаний нет. Долив гидромасла 4 л.</p></div>
      <button className="b" type="button">Принять машину</button>
      <button className="b gh" type="button">Отказаться от приёмки</button>
      </div>
      </>
    ),
  },
  'C3': {
    title: "Ввод показания",
    kind: "подэкран",
    content: (
      <>
      <div className="nav"><span className="back">‹ Назад</span><span className="ttl">Моточасы</span></div>
      <div className="scr">
      <p className="m">Прошлое показание: 1276 м/ч · 28.08 19:40</p>
      <div className="bignum">1284</div>
      <div className="keys"><span>1</span><span>2</span><span>3</span><span>4</span><span>5</span><span>6</span><span>7</span><span>8</span><span>9</span><span>⌫</span><span>0</span><span>,</span></div>
      <button className="b" type="button">Записать</button>
      <p className="note">Меньше прошлого ввести нельзя — счётчик не идёт назад.</p>
      </div>
      </>
    ),
  },
  'C4': {
    title: "Сверка с телеметрией",
    kind: "подэкран",
    content: (
      <>
      <div className="bar"><span><span className="dot"></span>На связи</span><span>07:07</span></div>
      <div className="nav"><span className="ttl">Расхождение</span></div>
      <div className="scr">
      <p className="p"><b>Вы ввели 1284 м/ч. Телеметрия показывает 1285,6 м/ч.</b></p>
      <div className="card"><span className="lbl">Разница</span><p>1,6 часа — в пределах допустимого</p></div>
      <div className="seg"><span className="on">Оставить моё</span><span>Взять из телеметрии</span></div>
      <button className="b" type="button">Подтвердить</button>
      <p className="note warn">Расхождение до 2 часов — сверка, а не блокировка. Запишется в журнал.</p>
      </div>
      </>
    ),
  },
  'D1': {
    title: "Разделы осмотра",
    kind: "основной",
    content: (
      <>
      <div className="bar"><span><span className="dot off"></span>Автономно · в очереди 3</span><span>07:12</span></div>
      <div className="pbar"><i style={{width: '52%'}}></i></div>
      <div className="top"><span className="mach">Предсменный осмотр</span><span className="where">12 из 23 пунктов · осталось ~2 мин</span></div>
      <div className="scr">
      <div className="rowline"><span>Кабина и обзор</span><span className="badge ok">4 из 4</span></div>
      <div className="rowline"><span>Ходовая часть</span><span className="badge ok">3 из 3</span></div>
      <div className="rowline"><span>Мачта и молот</span><span className="badge warn">5 из 6</span></div>
      <div className="rowline"><span>Гидравлика и уровни</span><span className="badge bad">0 из 6</span></div>
      <div className="rowline"><span>Троса и обойма</span><span className="badge bad">0 из 4</span></div>
      <button className="b" type="button">Продолжить осмотр</button>
      </div>
      </>
    ),
  },
  'D2': {
    title: "Пункты раздела",
    kind: "подэкран",
    content: (
      <>
      <div className="nav"><span className="back">‹ Разделы</span><span className="ttl">Троса и обойма</span></div>
      <div className="scr">
      <div className="rowline"><span>Зажимы и блоки</span><span className="ans"><span className="on">Норма</span><span>Дефект</span></span></div>
      <div className="rowline"><span><span className="crit">▲</span> Троса: обрывы, заломы, коррозия</span><span className="ans"><span>Норма</span><span className="bad">Дефект</span></span></div>
      <div className="rowline"><span><span className="crit">▲</span> Крюковая обойма: замок</span><span className="ans"><span>Норма</span><span>Дефект</span></span></div>
      <p className="note warn">▲ — критичный пункт. Дефект здесь останавливает смену.</p>
      </div>
      </>
    ),
  },
  'D3': {
    title: "Фиксация дефекта",
    kind: "подэкран",
    content: (
      <>
      <div className="nav"><span className="back">‹ Отмена</span><span className="ttl">Дефект</span></div>
      <div className="scr">
      <p className="p"><b>▲ Троса: обрывы, заломы, коррозия</b></p>
      <div className="card"><span className="lbl">Фото · обязательно</span><p>1 снимок · 07:14 · GPS записан</p></div>
      <button className="b gh" type="button">Добавить ещё фото</button>
      <div className="card"><span className="lbl">Комментарий</span><p>Обрыв двух прядей в 3 м от коуша</p></div>
      <button className="b dn" type="button">Зафиксировать дефект</button>
      <p className="note bad">Это критичный пункт: после фиксации смена будет заблокирована.</p>
      </div>
      </>
    ),
  },
  'D4': {
    title: "Долив с объёмом",
    kind: "подэкран",
    content: (
      <>
      <div className="nav"><span className="back">‹ Назад</span><span className="ttl">Долив</span></div>
      <div className="scr">
      <p className="p"><b>Уровень гидромасла</b></p>
      <div className="seg"><span className="on">Долил</span><span>Норма</span></div>
      <div className="card"><span className="lbl">Материал</span><p>HLP 46 · со склада объекта</p></div>
      <div className="bignum">4 л</div>
      <div className="keys"><span>1</span><span>2</span><span>3</span><span>4</span><span>5</span><span>6</span><span>7</span><span>8</span><span>9</span><span>⌫</span><span>0</span><span>,</span></div>
      <button className="b" type="button">Записать долив</button>
      </div>
      </>
    ),
  },
  'E1': {
    title: "Осмотр площадки",
    kind: "основной",
    content: (
      <>
      <div className="bar"><span><span className="dot"></span>На связи</span><span>07:26</span></div>
      <div className="top"><span className="mach">Рабочая зона</span><span className="where">Куст 7 · пикеты 41–48</span></div>
      <div className="scr">
      <div className="rowline"><span><span className="crit">▲</span> Основание держит нагрузку</span><span className="ans"><span className="on">Да</span><span>Нет</span></span></div>
      <div className="rowline"><span><span className="crit">▲</span> Уклон в пределах паспорта</span><span className="ans"><span className="on">Да</span><span>Нет</span></span></div>
      <div className="rowline"><span><span className="crit">▲</span> ЛЭП и коммуникации согласованы</span><span className="ans"><span className="on">Да</span><span>Нет</span></span></div>
      <div className="rowline"><span>Опасная зона ограждена</span><span className="ans"><span className="on">Да</span><span>Нет</span></span></div>
      <div className="rowline"><span>Освещённость достаточна</span><span className="ans"><span className="on">Да</span><span>Нет</span></span></div>
      <button className="b" type="button">Площадка проверена</button>
      </div>
      </>
    ),
  },
  'E2': {
    title: "Пуск смены",
    kind: "основной",
    content: (
      <>
      <div className="bar"><span><span className="dot"></span>На связи</span><span>07:31</span></div>
      <div className="ok-head"><span className="t">Готова с замечаниями</span><span className="s">Можно работать · 1 замечание</span></div>
      <div className="scr">
      <div className="card"><span className="lbl">Погода · объект «Северный»</span><p>Ветер 13 м/с · −4 °C · видимость норма</p><p className="m">Источник: прогноз по GPS, 07:15</p></div>
      <p className="note warn">Ветер 12–15 м/с: ограничение высоты подъёма. Стоп по ветру фиксирует человек, указав, чем мерил.</p>
      <div className="rowline"><span>Подтёк масла под насосом</span><span className="badge warn">наблюдение</span></div>
      <button className="b" type="button">Начать смену</button>
      </div>
      </>
    ),
  },
  'E3': {
    title: "Блокировка",
    kind: "состояние",
    content: (
      <>
      <div className="bar"><span><span className="dot"></span>На связи</span><span>07:31</span></div>
      <div className="stop-head"><span className="t">Работать нельзя</span><span className="s">Трос: обрыв прядей выше нормы</span></div>
      <div className="scr">
      <div className="chain">
      <div><span className="k">Условие</span><span>Троса без обрывов — осмотр, п. 14</span></div>
      <div><span className="k">Подтвердил</span><span>Фото 07:14 · Сидоров А.</span></div>
      <div><span className="k">Правило</span><span>Критичный пункт → жёсткий стоп</span></div>
      <div><span className="k">Результат</span><span>Смена не открывается</span></div>
      </div>
      <button className="b dn" type="button">Открыть дефект № 142</button>
      <p className="note bad">Снять разрешением нельзя. Только ремонт, фото работ и проверка устранения.</p>
      </div>
      </>
    ),
  },
  'E4': {
    title: "Запрос разрешения",
    kind: "подэкран",
    content: (
      <>
      <div className="nav"><span className="back">‹ Назад</span><span className="ttl">Запрос разрешения</span></div>
      <div className="scr">
      <p className="p"><b>Замечание:</b> расхождение моточасов 2,4 ч</p>
      <div className="card"><span className="lbl">Причина запроса</span><p>Счётчик заменён 27.08, показания сброшены</p></div>
      <div className="card"><span className="lbl">Срок действия</span><p>До конца смены · 29.08 20:00</p></div>
      <button className="b" type="button">Отправить диспетчеру</button>
      <p className="note">Разрешение возможно только для организационных замечаний. Критичное так не снимается.</p>
      </div>
      </>
    ),
  },
  'F1': {
    title: "Экран смены",
    kind: "основной",
    content: (
      <>
      <div className="bar"><span><span className="dot"></span>На связи</span><span>13:48</span></div>
      <div className="top"><span className="mach">Смена идёт · 6 ч 17 мин</span><span className="where">Куст 7 · наряд № 118</span></div>
      <div className="scr">
      <div className="tiles">
      <div className="tile"><span className="v">14</span><span className="k">свай забито</span></div>
      <div className="tile"><span className="v">86,4</span><span className="k">м бурения</span></div>
      <div className="tile"><span className="v">1,5</span><span className="k">ч простоя</span></div>
      <div className="tile"><span className="v">1290</span><span className="k">м/ч сейчас</span></div>
      </div>
      <button className="b" type="button">Записать сваю</button>
      <button className="b gh" type="button">Бурение · Простой · Дефект</button>
      </div>
      <div className="dock"><span className="on">Смена</span><span>Работа</span><span>Дефекты</span><span>Машина</span></div>
      </>
    ),
  },
  'F2': {
    title: "Забивка сваи",
    kind: "подэкран",
    content: (
      <>
      <div className="nav"><span className="back">‹ Отмена</span><span className="ttl">Свая</span></div>
      <div className="scr">
      <div className="card"><span className="lbl">Место</span><p>Куст 7 · пикет 44</p></div>
      <div className="card"><span className="lbl">Марка сваи</span><p>С 120.30-8 · 12 м</p></div>
      <div className="seg"><span className="on">Забита</span><span>Отказ</span></div>
      <p className="m">Отметка головы: −0,45 м · время 12 мин</p>
      <button className="b" type="button">Записать сваю</button>
      <p className="note">Длина берётся из марки сваи, вручную её вводить не нужно.</p>
      </div>
      </>
    ),
  },
  'F3': {
    title: "Бурение",
    kind: "подэкран",
    content: (
      <>
      <div className="nav"><span className="back">‹ Отмена</span><span className="ttl">Лидерное бурение</span></div>
      <div className="scr">
      <div className="card"><span className="lbl">Место</span><p>Куст 7 · пикет 45</p></div>
      <div className="bignum">6,2 м</div>
      <div className="keys"><span>1</span><span>2</span><span>3</span><span>4</span><span>5</span><span>6</span><span>7</span><span>8</span><span>9</span><span>⌫</span><span>0</span><span>,</span></div>
      <p className="m">Диаметр 320 мм · по проекту 6,0–6,5 м</p>
      <button className="b" type="button">Записать проходку</button>
      </div>
      </>
    ),
  },
  'F4': {
    title: "Простой",
    kind: "подэкран",
    content: (
      <>
      <div className="nav"><span className="back">‹ Отмена</span><span className="ttl">Простой</span></div>
      <div className="scr">
      <p className="kicker">Идёт 24 мин · с 13:24</p>
      <div className="card"><span className="lbl">Причина</span><p>Ожидание доставки свай</p></div>
      <div className="seg"><span>Техника</span><span className="on">Организация</span></div>
      <button className="b ok" type="button">Простой закончился</button>
      <p className="note">Время считает система с момента начала. Вводить вручную нечего, перекрыть другой простой нельзя.</p>
      </div>
      </>
    ),
  },
  'F5': {
    title: "Дефект во время работы",
    kind: "подэкран",
    content: (
      <>
      <div className="nav"><span className="back">‹ Отмена</span><span className="ttl">Дефект в работе</span></div>
      <div className="scr">
      <div className="card"><span className="lbl">Узел</span><p>Гидравлика · распределитель</p></div>
      <div className="card"><span className="lbl">Фото · обязательно</span><p>2 снимка · 13:51 · GPS записан</p></div>
      <div className="seg"><span>Наблюдение</span><span className="on">Требует ремонта</span></div>
      <button className="b dn" type="button">Зафиксировать</button>
      <p className="note warn">Критичность определит справочник узла, а не ваш выбор. Если узел критичный — смена приостановится.</p>
      </div>
      </>
    ),
  },
  'F6': {
    title: "Безопасная остановка",
    kind: "состояние",
    content: (
      <>
      <div className="bar"><span><span className="dot"></span>На связи</span><span>14:02</span></div>
      <div className="stop-head"><span className="t">Работа приостановлена</span><span className="s">Критичный дефект гидравлики</span></div>
      <div className="scr">
      <p className="p"><b>Что сделать сейчас:</b></p>
      <div className="chain">
      <div><span className="k">1</span><span>Опустить мачту в транспортное положение</span></div>
      <div><span className="k">2</span><span>Заглушить двигатель</span></div>
      <div><span className="k">3</span><span>Оградить зону подтёка</span></div>
      </div>
      <button className="b ok" type="button">Машина безопасно остановлена</button>
      <p className="note bad">Смена не закрыта. Она продолжится, если дефект снимут, либо будет сдана как прерванная.</p>
      </div>
      </>
    ),
  },
  'G1': {
    title: "Осмотр после работ",
    kind: "основной",
    content: (
      <>
      <div className="bar"><span><span className="dot"></span>На связи</span><span>19:22</span></div>
      <div className="pbar"><i style={{width: '70%'}}></i></div>
      <div className="top"><span className="mach">Осмотр после работ</span><span className="where">7 из 10 пунктов</span></div>
      <div className="scr">
      <div className="rowline"><span>Течи после остановки</span><span className="ans"><span className="on">Нет</span><span>Есть</span></span></div>
      <div className="rowline"><span><span className="crit">▲</span> Мачта: деформации, трещины швов</span><span className="ans"><span className="on">Норма</span><span>Дефект</span></span></div>
      <div className="rowline"><span>Транспортное положение</span><span className="ans"><span className="on">Да</span><span>Нет</span></span></div>
      <button className="b" type="button">Завершить осмотр</button>
      </div>
      </>
    ),
  },
  'G2': {
    title: "Отчёт",
    kind: "основной",
    content: (
      <>
      <div className="bar"><span><span className="dot"></span>На связи</span><span>19:28</span></div>
      <div className="nav"><span className="ttl">Отчёт о смене</span></div>
      <div className="scr">
      <div className="rowline"><span>Свай забито</span><span className="r">18</span></div>
      <div className="rowline"><span>Лидерное бурение</span><span className="r">108,6 м</span></div>
      <div className="rowline"><span>Простои</span><span className="r">2,1 ч</span></div>
      <div className="rowline"><span>Моточасы на конец</span><span className="r">1296</span></div>
      <div className="rowline"><span>Топливо</span><span className="r">210 л</span></div>
      <div className="rowline"><span>Дефекты</span><span className="badge warn">1 открыт</span></div>
      <button className="b" type="button">Отправить отчёт</button>
      <p className="note">Всё уже записано за день. Проверьте и отправьте.</p>
      </div>
      </>
    ),
  },
  'G3': {
    title: "Правка до отправки",
    kind: "подэкран",
    content: (
      <>
      <div className="nav"><span className="back">‹ Отчёт</span><span className="ttl">Правка строки</span></div>
      <div className="scr">
      <p className="p"><b>Топливо, заправлено за смену</b></p>
      <div className="bignum">210</div>
      <div className="keys"><span>1</span><span>2</span><span>3</span><span>4</span><span>5</span><span>6</span><span>7</span><span>8</span><span>9</span><span>⌫</span><span>0</span><span>,</span></div>
      <div className="card"><span className="lbl">Причина правки</span><p>Дозаправка 40 л не попала в журнал</p></div>
      <button className="b" type="button">Сохранить</button>
      <p className="note warn">Правка до отправки — обычная. После отправки отчёт меняется только корректирующей записью.</p>
      </div>
      </>
    ),
  },
  'G4': {
    title: "Передача",
    kind: "основной",
    content: (
      <>
      <div className="bar"><span><span className="dot"></span>На связи</span><span>19:34</span></div>
      <div className="nav"><span className="ttl">Сдача смены</span></div>
      <div className="scr">
      <div className="card"><span className="lbl">Что передаёте</span><p>Liebherr LRH 100 · 1296 м/ч · куст 7</p></div>
      <div className="card"><span className="lbl">Замечания следующему</span><p>Подтёк под насосом — под наблюдением. Дефект троса № 142 открыт.</p></div>
      <button className="b" type="button">Сдать смену</button>
      <p className="note">Принять машину сможет тот, кто выйдет следующим. Если это вы — самоприёмка будет отмечена в журнале.</p>
      </div>
      </>
    ),
  },
  'G5': {
    title: "Закрыто",
    kind: "состояние",
    content: (
      <>
      <div className="bar"><span><span className="dot"></span>На связи</span><span>19:36</span></div>
      <div className="ok-head"><span className="t">Смена закрыта</span><span className="s">29.08 · 12 ч 44 мин</span></div>
      <div className="scr">
      <div className="tiles">
      <div className="tile"><span className="v">18</span><span className="k">свай</span></div>
      <div className="tile"><span className="v">108,6</span><span className="k">м бурения</span></div>
      </div>
      <p className="note good">Отчёт отправлен, машина передана. Запись смены больше не изменяется.</p>
      <button className="b gh" type="button">Посмотреть журнал смены</button>
      </div>
      </>
    ),
  },
  'H1': {
    title: "Автономная работа",
    kind: "сквозное",
    content: (
      <>
      <div className="bar"><span><span className="dot off"></span>Автономно · в очереди 7</span><span>11:14</span></div>
      <div className="nav"><span className="ttl">Не отправлено</span></div>
      <div className="scr">
      <p className="m">Последняя синхронизация: 09:41</p>
      <div className="rowline"><span>Свая · пикет 43</span><span className="badge warn">в очереди</span></div>
      <div className="rowline"><span>Фото дефекта · 2 шт</span><span className="badge warn">в очереди</span></div>
      <div className="rowline"><span>Простой 24 мин</span><span className="badge warn">в очереди</span></div>
      <p className="note">Работать можно. Всё записанное уйдёт на сервер, как только появится связь — ничего не потеряется.</p>
      <button className="b gh" type="button">Попробовать отправить</button>
      </div>
      </>
    ),
  },
  'H2': {
    title: "Отклонено после синхронизации",
    kind: "сквозное",
    content: (
      <>
      <div className="bar"><span><span className="dot"></span>На связи</span><span>11:52</span></div>
      <div className="stop-head"><span className="t">Одна запись отклонена</span><span className="s">Сервер не принял простой в 10:30</span></div>
      <div className="scr">
      <div className="card"><span className="lbl">Причина</span><p>Пересекается с простоем 10:15–10:45, записанным диспетчером</p></div>
      <p className="note bad">Запись не удалена — она в разборе. Остальные 6 приняты.</p>
      <button className="b" type="button">Показать оба простоя</button>
      <button className="b gh" type="button">Оставить как есть</button>
      </div>
      </>
    ),
  },
};
