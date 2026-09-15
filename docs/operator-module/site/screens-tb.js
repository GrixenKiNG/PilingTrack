/* Баннер «Перед сменой — Техника безопасности» — 4 экрана. */
(function () {
  var I = window.PT_ICON, PT = window.PT;
  var G = window.GROUPS = window.GROUPS || [];

  function appbar(title, state, sync) {
    var st = state === 'pend'
      ? '<span class="dotline pend"><span class="d"></span>Онлайн</span>'
      : '<span class="dotline ok"><span class="d"></span>Онлайн</span>';
    return '<div class="appbar">' +
      '<span class="ab-back">&#10094;</span><span class="ab-title">' + title + '</span>' +
      '<span class="ab-status">' + st + '<span class="ab-sync">' + sync + '</span></span></div>';
  }

  function tail(active) {
    return PT.incident() + PT.tabsTB(active);
  }

  var steps = [
    {n: '1', st: 'done', t: 'СИЗ', s: 'Проверка средств индивидуальной защиты'},
    {n: '2', st: 'active', t: 'Ознакомление с инструкциями', s: 'Не выполнено'},
    {n: '3', st: '', t: 'Проверка знаний по ТБ', s: 'Не выполнено'},
    {n: '4', st: '', t: 'Подпись', s: 'Подтверждение прохождения<br>Не выполнено'},
    {n: '5', st: '', t: 'Допуск к смене', s: 'Решение ответственного<br>Ожидает'},
  ];

  G.push({
    id: 'tb', variant: 'light', tab: 'ТБ',
    title: 'Перед сменой — Техника безопасности',
    screens: [
      {
        caption: 'Оператор', short: 'Список шагов',
        html: PT.statusbarLight() + appbar('Оператор', 'ok', 'Синхронизировано 09:41') +
          '<div class="content dense">' +
          '<h1 class="pt-h1">Перед сменой — Техника безопасности</h1>' +
          '<p class="pt-sub">Пройдите все шаги, чтобы получить доступ к работе на объекте</p>' +
          steps.map(function (s) {
            return '<div class="step ' + s.st + '"><span class="num">' + (s.st === 'done' ? '\u2713' : s.n) + '</span>' +
              '<span class="row-body"><span class="tt">' + s.t + '</span><span class="ts">' + s.s + '</span></span>' +
              '<span class="chev">&#8250;</span></div>';
          }).join('') +
          '<div class="banner"><span class="bi">i</span><span class="bt"><b>Прохождение занимает 5\u201310 минут</b>' +
          'Это важно для вашей безопасности и безопасности коллег</span></div>' +
          '<div class="spacer"></div></div>' + tail(2),
      },
      {
        caption: 'Ознакомление', short: 'Чтение инструкции',
        html: PT.statusbarLight() + appbar('Ознакомление', 'pend', 'Будет синхронизировано') +
          '<div class="content">' +
          '<h1 class="pt-h2">Ознакомление с инструкцией</h1>' +
          '<div class="card"><div class="doc-row">' +
          '<span class="pdf">' + I('doc') + 'PDF</span>' +
          '<span class="row-body"><span class="dt">Инструкция по охране труда для машиниста сваебойной установки</span>' +
          '<span class="meta">Версия 2.4&nbsp;&nbsp;|&nbsp;&nbsp;05.04.2025&nbsp;&nbsp;|&nbsp;&nbsp;12 страниц</span></span>' +
          '</div></div>' +
          '<div class="pill blue">' + I('clipboard') + 'Обязательное ознакомление</div>' +
          '<div class="photo" style="height:186px">' +
          '<span class="expand">' + I('expand') + '</span>' +
          '<div class="overlay"><div class="ow">PilingTrack</div>' +
          '<div class="oc">ИНСТРУКЦИЯ ПО ОХРАНЕ ТРУДА<br>ДЛЯ МАШИНИСТА СВАЕБОЙНОЙ УСТАНОВКИ</div>' +
          '<div class="overlay-right"><div>Версия 2.4</div><div>05.04.2025</div></div></div></div>' +
          '<button class="btn outline">' + I('download') + 'Скачать документ (PDF, 4.8 МБ)</button>' +
          '<div class="check-row"><span class="cbox">\u2713</span><span class="ct">Я ознакомился с инструкцией, ' +
          'понимаю требования и обязуюсь их соблюдать</span></div>' +
          '<div class="spacer"></div><button class="btn">Ознакомлен</button></div>' + tail(2),
      },
      {
        caption: 'Проверка знаний', short: 'Вопрос 2 из 4',
        html: PT.statusbarLight() + appbar('Проверка знаний', 'ok', 'Синхронизировано 09:43') +
          '<div class="content dense">' +
          '<div class="qhead"><h1 class="pt-h2">Проверка знаний по ТБ</h1><span class="qcount">2 из 4</span></div>' +
          '<div class="progress"><i style="width:50%"></i></div>' +
          '<p class="qlabel">Вопрос 2 из 4</p>' +
          '<p class="qtext">На каком минимальном расстоянии разрешается находиться людям от работающей ' +
          'сваебойной установки?</p>' +
          ['5 метров', 'Не менее 10 метров', 'Не менее 20 метров', 'Расстояние не регламентируется']
            .map(function (t, i) {
              return '<div class="radio-row' + (i === 1 ? ' sel' : '') + '"><span class="radio"></span>' +
                '<span class="rt">' + t + '</span></div>';
            }).join('') +
          '<div class="banner"><span class="bi">i</span><span class="bt">Выберите один правильный вариант</span></div>' +
          '<div class="spacer"></div><div class="btn-row">' +
          '<button class="btn ghost-blue two">Назад</button>' +
          '<button class="btn two">Далее</button></div></div>' + tail(2),
      },
      {
        caption: 'Итог', short: 'Допуск получен',
        html: PT.statusbarLight() + appbar('Итог', 'ok', 'Синхронизировано 09:45') +
          '<div class="content dense">' +
          '<div class="result-hero"><div class="halo-wrap"><span class="conf c1"></span><span class="conf c2"></span>' +
          '<span class="conf c3"></span><span class="conf c4"></span><span class="conf c5"></span>' +
          '<div class="halo"><div class="dot">\u2713</div></div></div>' +
          '<div class="h">Вы допущены к смене!</div><div class="s">Все этапы успешно пройдены</div></div>' +
          '<div class="card flush"><div class="rows">' +
          [['СИЗ', 'Выполнено'], ['Ознакомление с инструкциями', 'Выполнено'],
            ['Проверка знаний по ТБ', 'Пройдено (4 из 4)'], ['Подпись', 'Подтверждена'],
            ['Допуск к смене', 'Разрешен']].map(function (r) {
            return '<div class="r"><span class="ck">\u2713</span><span class="n">' + r[0] + '</span>' +
              '<span class="ok-txt">' + r[1] + '</span></div>';
          }).join('') + '</div></div>' +
          '<div class="card"><div class="doc-row"><span class="avatar">' + I('user') + '</span>' +
          '<span class="row-body"><span class="pn">Иванов П.А.</span>' +
          '<span class="muted">Машинист</span><span class="muted">Допуск действителен на смену</span>' +
          '<span class="pd">14 апреля 2025</span></span><span class="qr"></span></div></div>' +
          '<div class="banner"><span class="bi">i</span><span class="bt">Следующий инструктаж: через 30 дней</span>' +
          '<span class="cal">' + I('calendar') + '</span></div>' +
          '<button class="btn outline">' + I('hammer') + 'Режим работы</button>' +
          '<div class="spacer"></div></div>' + tail(2),
      },
    ],
  });
})();
