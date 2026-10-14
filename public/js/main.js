// ふわっと表示させる、ほどよいアニメーション
// 「動きが苦手な方」設定(prefers-reduced-motion)の場合は動きを止める

document.addEventListener('DOMContentLoaded', function () {
  var prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var targets = document.querySelectorAll('.fade-in');

  // 同じかたまり（グリッドなど）の中では、少しずつ遅れて「順番に」現れるようにする
  var groups = new Map();
  targets.forEach(function (el) {
    var parent = el.parentElement;
    if (!groups.has(parent)) groups.set(parent, []);
    groups.get(parent).push(el);
  });
  groups.forEach(function (siblings) {
    siblings.forEach(function (el, i) {
      el.style.transitionDelay = (i * 0.12) + 's';
    });
  });

  if (prefersReduced || !('IntersectionObserver' in window)) {
    targets.forEach(function (el) {
      el.classList.add('is-visible');
      el.style.transitionDelay = '';
    });
  } else {
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.15 });

    targets.forEach(function (el) { observer.observe(el); });
  }

  // ここから下は、動きの設定に関わらず必ず有効にする
  // （以前は上のreturnで、動きを止める設定の方にはメニューや絞り込みが
  //   動かなくなってしまっていたのを修正）

  // ---------- スマホ用ハンバーガーメニュー ----------
  var header = document.querySelector('.site-header');
  var navToggle = document.querySelector('.nav-toggle');

  if (header && navToggle) {
    navToggle.addEventListener('click', function () {
      var isOpen = header.classList.toggle('nav-open');
      navToggle.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    });

    // リンクをタップしたら、メニューを自動で閉じる
    header.querySelectorAll('.main-nav a').forEach(function (link) {
      link.addEventListener('click', function () {
        header.classList.remove('nav-open');
        navToggle.setAttribute('aria-expanded', 'false');
      });
    });
  }

  // ---------- 行き先の写真をクリックすると、一番上の写真が切り替わる ----------
  // （ループ横スクロール帯の写真が対象）
  var hero = document.querySelector('.hero');
  var destCards = document.querySelectorAll('.loop-item[data-bg]');

  if (hero && destCards.length) {
    var heroLayers = hero.querySelectorAll('.hero-bg');
    var activeIndex = 0;

    destCards.forEach(function (card) {
      card.addEventListener('click', function (e) {
        e.preventDefault(); // ページ遷移はせず、背景の切り替えだけ行う

        var url = card.getAttribute('data-bg');
        var currentLayer = heroLayers[activeIndex];
        var nextIndex = (activeIndex + 1) % heroLayers.length;
        var nextLayer = heroLayers[nextIndex];

        nextLayer.style.backgroundImage = 'url(' + url + ')';
        nextLayer.classList.add('is-active');
        currentLayer.classList.remove('is-active');
        activeIndex = nextIndex;

        destCards.forEach(function (c) { c.classList.remove('is-selected'); });
        card.classList.add('is-selected');
      });
    });
  }

  // ---------- 現地の天気（Open-Meteo） ----------
  // WMO weather code を、やさしいアイコンとことばに変換する
  function weatherCodeToInfo(code) {
    var map = {
      0: ['☀️', '快晴'],
      1: ['🌤️', 'ほぼ晴れ'],
      2: ['⛅', '晴れ時々くもり'],
      3: ['☁️', 'くもり'],
      45: ['🌫️', '霧'],
      48: ['🌫️', '霧'],
      51: ['🌦️', '小雨'],
      53: ['🌦️', '小雨'],
      55: ['🌧️', '雨'],
      56: ['🌧️', '雨'],
      57: ['🌧️', '雨'],
      61: ['🌧️', '雨'],
      63: ['🌧️', '雨'],
      65: ['🌧️', '強い雨'],
      66: ['🌧️', '雨'],
      67: ['🌧️', '強い雨'],
      71: ['❄️', '雪'],
      73: ['❄️', '雪'],
      75: ['❄️', '強い雪'],
      77: ['❄️', '雪'],
      80: ['🌦️', 'にわか雨'],
      81: ['🌧️', 'にわか雨'],
      82: ['🌧️', '激しいにわか雨'],
      85: ['🌨️', 'にわか雪'],
      86: ['🌨️', '激しいにわか雪'],
      95: ['⛈️', '雷雨'],
      96: ['⛈️', '雷雨'],
      99: ['⛈️', '雷雨']
    };
    return map[code] || ['🌡️', '天気'];
  }

  document.querySelectorAll('.tour-weather[data-lat][data-lon]').forEach(function (el) {
    var lat = el.getAttribute('data-lat');
    var lon = el.getAttribute('data-lon');
    var place = el.getAttribute('data-place') || '';
    // 国内ツアーは気象庁（JMA）の5kmメッシュ予報モデルで精度を上げる。
    // 海外ツアーはJMAモデルの対象外のため、data-model=""・data-tzで
    // 現地タイムゾーン＆世界標準モデル（best_match）を使うよう切り替える。
    var hasModelOverride = el.hasAttribute('data-model');
    var model = hasModelOverride ? el.getAttribute('data-model') : 'jma_seamless';
    var timezone = el.getAttribute('data-tz') || 'Asia/Tokyo';
    var url = 'https://api.open-meteo.com/v1/forecast?latitude=' + lat +
      '&longitude=' + lon + '&current_weather=true&timezone=' + encodeURIComponent(timezone) +
      (model ? '&models=' + model : '');

    fetch(url)
      .then(function (res) {
        if (!res.ok) throw new Error('weather fetch failed');
        return res.json();
      })
      .then(function (data) {
        var current = data && data.current_weather;
        if (!current) throw new Error('no current_weather');

        var info = weatherCodeToInfo(current.weathercode);
        var icon = info[0];
        var label = info[1];
        var temp = Math.round(current.temperature);

        el.classList.remove('is-loading', 'is-error');
        el.innerHTML =
          '<span class="weather-icon" aria-hidden="true">' + icon + '</span>' +
          '<span>' + place + '：' + label + '　' + temp + '℃</span>';
      })
      .catch(function () {
        el.classList.remove('is-loading');
        el.classList.add('is-error');
        el.textContent = '現地の天気は現在取得できません';
      });
  });

  // ---------- おすすめツアーの絞り込みタブ ----------
  document.querySelectorAll('.tour-filter').forEach(function (filterBar) {
    var buttons = filterBar.querySelectorAll('.filter-btn');

    buttons.forEach(function (btn) {
      btn.addEventListener('click', function () {
        buttons.forEach(function (b) {
          b.classList.remove('is-active');
          b.setAttribute('aria-pressed', 'false');
        });
        btn.classList.add('is-active');
        btn.setAttribute('aria-pressed', 'true');

        var filter = btn.getAttribute('data-filter');
        document.querySelectorAll('[data-category]').forEach(function (el) {
          var show = filter === 'all' || el.getAttribute('data-category') === filter;
          el.style.display = show ? '' : 'none';
        });
      });
    });
  });

  // ---------- ループ横スクロール帯 ----------
  // ふだんは回転寿司のレーンのように、止まらずにずっと流れ続ける。
  // カーソルが乗っても止めないが、指やマウスで触れて手で送っているあいだは
  // 自動で流すのをいったん止めて、ユーザーの操作を優先する。
  document.querySelectorAll('.loop-strip').forEach(function (strip) {
    var track = strip.querySelector('.loop-track');
    if (!track) return;

    var speed = 40; // 1秒あたりに自動で流れるピクセル数
    var half = 0;
    var lastTime = null;
    var isInteracting = false;
    var resumeTimer = null;

    function measure() {
      // 複製した後半分ぶんの位置で、そっと先頭へ折り返す
      half = track.scrollWidth / 2;
    }
    measure();
    window.addEventListener('resize', measure);

    function wrap() {
      if (half <= 0) return;
      if (strip.scrollLeft >= half) {
        strip.scrollLeft -= half;
      } else if (strip.scrollLeft < 0) {
        strip.scrollLeft += half;
      }
    }

    function pause() {
      isInteracting = true;
      lastTime = null;
      if (resumeTimer) {
        clearTimeout(resumeTimer);
        resumeTimer = null;
      }
    }

    function resume() {
      // 手を離してすぐには動かさず、少し間を置いてから自動で流れるのを再開する
      if (resumeTimer) clearTimeout(resumeTimer);
      resumeTimer = setTimeout(function () {
        isInteracting = false;
        lastTime = null;
      }, 1200);
    }

    // タッチ・マウスどちらも pointer イベントでまとめて拾う
    strip.addEventListener('pointerdown', pause, { passive: true });
    strip.addEventListener('pointerup', resume, { passive: true });
    strip.addEventListener('pointercancel', resume, { passive: true });
    strip.addEventListener('pointerleave', resume, { passive: true });
    // 指を離したあとの慣性スクロール中も折り返しだけは効かせておく
    strip.addEventListener('scroll', wrap, { passive: true });

    function tick(time) {
      // 手で触れているあいだは自動で流すのを止め、折り返しだけは常に効かせておく
      if (!prefersReduced && !isInteracting) {
        if (lastTime !== null) {
          var dt = (time - lastTime) / 1000;
          strip.scrollLeft += speed * dt;
        }
        lastTime = time;
      }
      wrap();
      requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  });
});
