/* «Модуль Оператора — Подэкраны 4/4» — 8 экранов (чек-листы, после смены, итоги, передача, закрытие). */
(function () {
  var I = window.PT_ICON, PT = window.PT;
  var G = window.GROUPS = window.GROUPS || [];

  function shell(title, body) {
    return PT.statusbar() + PT.navbar({back: true, title: title}) +
      '<div class="content dense">' + body + '</div>';
  }

  function chk(text, label, on) {
    return '<div class="chk-row"><span class="cbox-c' + (on ? ' on' : '') + '">' + (on ? '\u2713' : '') + '</span>' +
      '<span class="chk-t">' + text + '</span><span class="chk-l">' + label + '</span></div>';
  }

  function noteField(label) {
    return '<div class="field"><div class="lbl">' + label + '</div>' +
      '<div class="textarea ph">Введите примечание</div></div>';
  }

  G.push({
    id: 'sub4', variant: 'navy', tab: 'Журнал',
    title: 'Модуль Оператора. Подэкраны 4/4',
    screens: [
      {
        caption: 'Чек-лист ТБ: забивка свай', short: 'Чек-лист ТБ',
        html: shell('Чек-лист ТБ',
          '<div class="sect2">Забивка свай</div><div class="sub2">Перед началом работ</div>' +
          '<div class="card flush"><div class="rows2">' +
          [['Опасная зона ограждена и обозначена', 'Да', 1],
            ['Персонал проинструктирован по ТБ', 'Да', 1],
            ['Средства индивидуальной защиты в наличии и исправны', 'Да', 1],
            ['Машина и навесное оборудование исправны, смазка выполнена', 'Да', 1],
            ['Разрешения проверены, клиентская собственность', 'Да', 1],
            ['Рабочая площадка очищена от посторонних предметов', 'Да', 1],
            ['Нет людей в радиусе опасной зоны', 'Нет', 0]].map(function (r) {
            return chk(r[0], r[1], r[2]);
          }).join('') + '</div></div>' +
          noteField('Примечание (при необходимости)') +
          '<div class="spacer"></div><button class="btn green">Чек-лист пройден</button>' +
          '<div class="link-center">Сбросить ответы</div>'),
      },
      {
        caption: 'Чек-лист ТБ: лидерное бурение', short: 'Чек-лист ТБ · бурение',
        html: shell('Чек-лист ТБ',
          '<div class="sect2">Лидерное бурение</div><div class="sub2">Перед началом работ</div>' +
          '<div class="card flush"><div class="rows2">' +
          [['Режущий инструмент проверен и закреплён', 'Да', 1],
            ['Состояние бурового инструмента и наконечников проверено', 'Да', 1],
            ['Радиусная зона проверена и ограждена', 'Да', 1],
            ['Ограждение опасной зоны установлено', 'Да', 1],
            ['Нет посторонних людей в зоне работ', 'Да', 1],
            ['Пути эвакуации свободны и обозначены', 'Да', 1],
            ['Уровень жидкости в системе гидравлики в норме', 'Да', 1],
            ['Прогрев гидросистемы выполнен', 'Нет', 0]].map(function (r) {
            return chk(r[0], r[1], r[2]);
          }).join('') + '</div></div>' +
          noteField('Примечание (при необходимости)') +
          '<div class="spacer"></div><button class="btn green">Чек-лист пройден</button>' +
          '<div class="link-center">Сбросить ответы</div>'),
      },
      {
        caption: 'После смены: обслуживание', short: 'Обслуживание',
        html: shell('После смены',
          '<div class="sect2">Обслуживание</div><div class="sub2">После окончания работ</div>' +
          '<div class="stack">' +
          [['cabin', 'Очистить кабину', 'Пыль, грязь, мусор'],
            ['engine', 'Осмотреть гидравлику и ходовую часть', 'Рельсы, направляющие ролики'],
            ['hammer', 'Растянуть молот и наполнить', 'Крепления, шланг, трещины'],
            ['tracks', 'Осмотреть сваю и кантов', 'Деформации, трещины, состояние канта']]
            .map(function (t) {
              return '<div class="list-card"><span class="icon-tile gray">' + I(t[0]) + '</span>' +
                '<span class="row-body"><span class="t">' + t[1] + '</span><span class="s">' + t[2] + '</span></span>' +
                '<span class="ck-circle">&#10003;</span></div>';
            }).join('') +
          '<div class="list-card"><span class="icon-tile gray">' + I('docs') + '</span>' +
          '<span class="row-body"><span class="t">Записать выполненное обслуживание</span>' +
          '<span class="s">Фото, примечания</span></span><span class="chev">&#8250;</span></div>' +
          '</div><div class="spacer"></div><button class="btn">Перейти к осмотру</button>'),
      },
      {
        caption: 'Послесменный осмотр', short: 'Осмотр после',
        html: shell('Послесменный осмотр',
          '<div class="sect2">Проверка состояния</div>' +
          '<div class="card flush"><div class="rows2">' +
          [['Деформации конструкции (стрелы, рамы, гибочные)', 'Нет', 1],
            ['Трещины на сварных швах и элементах', 'Нет', 1],
            ['Потёки масла, топлива, охлаждающей жидкости', 'Нет', 1],
            ['Состояние катков и блоков', 'Норма', 1],
            ['Гидравлические рукава и соединения', 'Норма', 1],
            ['Состояние ходовой части', 'Норма', 1],
            ['Прочие замечания', 'Не проверено', 0]].map(function (r) {
            return chk(r[0], r[1], r[2]);
          }).join('') + '</div></div>' +
          '<div class="field"><div class="lbl">Фото (при необходимости)</div>' +
          '<div class="upload">' + I('camera') + '<span>Добавить фото</span></div></div>' +
          noteField('Примечание') +
          '<div class="spacer"></div><button class="btn">Сохранить осмотр</button>'),
      },
      {
        caption: 'Жидкости после смены', short: 'Жидкости',
        html: shell('Жидкости после смены',
          '<div class="sect2">Уровни и остатки</div>' +
          '<div class="stack">' +
          '<div class="card fluid"><div class="fl-head">' + I('droplet') + 'Моторное масло</div>' +
          '<div class="kv"><span class="k">Уровень</span><span class="v">Норма &#8964;</span></div>' +
          '<div class="kv"><span class="k">Долив</span><span class="v">0 л</span></div></div>' +
          '<div class="card fluid"><div class="fl-head">' + I('droplet') + 'Охлаждающая жидкость</div>' +
          '<div class="kv"><span class="k">Уровень</span><span class="v">Норма &#8964;</span></div>' +
          '<div class="kv"><span class="k">Долив</span><span class="v">0 л</span></div></div>' +
          '<div class="card fluid"><div class="fl-head">' + I('droplet') + 'Гидравлическое масло</div>' +
          '<div class="kv"><span class="k">Уровень</span><span class="v">Норма &#8964;</span></div>' +
          '<div class="kv"><span class="k">Долив</span><span class="v">0 л</span></div></div>' +
          '<div class="card fluid"><div class="fl-head">' + I('fuel') + 'Топливо</div>' +
          '<div class="kv"><span class="k">Остаток в баке</span><span class="v">245 л</span></div>' +
          '<div class="kv"><span class="k">Долив за смену</span><span class="v">60 л</span></div></div>' +
          '</div>' +
          noteField('Примечание по доливу') +
          '<div class="banner amber"><span class="bi">!</span><span class="bt">Потенциальный расход жидкостей ' +
          'за смену не зафиксирован</span></div>' +
          '<div class="spacer"></div><button class="btn">Сохранить</button>'),
      },
      {
        caption: 'Итоги смены', short: 'Итоги',
        html: shell('Итоги смены',
          '<div class="sect2">Сводка по смене</div>' +
          '<div class="card flush"><div class="rows">' +
          '<div class="r"><span class="ci">' + I('calendar') + '</span><span class="n">Начало смены</span>' +
          '<span class="c b">18.05.2025 07:00</span></div>' +
          '<div class="r"><span class="ci">' + I('clock') + '</span><span class="n">Окончание смены</span>' +
          '<span class="c b">18.05.2025 19:10</span></div>' +
          '<div class="r"><span class="ci">' + I('clock') + '</span><span class="n">Длительность смены</span>' +
          '<span class="c b">12 ч 10 мин</span></div>' +
          '<div class="r"><span class="ci">' + I('gauge') + '</span><span class="n">Метраж (начало / конец)</span>' +
          '<span class="c b">2458 м/ч &nbsp; 2470 м/ч</span></div>' +
          '</div></div>' +
          '<div class="kpi"><div class="kpi-k">Моточасы за смену</div><div class="kpi-v">12 м/ч</div></div>' +
          '<div class="card flush"><div class="rows">' +
          '<div class="r"><span class="ci">' + I('hammer') + '</span><span class="n">Сваи забито</span>' +
          '<span class="c b">42 шт.</span></div>' +
          '<div class="r"><span class="ci">' + I('mast') + '</span><span class="n">Лидерное бурение</span>' +
          '<span class="c b">185 м</span></div>' +
          '<div class="r"><span class="ci">' + I('clock') + '</span><span class="n">Простой техники</span>' +
          '<span class="c b">1 ч 20 мин</span></div>' +
          '<div class="r"><span class="ci">' + I('alert') + '</span><span class="n">Зафиксировано дефектов</span>' +
          '<span class="c b">2 шт.</span></div>' +
          '<div class="r"><span class="ci">' + I('camera') + '</span><span class="n">Фото за смену</span>' +
          '<span class="c b">24 фото</span></div>' +
          '</div></div>' +
          '<div class="spacer"></div><button class="btn">Просмотреть отчёт</button>'),
      },
      {
        caption: 'Передача смены', short: 'Передача',
        html: shell('Передача смены',
          '<div class="sect2">Передача следующему оператору</div>' +
          '<div class="stack">' +
          '<div class="list-card"><span class="icon-tile gray">' + I('mast') + '</span>' +
          '<span class="row-body"><span class="t">Наработка техники</span></span>' +
          '<span class="b-val">2470 м/ч</span></div>' +
          '<div class="list-card"><span class="icon-tile amber">' + I('alert') + '</span>' +
          '<span class="row-body"><span class="t">Открытые дефекты</span></span>' +
          '<span class="b-val">2 шт.</span><span class="chev">&#8250;</span></div>' +
          '<div class="list-card"><span class="icon-tile green">' + I('clipboard') + '</span>' +
          '<span class="row-body"><span class="t">Выполненные действия</span></span>' +
          '<span class="b-val">12 поз.</span><span class="chev">&#8250;</span></div>' +
          '</div>' +
          '<div class="field"><div class="lbl">Особые отметки / примечания</div>' +
          '<div class="card note-card">Легкая вибрация молота при работе на твердом грунте. ' +
          'Заварка направляющего устройства сваи по оси 3-6.</div></div>' +
          '<div class="sect2">Передача смены</div>' +
          '<div class="card"><div class="sign"><span class="avatar sm">' + I('user') + '</span>' +
          '<span class="row-body"><span class="t">Иванов И.И.</span>' +
          '<span class="s">Оператор · 18.05.2025 19:10</span></span><span class="sign-line"></span></div>' +
          '<div class="sign"><span class="avatar sm">' + I('user') + '</span>' +
          '<span class="row-body"><span class="t">Петров П.П.</span>' +
          '<span class="s">Оператор · 18.05.2025 19:10</span></span><span class="sign-line"></span></div></div>' +
          '<div class="spacer"></div><button class="btn">Передача подтверждена</button>'),
      },
      {
        caption: 'Закрытие смены', short: 'Закрытие',
        html: shell('Закрытие смены',
          '<div class="result-hero"><div class="halo-wrap"><div class="halo outline"><div class="dot">\u2713</div></div></div>' +
          '<div class="h green-t">Смена успешно закрыта</div></div>' +
          '<div class="card flush"><div class="rows">' +
          ['Все чек-листы пройдены', 'Осмотр и обслуживание выполнены', 'Жидкости проверены и зафиксированы',
            'Итоги смены сохранены', 'Передача смены подтверждена'].map(function (t) {
            return '<div class="r"><span class="ck-circle">&#10003;</span><span class="n">' + t + '</span></div>';
          }).join('') + '</div></div>' +
          '<div class="info-green"><div class="ig-t">Смена закрыта</div><div class="ig-v">18.05.2025 19:10</div></div>' +
          '<div class="spacer"></div><button class="btn green">Закрыть смену</button>'),
      },
    ],
  });
})();
