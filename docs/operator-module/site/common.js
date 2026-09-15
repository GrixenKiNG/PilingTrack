/* Общие элементы каркаса телефона для модуля оператора. */
(function () {
  var I = window.PT_ICON;

  function sig() {
    return '<span class="sig"><i></i><i></i><i></i><i></i></span><span class="wifi"></span>' +
      '<span class="batt"><i></i></span>';
  }

  var PT = window.PT = window.PT || {};

  /* Статус-бар: тёмно-синий (серия «Подэкраны») */
  PT.statusbar = function () {
    return '<div class="statusbar"><span>9:41</span><span class="right">' + sig() + '</span></div>';
  };

  /* Статус-бар: белый (баннер «Перед сменой — ТБ») */
  PT.statusbarLight = function () {
    return '<div class="statusbar light"><span>9:41</span><span class="right">' + sig() + '</span></div>';
  };

  /* Навигационная строка. o = {title, back, right, plain} */
  PT.navbar = function (o) {
    o = o || {};
    return '<div class="navbar' + (o.plain ? ' plain' : '') + '">' +
      (o.back ? '<span class="back">' + (o.back === true ? '&#8249;' : o.back) + '</span>' : '<span class="back"></span>') +
      '<span class="ttl">' + (o.title || '') + '</span>' +
      '<span class="act">' + (o.right || '') + '</span></div>';
  };

  /* Навигационная строка светлая (белая) — баннер ТБ */
  PT.navbarLight = function (o) {
    o = o || {};
    return '<div class="navbar light' + (o.plain ? ' plain' : '') + '">' +
      (o.back ? '<span class="back">' + (o.back === true ? '&#10094;' : o.back) + '</span>' : '<span class="back"></span>') +
      '<span class="ttl">' + (o.title || '') + '</span>' +
      '<span class="act">' + (o.right || '') + '</span></div>';
  };

  /* Нижняя панель вкладок.
     items: [{icon,label,active}] , fab: индекс кружка «+» */
  PT.tabbar = function (items, fab) {
    var out = '<div class="tabbar">';
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      if (fab === i) {
        out += '<div class="t fab"><div class="fab-btn">+</div></div>';
      } else {
        out += '<div class="t' + (it.active ? ' on' : '') + '">' + I(it.icon) + '<span>' + it.label + '</span></div>';
      }
    }
    return out + '</div>';
  };

  PT.incident = function () {
    return '<div class="incident">' + I('alert') + '<span>Сообщить об инциденте</span></div>';
  };

  PT.tabsTB = function (active) {
    return PT.tabbar([
      {icon: 'home', label: 'Главная'},
      {icon: 'clipboard', label: 'Задания'},
      {icon: 'shield', label: 'ТБ', active: active === 2},
      {icon: 'docs', label: 'Журнал'},
      {icon: 'list', label: 'Ещё'},
    ]);
  };

  PT.tabsMain = function (active) {
    return PT.tabbar([
      {icon: 'home', label: 'Главная'},
      {icon: 'clipboard', label: 'Допуски'},
      {icon: '', label: ''},
      {icon: 'calendar', label: 'Смены'},
      {icon: 'user', label: 'Профиль', active: active !== false},
    ], 2);
  };
})();
