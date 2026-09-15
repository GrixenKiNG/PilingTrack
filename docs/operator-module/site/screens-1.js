/* «Модуль Оператора — Подэкраны 1/4» — 8 экранов.
   Тексты выровнены по актуальному описанию визуализации viz2_description.md. */
(function () {
  var I = window.PT_ICON, PT = window.PT;
  var G = window.GROUPS = window.GROUPS || [];

  function shell(o, body, opts) {
    opts = opts || {};
    return PT.statusbar() +
      PT.navbar({back: o.back === undefined ? true : o.back, title: o.title, right: o.right, plain: o.plain}) +
      '<div class="content' + (opts.dense ? ' dense' : '') + '">' + body + '</div>' +
      (opts.tabs === false ? '' : PT.tabsMain());
  }

  var tl = [
    {n: '1', ic: 'id', tone: '', t: 'Идентификация', s: 'Допуск подтверждён', time: '07:45', act: true},
    {n: '2', ic: 'helmet', tone: 'amber', t: 'Приёмка установки', s: 'Принято', time: '07:55'},
    {n: '3', ic: 'clipboard', tone: 'green', t: 'Осмотр', s: 'Осмотр пройден', time: '08:10'},
    {n: '4', ic: 'pin', tone: '', t: 'Площадка', s: 'Площадка проверена', time: '08:25', act: true},
    {n: '5', ic: 'power', tone: 'green', t: 'Запуск', s: 'Двигатель запущен', time: '08:35'},
    {n: '6', ic: 'chart', tone: '', t: 'Работа', s: 'Выполняется', time: '', act: true},
    {n: '7', ic: 'clock', tone: 'gray', t: 'Завершение', s: 'Ожидает выполнения', time: '', muted: true},
  ];

  var docs = [
    ['Удостоверение машиниста', '№ 77 ИА 123456', 'Действует до 15.07.2026'],
    ['Медицинская справка', '№ 2025-7890', 'Действует до 10.08.2026'],
    ['Удостоверение по ТБ', '№ ТБ-2025-0487', 'Действует до 20.08.2026'],
    ['Пожарная безопасность', '№ ПБ-0487-25', 'Действует до 01.10.2026'],
    ['Промышленная безопасность', '№ ПП-0487-25', 'Действует до 01.10.2026'],
  ];

  var briefs = [
    ['Вводный инструктаж', '15.01.2025'],
    ['Первичный на рабочем месте', '15.01.2025'],
    ['Повторный инструктаж', '15.04.2025'],
    ['Целевой инструктаж', '02.05.2025'],
    ['Инструктаж по охране труда', '18.05.2025'],
    ['Инструктаж по технологии', '18.05.2025'],
  ];

  G.push({
    id: 'sub1', variant: 'navy', tab: 'Профиль',
    title: 'Модуль Оператора. Подэкраны 1/4',
    screens: [
      {
        caption: 'Главный экран смены', short: 'Лента смены',
        html: shell({back: I('menu'), title: 'Главный экран смены', right: '<span class="bell">' + I('bell') + '<i>1</i></span>'},
          '<div class="date-row"><div><div class="d1">18 мая 2025, вторник</div>' +
          '<div class="d2">Смена активна</div></div>' +
          '<div class="d3"><span>Начало:</span><b>07:45</b></div></div>' +
          '<div class="tl">' + tl.map(function (s) {
            return '<div class="ti' + (s.muted ? ' muted' : '') + (s.act ? ' act' : '') + '">' +
              '<span class="icon-tile ' + s.tone + '">' + I(s.ic) + '</span>' +
              '<div class="body"><div class="tt"><span class="tnum">' + s.n + '</span>' + s.t + '</div>' +
              '<div class="ts' + (s.muted ? '' : ' good') + '">' + s.s + '</div></div>' +
              '<div class="time">' + s.time + '</div></div>';
          }).join('') + '</div>' +
          '<div class="card"><div class="sect">Объект</div>' +
          '<div class="obj-t">ЖК Северный</div><div class="muted">Уточнения</div>' +
          '<div class="obj-t2">Liebherr LRH 100</div>' +
          '<div class="link-inline"><span>Сменить объект</span><span>&#8594;</span></div></div>'),
      },
      {
        caption: 'Профиль оператора', short: 'Профиль',
        html: shell({title: 'Профиль оператора', right: I('pencil')},
          '<div class="profile-top"><span class="avatar lg">' + I('user') + '</span>' +
          '<div><div class="pn">Иванов Иван Ильич</div><div class="muted">Машинист буровой установки</div></div></div>' +
          '<div class="kv"><span class="k">Табельный номер</span><span class="v">ОР-0487</span></div>' +
          '<div class="kv"><span class="k">Организация</span><span class="v">ООО «ПилотСтрой»</span></div>' +
          '<div class="card"><div class="card-title" style="margin-bottom:4px">Контакты</div>' +
          '<div class="cline">' + I('phone') + '<span>+7 (999) 123-45-67</span></div>' +
          '<div class="cline">' + I('mail') + '<span>ivanov@pilotstroy.ru</span></div></div>' +
          '<div class="card"><div class="card-title" style="margin-bottom:4px">Статус допуска</div>' +
          '<div class="ok-line"><span class="ck-circle">&#10003;</span>Допуск подтверждён</div>' +
          '<div class="muted">Действует до 15.07.2026</div></div>' +
          '<div class="card"><div class="card-title" style="margin-bottom:4px">Квалификация</div>' +
          '<div class="val">Машинист буровой установки</div><div class="muted">7 разряд</div></div>'),
      },
      {
        caption: 'Проверка документов', short: 'Документы',
        html: shell({title: 'Проверка документов'},
          '<div class="stack">' + docs.map(function (d) {
            return '<div class="list-card"><span class="icon-tile">' + I('doc') + '</span>' +
              '<span class="row-body"><span class="t">' + d[0] + '</span>' +
              '<span class="s">' + d[1] + '</span><span class="s">' + d[2] + '</span></span>' +
              '<span class="ok-ring">&#10003;</span></div>';
          }).join('') + '</div>' +
          '<div class="spacer"></div>' +
          '<div class="card success"><div class="ok-line"><span class="ck-circle">&#10003;</span>Все документы действительны</div>' +
          '<div class="val">Допуск подтверждён</div><div class="muted">Действует до 15.07.2026</div></div>'),
      },
      {
        caption: 'Инструктажи', short: 'Инструктажи',
        html: shell({title: 'Инструктажи'},
          '<div class="tabs"><span class="tb on">Все</span><span class="tb">Обязательные</span>' +
          '<span class="tb">Дополнительные</span></div>' +
          '<div class="stack">' + briefs.map(function (b) {
            return '<div class="list-card"><span class="icon-tile">' + I('doc') + '</span>' +
              '<span class="row-body"><span class="t">' + b[0] + '</span>' +
              '<span class="ok-txt sm">Пройден</span><span class="s">' + b[1] + '</span></span>' +
              '<span class="ok-ring">&#10003;</span></div>';
          }).join('') + '</div>' +
          '<div class="spacer"></div>' +
          '<div class="card success"><div class="ok-line"><span class="ck-circle">&#10003;</span>Все инструктажи пройдены</div>' +
          '<div class="muted">Актуально на 18.05.2025</div></div>'),
      },
      {
        caption: 'Проверка знаний по ТБ', short: 'Тест',
        html: shell({title: 'Проверка знаний по ТБ'},
          '<p class="qlabel">Вопрос 3 из 5</p>' +
          '<div class="progress"><i style="width:60%"></i></div>' +
          '<p class="qtext">Какие действия необходимо выполнить при обнаружении утечки гидравлической жидкости?</p>' +
          '<p class="qlabel">Выберите один правильный ответ</p>' +
          ['Немедленно остановить работу, сообщить мастеру и устранить утечку',
            'Продолжить работу, если утечка незначительная',
            'Подождать вторую и продолжить работу',
            'Сообщить только после окончания смены'].map(function (t, i) {
            return '<div class="radio-row' + (i === 0 ? ' sel' : '') + '"><span class="radio"></span>' +
              '<span class="rt">' + t + '</span></div>';
          }).join('') +
          '<div class="spacer"></div><div class="btn-row">' +
          '<button class="btn flat two">Назад</button><button class="btn two">Ответить</button></div>',
          {tabs: false}),
      },
      {
        caption: 'Результат проверки допуска', short: 'Результат',
        html: shell({title: 'Результат проверки допуска'},
          '<div class="result-hero"><div class="halo-wrap"><div class="halo outline big"><div class="dot">\u2713</div></div></div>' +
          '<div class="h">Допуск подтверждён</div>' +
          '<div class="muted center">Оператор Иванов И.И. допущен к работе на 18.05.2025</div></div>' +
          '<div class="divider"></div>' +
          '<div class="card flush"><div class="rows">' +
          ['Документы действительны', 'Инструктажи пройдены', 'Проверка знаний по ТБ пройдена',
            'Медосмотр актуален', 'Нет активных ограничений'].map(function (t) {
            return '<div class="r"><span class="ck-circle">&#10003;</span><span class="n">' + t + '</span></div>';
          }).join('') + '</div></div>' +
          '<div class="spacer"></div><button class="btn">Продолжить смену</button>',
          {tabs: false}),
      },
      {
        caption: 'Выбор объекта', short: 'Объекты',
        html: shell({title: 'Выбор объекта'},
          '<div class="search">' + I('sliders') + '<span>Поиск объекта или площадки</span>' +
          '<span class="filters">' + I('filter') + '</span></div>' +
          '<div class="sect">Название</div>' +
          '<div class="stack">' +
          '<div class="list-card obj"><span class="icon-tile">' + I('doc') + '</span>' +
          '<span class="row-body"><span class="t">ЖК Северный</span>' +
          '<span class="s">г. Москва, СВАО, ул. Ленина, д. 10</span>' +
          '<span class="pill green"><span class="d"></span>Активен</span></span>' +
          '<span class="star">' + I('star') + '</span></div>' +
          '<div class="list-card obj"><span class="icon-tile gray">' + I('doc') + '</span>' +
          '<span class="row-body"><span class="t">ТЦ Парк</span>' +
          '<span class="s">г. Москва, ЗАО, ул. Полярная, 1</span>' +
          '<span class="pill gray">Не активен</span></span></div>' +
          '<div class="list-card obj"><span class="icon-tile gray">' + I('mast') + '</span>' +
          '<span class="row-body"><span class="t">Мост через р. Руза</span>' +
          '<span class="s">Московская область, Мякинино</span>' +
          '<span class="pill gray">Не активен</span></span></div>' +
          '</div>' +
          '<div class="link-row"><span>Показать все объекты (12)</span><span>&#8594;</span></div>' +
          '<div class="spacer"></div><button class="btn">Выбрать объект</button>',
          {tabs: false}),
      },
      {
        caption: 'Принятие установки', short: 'Приёмка',
        html: shell({title: 'Принятие установки'},
          '<div class="hero-machine"><div class="img"></div><div>' +
          '<div class="pn">Liebherr LRH 100</div><div class="pill blue">Готова к работе</div></div></div>' +
          '<div class="kv"><span class="k">Зав. номер</span><span class="v">LRH100-07</span></div>' +
          '<div class="kv"><span class="k">Объект</span><span class="v">ЖК Северный</span></div>' +
          '<div class="divider"></div>' +
          [['wrench', 'Мощность', '8 452 кН'], ['fuel', 'Топливо', '75 %'],
            ['cloud', 'Погода', '+18°C, облачно, ветер 4 м/с']].map(function (r) {
            return '<div class="stat-row"><span class="si">' + I(r[0]) + '</span>' +
              '<span class="st">' + r[1] + '</span><span class="sv">' + r[2] + '</span></div>';
          }).join('') +
          '<div class="card defect"><div class="r"><span class="t">Активные дефекты</span>' +
          '<span class="dcount">' + I('alert') + '<b>1</b><span class="chev">&#8250;</span></span></div>' +
          '<div class="dsub"><b>Незначительные:</b><br>• Течь РВД (подкот …)<br>Пригодна проверена</div></div>' +
          '<div class="spacer"></div><button class="btn">Принять установку</button>',
          {tabs: false}),
      },
    ],
  });
})();
