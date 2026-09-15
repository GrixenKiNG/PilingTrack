/* «Модуль Оператора — Подэкраны 3/4» — 8 экранов (запуск, прогрев, функции, обслуживание, работа). */
(function () {
  var I = window.PT_ICON, PT = window.PT;
  var G = window.GROUPS = window.GROUPS || [];

  function shell(title, body) {
    return PT.statusbar() + PT.navbar({back: true, title: title}) +
      '<div class="content">' + body + '</div>';
  }

  function field(label, value, ic) {
    return '<div class="field"><div class="lbl">' + label + '</div>' +
      '<div class="fieldbox"><span>' + value + '</span>' + (ic ? '<span class="fico">' + I(ic) + '</span>' : '') + '</div></div>';
  }

  function readrow(k, v) {
    return '<div class="kv"><span class="k">' + k + '</span><span class="v">' + v + '</span></div>';
  }

  function checkrow(t, on) {
    return '<div class="cc-row"><span class="cc' + (on ? ' on' : '') + '">' + (on ? '\u2713' : '') + '</span>' +
      '<span class="cc-t">' + t + '</span></div>';
  }

  G.push({
    id: 'sub3', variant: 'navy', tab: 'Работа',
    title: 'Модуль Оператора. Подэкраны 3/4',
    screens: [
      {
        caption: 'Запуск двигателя', short: 'Запуск',
        html: shell('Запуск двигателя',
          '<div class="kv"><span class="k">Дата и время</span><span class="v">18.05.2025 07:45</span></div>' +
          '<div class="kv"><span class="k">Моточасы</span><span class="v">8 452 м/ч</span></div>' +
          '<div class="rig" style="height:108px"></div>' +
          '<div class="sect2">Подтверждение безопасности</div>' +
          checkrow('Проверено отсутствие людей в опасной зоне', true) +
          checkrow('Убедитесь в исправности ограждений и систем', true) +
          checkrow('Пожарный огнетушитель на месте', true) +
          checkrow('Рабочая зона чистая, препятствий нет', true) +
          '<div class="spacer"></div><button class="btn green">Запустить двигатель</button>'),
      },
      {
        caption: 'Прогрев до рабочих температур', short: 'Прогрев',
        html: shell('Прогрев до рабочих температур',
          '<div class="sect2">Температуры</div>' +
          '<div class="card"><div class="gauge-t">Двигатель</div>' +
          '<div class="gauge"><span class="gv">28 °C</span><span class="gv right">80 °C</span></div>' +
          '<div class="slider"><i class="green" style="width:35%"></i><span class="thumb" style="left:35%"></span></div>' +
          '<div class="gauge-t" style="margin-top:12px">Гидравлика</div>' +
          '<div class="gauge"><span class="gv">19 °C</span><span class="gv right">45 °C</span></div>' +
          '<div class="slider"><i style="width:42%"></i><span class="thumb blue" style="left:42%"></span></div></div>' +
          '<div class="card stat-blue">' +
          '<div class="ok-line dark">' + I('gauge') + 'Состояние прогрева</div>' +
          '<div class="ok-line"><span class="prog-icon"></span>Прогрев идёт</div>' +
          '<div class="muted">Подождите, пока температура достигнет рабочих значений.</div></div>' +
          '<div class="banner"><span class="bi">i</span><span class="bt"><b>Важно</b>Работа с оборудованием ' +
          'разрешается <b>только</b> после прогрева до рабочих температур.</span></div>' +
          '<div class="spacer"></div>' +
          '<div class="sum-row"><div><div class="lbl">Прошло времени</div><div class="sum-v">07:12</div></div>' +
          '<div style="text-align:right"><div class="lbl">Осталось примерно</div><div class="sum-v blue">02:48</div></div></div>'),
      },
      {
        caption: 'Проверка функций', short: 'Функции',
        html: shell('Проверка функций',
          '<p class="intro">Проверка функций без нагрузки. Отметьте выполнение проверки.</p>' +
          '<div class="stack">' +
          '<div class="card"><div class="card-title">Ход</div>' + checkrow('Движение вперёд / назад', false) + '</div>' +
          '<div class="card"><div class="card-title">Лебёдки</div>' + checkrow('Главная лебёдка', true) +
          checkrow('Вспомогательная лебёдка', true) + '</div>' +
          '<div class="card"><div class="card-title">Поворот башни</div>' + checkrow('Поворот влево / вправо', true) + '</div>' +
          '<div class="card"><div class="card-title">Стрела / мачта</div>' + checkrow('Подъём / опускание', true) +
          checkrow('Угол наклона', true) + '</div>' +
          '<div class="card"><div class="card-title">Редукторы и приводы</div>' + checkrow('Редукторы хода', true) +
          checkrow('Редукторы поворота', true) + '</div></div>' +
          '<div class="spacer"></div><div class="status-pill"><span class="ck-circle">&#10003;</span>Проверки сохранены</div>'),
      },
      {
        caption: 'Ежесменное обслуживание', short: 'Обслуживание',
        html: shell('Ежесменное обслуживание',
          '<p class="intro">Выполните работы перед началом смены и отметьте выполнение.</p>' +
          '<div class="stack">' +
          ['Очистка стёкол и зеркал', 'Смазка узлов и соединений', 'Доливка рабочих жидкостей',
            'Очистка воздушного фильтра', 'Проверка огнетушителя'].map(function (t) {
            return '<div class="task-row"><span class="ck-circle">&#10003;</span><span>' + t + '</span></div>';
          }).join('') + '</div>' +
          '<div class="spacer"></div><div class="status-pill"><span class="ck-circle">&#10003;</span>Обслуживание выполнено</div>'),
      },
      {
        caption: 'Главный экран работы', short: 'Работа',
        html: shell('Работа',
          '<div class="card shift-active"><span class="live-dot"></span>' +
          '<div class="sa-t">Смена активна</div>' +
          '<div class="muted">Оператор: Иванов И.И.</div>' +
          '<div class="muted">Начало: 18.05.2025 07:45</div></div>' +
          '<div class="sect2">Оборудование</div>' +
          '<div class="card equip"><span class="rig-mini"></span><div>' +
          '<div class="lbl">Установка</div><div class="pn">Liebherr LRH 100</div>' +
          '<div class="lbl" style="margin-top:4px">Моточасы</div><div class="val">8 452 м/ч</div></div></div>' +
          '<div class="sect2">Сегодня</div>' +
          '<div class="card flush"><div class="rows">' +
          [['Забито свай', '42 шт.'], ['Лидерное бурение', '18.5 м'], ['Простои', '1 ч. 20 мин.'],
            ['Инциденты', '1']].map(function (r) {
            return '<div class="r"><span class="n">' + r[0] + '</span><span class="c b">' + r[1] + '</span></div>';
          }).join('') + '</div></div>' +
          '<div class="stack">' +
          [['green', 'hammer', 'Забивка свай'], ['blue', 'mast', 'Лидерное бурение'],
            ['amber', 'tracks', 'Простои'], ['red', 'wrench', 'Дефект'], ['purple', 'clipboard', 'Инцидент']]
            .map(function (a) {
              return '<div class="action ' + a[0] + '">' + I(a[1]) + '<span>' + a[2] + '</span>' +
                '<span class="chev">&#8250;</span></div>';
            }).join('') + '</div>'),
      },
      {
        caption: 'Забивка свай', short: 'Забивка',
        html: shell('Забивка свай',
          field('№ свай', 'С-042', 'qr') +
          '<div class="field"><div class="lbl">Поле / Куст</div>' +
          '<div class="fieldbox"><span>Поле 3 / Куст A</span><span class="fico">&#9662;</span></div></div>' +
          field('Время', '18.05.2025 09:12', 'calendar') +
          '<div class="sect2">Параметры свай</div>' +
          field('Марка сваи', 'ЖБ 350х350') +
          readrow('Длина, м', '12.0') +
          readrow('Сечение, мм', '350 x 350') +
          '<div class="sect2">Параметры забивки</div>' +
          readrow('Глубина, м', '8.5') + readrow('Отказ, см', '3.0') +
          '<div class="spacer"></div><button class="btn">Сохранить</button>'),
      },
      {
        caption: 'Лидерное бурение', short: 'Бурение',
        html: shell('Лидерное бурение',
          field('Точка бурения', 'LB-017', 'qr') +
          field('Диаметр, мм', '450') +
          field('Проектная глубина, м', '18.0') +
          field('Фактическая глубина, м', '18.5') +
          field('Время', '18.05.2025 09:28', 'calendar') +
          '<div class="field"><div class="lbl">Примечание</div>' +
          '<div class="textarea">Грунт песчаный, без осложнений.</div></div>' +
          '<div class="spacer"></div><button class="btn">Сохранить</button>'),
      },
      {
        caption: 'Простой / Дефект / Инцидент', short: 'Простой',
        html: shell('Простой / Дефект / Инцидент',
          '<div class="segment"><span class="on">Простой</span><span>Дефект</span><span>Инцидент</span></div>' +
          '<div class="field"><div class="lbl">Причина</div>' +
          '<div class="fieldbox"><span>Ожидание материала</span><span class="fico">&#9662;</span></div></div>' +
          field('Начало', '18.05.2025 09:40', 'calendar') +
          '<div class="field"><div class="lbl">Таймер</div>' +
          '<div class="timer-row"><span class="timer">00:35:12</span>' +
          '<span class="pause">' + I('power') + '</span></div></div>' +
          '<div class="field"><div class="lbl">Фото (необязательно)</div>' +
          '<div class="grid2"><div class="photo thumb"></div>' +
          '<div class="add-photo">' + I('camera') + '<span>Добавить</span></div></div></div>' +
          '<div class="field"><div class="lbl">Серьёзность</div>' +
          '<div class="chips"><span class="chip low">Низкая</span><span class="chip mid on">Средняя</span>' +
          '<span class="chip high">Высокая</span></div></div>' +
          '<div class="field"><div class="lbl">Примечание</div>' +
          '<div class="textarea">Ожидаем доставку свай.</div></div>' +
          '<div class="spacer"></div><button class="btn">Сохранить</button>'),
      },
    ],
  });
})();
