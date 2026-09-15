/* «Модуль Оператора — Подэкраны 2/4» — 8 экранов (погода, параметры, осмотры, блокировка). */
(function () {
  var I = window.PT_ICON, PT = window.PT;
  var G = window.GROUPS = window.GROUPS || [];

  function shell(o, body, opts) {
    opts = opts || {};
    return PT.statusbar() +
      PT.navbar({back: true, title: o.title, right: o.info ? I('info') : undefined, plain: false}) +
      '<div class="content' + (opts.dense ? ' dense' : '') + '">' + body + '</div>';
  }

  function checkSection(title, desc, mode) {
    // mode: 'ok' | 'warn'
    var left = mode === 'warn'
      ? '<button class="btn tiny seg-warn two">Неисправно</button><button class="btn tiny flat two">Исправно</button>'
      : '<button class="btn tiny green two">Исправно</button><button class="btn tiny flat two">Неисправно</button>';
    return '<div class="sec-block"><div class="sec-head"><span class="sec-t">' + title + '</span>' +
      '<span class="cam">' + I('camera') + '</span></div>' +
      '<p class="sec-d">' + desc + '</p><div class="btn-row">' + left + '</div>' +
      (mode === 'warn' ? '<div class="note-box">Неисправность зафиксирована в ходе соединения (пилотный пропуск)</div>' : '') +
      '</div>';
  }

  var checklist = [
    ['cabin', 'Кабина', '5 / 5'], ['clipboard', 'Визуальный осмотр', '12 / 12'],
    ['engine', 'Двигатель', '6 / 6'], ['droplet', 'Гидравлика', '6 / 6'],
    ['tracks', 'Ходовая часть', '8 / 8'], ['mast', 'Мачта и лидер', '6 / 6'],
    ['hammer', 'Молот', '5 / 5'], ['rope', 'Троса и канаты', '6 / 6'], ['bolt', 'Электрика', '4 / 4'],
  ];

  G.push({
    id: 'sub2', variant: 'navy', tab: 'Профиль',
    title: 'Модуль Оператора. Подэкраны 2/4',
    screens: [
      {
        caption: 'Погода и условия', short: 'Погода',
        html: shell({title: 'Погода и условия'},
          '<div class="card"><div class="card-title" style="margin-bottom:8px">Текущая погода</div>' +
          '<div class="wrow"><span class="wicon">' + I('sun') + '</span>' +
          '<div><div class="wtemp">+18°C</div><div class="muted">Облачно</div></div></div>' +
          '<div class="divider"></div>' +
          [['wind', 'Скорость ветра', '4 м/с'], ['gust', 'Порывы ветра', '7 м/с'],
            ['rain', 'Осадки', '0 мм'], ['droplet', 'Влажность', '62%'],
            ['gauge', 'Давление', '752 мм рт. ст.']].map(function (r) {
            return '<div class="kv"><span class="k icon-k">' + I(r[0]) + r[1] + '</span>' +
              '<span class="v">' + r[2] + '</span></div>';
          }).join('') + '</div>' +
          '<div class="card"><div class="card-title" style="margin-bottom:6px">Местоположение площадки</div>' +
          '<div class="pin-line">' + I('pin') + '<span>г. Санкт-Петербург, Приморский район, ул. Оптиков, 4</span></div>' +
          '<div class="photo map" style="height:66px"><span class="pin">' + I('pin') + '</span></div></div>' +
          '<div class="banner"><span class="bi">i</span><span class="bt">Проверьте, что скорость ветра не превышает ' +
          'допустимые значения для работы установки.</span></div>',
          {tabs: false}),
      },
      {
        caption: 'Параметры установки', short: 'Параметры',
        html: shell({title: 'Параметры установки'},
          '<div class="hero-machine"><div class="img"></div><div>' +
          '<div class="lbl">Модель установки</div><div class="pn">Liebherr LRH 100</div></div></div>' +
          '<div class="divider"></div>' +
          '<div class="kv"><span class="k">Объект</span><span class="v">ЖК Северный</span></div>' +
          '<div class="kv"><span class="k">Инвентарный №</span><span class="v">LRH100-07</span></div>' +
          '<div class="kv"><span class="k">Позиционный оператор</span>' +
          '<span class="v">Иванов И.И.<br><span class="muted">18.05.2025 07:45</span></span></div>' +
          '<div class="kv"><span class="k">Моточасы (текущие)</span><span class="v big">8 452 м/ч</span></div>' +
          '<div class="kv"><span class="k">Результат последней смены</span>' +
          '<span class="v"><span class="ok-txt">&#10003; Допуск подтверждён</span>' +
          '<br><span class="muted">18.05.2025 07:45</span></span></div>' +
          '<div class="kv"><span class="k">Следующее ТО</span>' +
          '<span class="v">через 248 м/ч<br><span class="muted">или 25.05.2025</span></span></div>' +
          '<div class="spacer"></div>' +
          '<div class="link-row boxed"><span>История обслуживания</span><span>&#8594;</span></div>',
          {tabs: false}),
      },
      {
        caption: 'Предсменный осмотр', short: 'Осмотр',
        html: shell({title: 'Предсменный осмотр'},
          '<div class="prog-head"><span>Общий прогресс</span><b>38 / 38</b></div>' +
          '<div class="progress green"><i style="width:100%"></i></div>' +
          '<div class="card flush" style="margin-top:4px"><div class="rows">' +
          checklist.map(function (c) {
            return '<div class="r"><span class="ci">' + I(c[0]) + '</span><span class="n">' + c[1] + '</span>' +
              '<span class="c">' + c[2] + '</span><span class="ok-txt">&#10003;</span></div>';
          }).join('') + '</div></div>' +
          '<div class="spacer"></div>' +
          '<button class="btn green big"><span>Осмотр пройден<br></span><b>38 / 38</b></button>',
          {tabs: false}),
      },
      {
        caption: 'Визуальный осмотр техники', short: 'Визуальный осмотр',
        html: shell({title: 'Визуальный осмотр техники', info: true},
          '<div class="tabs"><span class="tb on">Чек-лист</span><span class="tb">Инфо</span></div>' +
          '<div class="stack">' +
          checkSection('Стекла и зеркала', 'Отсутствие трещин, сколов, затёртостей стёкол и стёкол', 'ok') +
          checkSection('Течи и подтеки', 'Отсутствие подтёков масла, топлива, охлаждающей жидкости', 'ok') +
          checkSection('Деформации и повреждения', 'Отсутствие деформаций, трещин и повреждений элементов.', 'ok') +
          checkSection('Отсутствующие элементы', 'Все элементы на местах, крепления не ослаблены.', 'ok') +
          checkSection('Посторонние предметы', 'Отсутствие посторонних предметов на площадке и в узлах.', 'ok') +
          '</div><div class="spacer"></div><button class="btn">Сохранить и далее</button>',
          {tabs: false}),
      },
      {
        caption: 'Проверка двигателя', short: 'Двигатель',
        html: shell({title: 'Проверка двигателя', info: true},
          '<div class="tabs"><span class="tb on">Чек-лист</span><span class="tb">Инфо</span></div>' +
          '<div class="stack">' +
          checkSection('Подтеки', 'Отсутствие течей масла и топлива.', 'ok') +
          checkSection('Уровень масла', 'Уровень масла в норме.', 'ok') +
          checkSection('Уровень ОЖ', 'Уровень охлаждающей жидкости в норме.', 'ok') +
          checkSection('Топливная аппаратура', 'Состояние, отсутствие подтеков.', 'ok') +
          checkSection('Ремни', 'Натяжение и состояние ремней.', 'ok') +
          checkSection('Шланги', 'Состояние шлангов и патрубков.', 'ok') +
          '</div>' +
          '<div class="card"><div class="card-title" style="margin-bottom:6px">Дозаправка</div>' +
          [['Масло двигателя', '0.0 л'], ['Охлаждающая жидкость', '0.0 л'], ['Топливо', '0.0 л']].map(function (r) {
            return '<div class="drow"><span class="dl">' + r[0] + '</span>' +
              '<span class="input">' + r[1] + '</span><span class="stepper"><span class="sq">\u2212</span>' +
              '<span class="sq">+</span></span></div>';
          }).join('') + '</div>' +
          '<div class="spacer"></div><button class="btn">Сохранить и далее</button>',
          {tabs: false, dense: true}),
      },
      {
        caption: 'Проверка гидравлики', short: 'Гидравлика',
        html: shell({title: 'Проверка гидравлики', info: true},
          '<div class="tabs"><span class="tb on">Чек-лист</span><span class="tb">Инфо</span></div>' +
          '<div class="stack">' +
          checkSection('Уровень масла', 'Уровень масла в баке в норме.', 'ok') +
          checkSection('РБД (рукав высокого давления)', 'Состояние РБД, отсутствие повреждений.', 'ok') +
          checkSection('Соединения и фитинги', 'Отсутствие утечек в соединениях.', 'ok') +
          checkSection('Утечки', 'Отсутствие подтеков масла.', 'warn') +
          checkSection('Повреждения рукава', 'Отсутствие трещин, вздутий, износа.', 'ok') +
          '</div><div class="spacer"></div><button class="btn">Сохранить и далее</button>',
          {tabs: false, dense: true}),
      },
      {
        caption: 'Осмотр площадки', short: 'Площадка',
        html: shell({title: 'Осмотр площадки', info: true},
          '<div class="tabs"><span class="tb on">Чек-лист</span><span class="tb">Карта</span></div>' +
          '<div class="stack">' +
          [['Устойчивое основание', 'Основание уплотнено, установка стоит устойчиво.'],
            ['Опасные зоны', 'Опасные зоны ограждены и обозначены.'],
            ['Котлован и перепады', 'Рядом нет котлованов, откосов и перепадов высот.'],
            ['ЛЭП и коммуникации', 'ЛЭП и подземные коммуникации не создают опасности.'],
            ['Складирование свай', 'Место складирования свай организовано безопасно.'],
            ['Свободная рабочая зона', 'Свободный проезд для доставки … для работы установки.']]
            .map(function (r) {
              return '<div class="sec-block"><div class="sec-head"><span class="sec-t">' + r[0] + '</span>' +
                '<span class="cam">' + I('camera') + '</span></div><p class="sec-d">' + r[1] + '</p>' +
                '<div class="btn-row"><button class="btn tiny green two">Да</button>' +
                '<button class="btn tiny flat two">Нет</button></div></div>';
            }).join('') +
          '</div><div class="spacer"></div><button class="btn">Сохранить и далее</button>',
          {tabs: false, dense: true}),
      },
      {
        caption: 'Блокирующее замечание', short: 'Блокировка',
        html: shell({title: 'Блокирующее замечание'},
          '<div class="card block-card"><div class="ok-line red">' + I('alert') + 'Работа запрещена</div>' +
          '<div class="lbl">Причина</div>' +
          '<p class="sec-d" style="margin-top:2px">Повреждение каната: обрыв прядей на рабочем участке.</p></div>' +
          '<div class="photo rope" style="height:104px"></div>' +
          '<div class="val" style="margin-top:2px">Создать дефект</div>' +
          '<div class="defect-line"><span class="dcode">DEF-2025-0518-0012</span>' +
          '<span class="pill red">Критический</span></div>' +
          '<div class="card flush"><div class="rows">' +
          [['Категория', 'Канаты и тросы'], ['Узел', 'Подъемный канат'],
            ['Описание', 'Обрыв прядей на рабочем участке каната. Подъемные работы недопустимы.'],
            ['Приоритет', 'Критический'], ['Статус', 'Открыт'], ['Создан', '18.05.2025 08:15']]
            .map(function (r) {
              return '<div class="r"><span class="n muted" style="flex:0 0 42%">' + r[0] + '</span>' +
                '<span class="n" style="text-align:right">' + r[1] + '</span></div>';
            }).join('') + '</div></div>' +
          '<div class="spacer"></div><button class="btn red">Создать дефект</button>' +
          '<button class="btn outline">Сообщить мастеру</button>',
          {tabs: false}),
      },
    ],
  });
})();
