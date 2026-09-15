/* Рендер модуля оператора: борд (презентация, как в визуализации) и интерактивный просмотр. */
(function () {
  var PT = window.PT, G = window.GROUPS || [];

  PT.phone = function (screen, group) {
    return '<div class="phone ' + (group.variant || 'navy') + '"><div class="screen">' + screen.html + '</div></div>';
  };

  PT.findScreen = function (groupId, index) {
    for (var i = 0; i < G.length; i++) {
      if (G[i].id === groupId) return {group: G[i], index: index, screen: G[i].screens[index]};
    }
    return null;
  };

  PT.flat = function () {
    var out = [];
    G.forEach(function (g) {
      g.screens.forEach(function (s, i) { out.push({group: g, index: i, screen: s}); });
    });
    return out;
  };

  /* --------------------------------------------------------------- БОРД --- */
  PT.board = function (root) {
    var html = '';
    G.forEach(function (g, gi) {
      if (g.id === 'tb') {
        html += tbBanner(g);
      } else {
        html += subBanner(g);
      }
    });
    root.innerHTML = html;
  };

  function subBanner(g) {
    var n = g.title.replace(/^.*Подэкраны\s*/, '');
    return '<section class="board">' +
      '<div class="board-title">PilingTrack &#8212; Модуль Оператора. Подэкраны ' + n + '</div>' +
      '<div class="board-row">' + g.screens.map(function (s, i) {
        return '<figure class="cell"><div class="pb">' + PT.phone(s, g) +
          '</div><figcaption>' + (i + 1) + '. ' + s.caption + '</figcaption></figure>';
      }).join('') + '</div></section>';
  }

  function tbBanner(g) {
    return '<section class="board promo">' +
      '<header class="promo-head">' +
      '<div class="ph-left"><span class="logo">R</span><div>' +
      '<div class="wordmark">PilingTrack</div>' +
      '<div class="tagline">Техника. Люди. Результат.</div></div></div>' +
      '<div class="ph-center"><h1>Безопасность &#8212; основа продуктивной работы</h1>' +
      '<p>Пройди инструктаж. Подтверди знания. Будь допущен к смене.</p></div>' +
      '<div class="ph-right">' + (window.PT_ICON ? PT_ICON('helmet') : '') +
      '<div><div class="r1">Безопасные люди</div><div class="r2">Строят большие результаты</div></div></div>' +
      '</header>' +
      '<div class="board-row">' + g.screens.map(function (s) {
        return '<figure class="cell"><div class="pb">' + PT.phone(s, g) +
          '</div><figcaption>' + s.caption + '</figcaption></figure>';
      }).join('<span class="chev-sep">&#10095;</span>') + '</div>' +
      '<footer class="promo-foot">' +
      '<div><b>PilingTrack</b><span class="sep">|</span>Надежный контроль больших задач</div>' +
      '<div class="fr">' + (window.PT_ICON ? PT_ICON('chart') : '') + '<b>Работает онлайн и офлайн</b>' +
      '<span class="sep">|</span>Синхронизирует данные при появлении связи</div>' +
      '</footer></section>';
  }

  /* --------------------------------------------------- интерактивный вид --- */
  PT.app = function (root) {
    var flat = PT.flat();
    var state = {i: 0, groupId: flat[0].group.id};
    root.innerHTML =
      '<div class="viewer">' +
      '<aside class="rail"><div class="rail-title">Экраны модуля</div><div class="rail-list"></div></aside>' +
      '<main class="stage"><div class="stage-inner"></div>' +
      '<div class="stage-nav"><button data-a="prev">&#8249; Назад</button>' +
      '<span class="pos"></span><button data-a="next">Далее &#8250;</button></div></main></div>';

    var railList = root.querySelector('.rail-list');
    var stageInner = root.querySelector('.stage-inner');
    var pos = root.querySelector('.pos');

    railList.innerHTML = G.map(function (g) {
      return '<div class="rail-group">' + g.title + '</div>' + g.screens.map(function (s, i) {
        var idx = flat.indexOf(flat.filter(function (f) { return f.group.id === g.id; })[i]);
        return '<button class="rail-item" data-i="' + idx + '">' +
          '<span class="rn">' + (g.id === 'tb' ? (i + 1) : (i + 1)) + '</span>' +
          '<span class="rc">' + s.caption + '</span><span class="rk">' + s.short + '</span></button>';
      }).join('');
    }).join('');

    function draw() {
      var cur = flat[state.i];
      stageInner.innerHTML = PT.phone(cur.screen, cur.group);
      pos.textContent = (state.i + 1) + ' / ' + flat.length;
      railList.querySelectorAll('.rail-item').forEach(function (b, k) {
        b.classList.toggle('on', k === state.i);
      });
      var on = railList.querySelector('.rail-item.on');
      if (on) on.scrollIntoView({block: 'nearest'});
    }

    railList.addEventListener('click', function (e) {
      var b = e.target.closest('.rail-item');
      if (b) { state.i = Number(b.dataset.i); draw(); }
    });
    root.querySelector('[data-a="prev"]').addEventListener('click', function () {
      state.i = (state.i - 1 + flat.length) % flat.length; draw();
    });
    root.querySelector('[data-a="next"]').addEventListener('click', function () {
      state.i = (state.i + 1) % flat.length; draw();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowRight') { state.i = (state.i + 1) % flat.length; draw(); }
      if (e.key === 'ArrowLeft') { state.i = (state.i - 1 + flat.length) % flat.length; draw(); }
    });
    draw();
  };

  window.PT_READY = function () {
    var board = document.getElementById('board-root');
    if (board) PT.board(board);
    var app = document.getElementById('app-root');
    if (app) PT.app(app);
  };
})();
