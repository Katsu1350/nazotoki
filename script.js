/* =====================================================================
   script.js ― アプリ本体（通常は編集不要。問題の内容は config.js を編集してください）
   ===================================================================== */
(function () {
  'use strict';

  var CFG = window.GAME_CONFIG;
  var appEl = document.getElementById('app');
  var overlayEl = document.getElementById('overlay');
  var toastEl = document.getElementById('toast');

  function fatal(msg) {
    appEl.innerHTML = '<div class="fatal"><h1>エラー</h1><p>' + msg + '</p></div>';
  }
  if (!CFG || !CFG.questions) {
    fatal('config.js を読み込めませんでした。ファイルがあるか、書き方（カンマや引用符）に誤りがないか確認してください。');
    return;
  }
  window.addEventListener('error', function (e) {
    if (appEl.querySelector('.loading')) fatal('読み込み中にエラーが発生しました：' + (e.message || ''));
  });

  /* ---------- 共通ヘルパー ---------- */
  var QORDER = ['q1', 'q2', 'q3', 'final'];
  var DEFAULT_LABELS = { q1: '第1問', q2: '第2問', q3: '第3問', final: '最終問題' };
  function Q(id) { return CFG.questions[id] || {}; }
  function labelOf(id) { return Q(id).label || DEFAULT_LABELS[id]; }
  var MSG = Object.assign({
    correct: '正解です！', wrong: '不正解です。もう一度考えてみましょう。', empty: '答えを入力してください。',
    timeUp: '制限時間が終了しました。回答は送信できません。', unset: '問題データが未設定です。'
  }, CFG.messages || {});

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function nl(s) { return esc(s).replace(/\n/g, '<br>'); }
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  var toastTimer = null;
  function toast(text) {
    toastEl.textContent = text; toastEl.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.hidden = true; }, 2800);
  }

  /* ---------- URLパラメータ（テスト用） ---------- */
  var params = new URLSearchParams(location.search);
  var DEBUG = params.get('debug') === '1';
  var minutesOverride = Number(params.get('minutes')) > 0 ? Number(params.get('minutes')) : null;

  /* ---------- 端末内保存 ---------- */
  var STORE_KEY = (CFG.storageKey || 'nazotoki') + ':' + location.pathname.replace(/index\.html$/, '');
  var storageOK = true;

  function defaultState() {
    return { v: 1, table: null, seat: null, startedAt: null, limitSec: null, finishedAt: null,
      view: 'q1', solved: {}, reviewViewed: {}, drafts: {}, q3: { cells: {}, revealed: [] } };
  }
  if (params.get('reset') === '1') {
    try { localStorage.removeItem(STORE_KEY); } catch (e) { /* 無視 */ }
    if (history.replaceState) history.replaceState(null, '', location.pathname);
  }
  function loadState() {
    var s = defaultState();
    try {
      var raw = localStorage.getItem(STORE_KEY);
      if (raw) s = Object.assign(s, JSON.parse(raw));
    } catch (e) { storageOK = false; }
    s.solved = s.solved || {}; s.reviewViewed = s.reviewViewed || {}; s.drafts = s.drafts || {};
    s.q3 = s.q3 || {}; s.q3.cells = s.q3.cells || {}; s.q3.revealed = s.q3.revealed || [];
    return s;
  }
  function saveState() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) { storageOK = false; }
  }
  var state = loadState();
  var ui = { screen: 'title', msg: {}, overlay: null, reviewFocus: null, timeUpHandled: false };

  /* ---------- 進行ルール ---------- */
  function isUnlocked(id) {
    var i = QORDER.indexOf(id);
    return i === 0 || !!state.solved[QORDER[i - 1]];
  }
  function nextOf(id) { var i = QORDER.indexOf(id); return QORDER[i + 1] || null; }
  function firstUnsolved() {
    for (var i = 0; i < QORDER.length; i++) if (!state.solved[QORDER[i]]) return QORDER[i];
    return 'final';
  }

  /* ---------- タイマー ---------- */
  function limitSec() { return state.limitSec || Math.round(((CFG.timer && CFG.timer.limitMinutes) || 20) * 60); }
  function remainingMs() {
    if (!state.startedAt) return limitSec() * 1000;
    var end = state.finishedAt || Date.now();
    var elapsed = Math.max(0, end - state.startedAt);
    return Math.max(0, limitSec() * 1000 - elapsed);
  }
  function isTimeUp() { return !!state.startedAt && !state.finishedAt && remainingMs() <= 0; }
  function fmt(ms) {
    var s = Math.ceil(ms / 1000), m = Math.floor(s / 60), r = s % 60;
    return (m < 10 ? '0' : '') + m + ':' + (r < 10 ? '0' : '') + r;
  }
  function updateTimerUI() {
    var el = $('#timer'), tx = $('#timeText');
    if (!el || !tx) return;
    var ms = remainingMs(), sec = Math.ceil(ms / 1000), t = CFG.timer || {};
    var cls = 'hd-timer', label = '残り', prefix = '';
    if (state.finishedAt) { label = 'クリア！残り'; }
    else if (ms <= 0) { cls += ' over'; label = '時間切れ'; }
    else if (sec <= (t.dangerAtSec || 60)) { cls += ' danger'; prefix = '⚠ '; }
    else if (sec <= (t.warnAtSec || 300)) { cls += ' warn'; prefix = '⚠ '; }
    if (el.className !== cls) el.className = cls;
    el.firstChild.textContent = label;
    tx.textContent = prefix + fmt(ms);
  }

  /* ---------- 回答の照合 ---------- */
  function normalizeAnswer(s) {
    var m = CFG.matching || {};
    s = String(s == null ? '' : s);
    if (m.unifyWidth !== false) s = s.normalize('NFKC');
    if (m.trim !== false) s = s.trim();
    if (m.removeSpaces) s = s.replace(/[\s\u3000]+/g, '');
    if (m.ignoreCase !== false) s = s.toLowerCase();
    return s;
  }
  function isCorrect(id, input) {
    var n = normalizeAnswer(input);
    if (!n) return false;
    return (Q(id).answers || []).some(function (a) { return normalizeAnswer(a) === n; });
  }
  function parsePosInt(v, max) {
    var s = String(v == null ? '' : v).normalize('NFKC').trim();
    if (!/^[1-9][0-9]*$/.test(s)) return null;
    var n = Number(s);
    if (!isFinite(n) || n > max) return null;
    return n;
  }
  // テーブル番号は 0 も受け付ける（0 = ヒント非表示）。不正なら null
  function parseTable(v, max) {
    var s = String(v == null ? '' : v).normalize('NFKC').trim();
    if (/^0+$/.test(s)) return 0;
    return parsePosInt(s, max);
  }
  function limits() { return Object.assign({ tableMax: 4, seatMax: 7 }, CFG.numberLimits || {}); }
  function hasNumbers() { return state.table != null && state.seat != null; }
  // テーブル番号 0 のときは各問題のヒントを一切表示しない
  function noHints() { return state.table === 0; }
  // 画面に出すテーブル番号（0 は表示しない）
  function tableShown() { return state.table ? state.table : ''; }

  /* ---------- 参加者別の表示内容 ---------- */
  function q1Hint() {
    var h = Q('q1').hint;
    if (noHints() || !h || !h.byRemainder) return null;
    var base = h.basedOn === 'table' ? state.table : state.seat;
    var rem = base % (h.divisor || 3);
    return h.byRemainder[rem] || null;
  }
  function q2Testimonies() {
    // 全員共通の証言（common）はテーブル0でも表示し、テーブル別の証言だけ隠す
    var t = Q('q2').testimonies || {}, list = (t.common || []).slice(), bt = t.byTable || [];
    if (bt.length && !noHints()) {
      var idx = (((state.table - 1) % bt.length) + bt.length) % bt.length;
      if (bt[idx]) list.push(bt[idx]);
    }
    return list;
  }

  /* ---------- QRコード ---------- */
  if (typeof qrcode === 'function' && qrcode.stringToBytesFuncs && qrcode.stringToBytesFuncs['UTF-8']) {
    qrcode.stringToBytes = qrcode.stringToBytesFuncs['UTF-8'];
  }
  function getJoinUrl() {
    var u = String(CFG.joinUrl || '').trim();
    if (u) return u;
    return location.href.split('#')[0].split('?')[0].replace(/index\.html$/, '');
  }
  function qrSvg(url) {
    try {
      if (typeof qrcode !== 'function') return null;
      var qr = qrcode(0, 'M'); qr.addData(url); qr.make();
      var n = qr.getModuleCount(), q = 4, d = '';
      for (var r = 0; r < n; r++) for (var c = 0; c < n; c++) if (qr.isDark(r, c)) d += 'M' + (c + q) + ' ' + (r + q) + 'h1v1h-1z';
      var size = n + q * 2;
      return '<svg class="qr-svg" viewBox="0 0 ' + size + ' ' + size + '" role="img" aria-label="参加用QRコード" shape-rendering="crispEdges">' +
        '<rect width="' + size + '" height="' + size + '" fill="#fff"/><path d="' + d + '" fill="#000"/></svg>';
    } catch (e) { console.error('QR生成に失敗', e); return null; }
  }
  function qrBlock() {
    var url = getJoinUrl(), svg = qrSvg(url);
    return (svg ? '<div class="qr-box">' + svg + '</div>'
      : '<p class="qr-fail">QRコードを表示できませんでした。下のURLを直接開いてください。</p>') +
      '<p class="qr-url">' + esc(url) + '</p>';
  }

  /* =====================================================================
     クロスワード
     ===================================================================== */
  var XW = { ok: false, warnings: [], sel: null, preview: null, composing: false };
  var SENT = '\u200b';

  function kana(ch) {
    var c = ch.charCodeAt(0);
    if (c >= 0x30A1 && c <= 0x30F6) ch = String.fromCharCode(c - 0x60);
    var small = { 'ぁ': 'あ', 'ぃ': 'い', 'ぅ': 'う', 'ぇ': 'え', 'ぉ': 'お', 'っ': 'つ', 'ゃ': 'や', 'ゅ': 'ゆ', 'ょ': 'よ', 'ゎ': 'わ' };
    return small[ch] || ch;
  }
  function kanaChars(str) {
    var out = [], s = String(str).normalize('NFKC');
    Array.from(s).forEach(function (ch) { if (/[ぁ-ゖァ-ヶー]/.test(ch)) out.push(kana(ch)); });
    return out;
  }
  function key(r, c) { return r + ',' + c; }
  function warn(msg) { XW.warnings.push(msg); console.warn('[config] ' + msg); }

  function xwInit() {
    XW.ok = false; XW.warnings = [];
    var cw = Q('q3').crossword;
    if (!cw || !Array.isArray(cw.solution) || !cw.solution.length) return;
    var rows = cw.solution.map(function (s) { return Array.from(String(s)); });
    XW.R = rows.length;
    XW.C = Math.max.apply(null, rows.map(function (r) { return r.length; }));
    XW.sol = []; XW.black = [];
    rows.forEach(function (row, r) {
      XW.sol[r] = []; XW.black[r] = [];
      for (var c = 0; c < XW.C; c++) {
        var ch = row[c], b = (ch === undefined || ch === '■' || ch === '#');
        XW.black[r][c] = b;
        XW.sol[r][c] = (b || ch === '□') ? '' : kana(ch);
      }
    });
    function inGrid(r, c) { return r >= 0 && c >= 0 && r < XW.R && c < XW.C; }
    XW.clues = []; XW.byNo = {}; XW.acrossAt = {}; XW.downAt = {}; XW.startNo = {}; XW.startAt = {};
    (cw.clues || []).forEach(function (cl) {
      var dir = (cl.dir === 'across' || cl.dir === '横') ? 'across' : 'down';
      var dr = dir === 'down' ? 1 : 0, dc = dir === 'across' ? 1 : 0;
      if (!inGrid(cl.r, cl.c) || XW.black[cl.r][cl.c]) { warn('鍵' + cl.no + ': 開始マスが盤面の外か黒マスです'); return; }
      var cells = [], r = cl.r, c = cl.c;
      while (inGrid(r, c) && !XW.black[r][c]) { cells.push([r, c]); r += dr; c += dc; }
      var ans = Array.from(String(cl.answer || ''));
      if (ans.length && ans.length <= cells.length) cells = cells.slice(0, ans.length);
      else if (ans.length > cells.length) warn('鍵' + cl.no + ': 答えの文字数がマスの数より多いです');
      var obj = { no: cl.no, dir: dir, text: cl.text || '', answer: cl.answer || '', cells: cells };
      if (XW.byNo[obj.no]) warn('鍵の番号 ' + obj.no + ' が重複しています');
      XW.byNo[obj.no] = obj; XW.clues.push(obj);
      cells.forEach(function (p, i) { (dir === 'across' ? XW.acrossAt : XW.downAt)[key(p[0], p[1])] = { clue: obj, idx: i }; });
      var sk = key(cl.r, cl.c);
      XW.startNo[sk] = XW.startNo[sk] ? XW.startNo[sk] + '/' + cl.no : String(cl.no);
      (XW.startAt[sk] = XW.startAt[sk] || []).push(obj);
      ans.forEach(function (ch, i) {
        if (i < cells.length && kana(ch) !== XW.sol[cells[i][0]][cells[i][1]] && XW.sol[cells[i][0]][cells[i][1]] !== '') {
          warn('鍵' + cl.no + '「' + cl.answer + '」の' + (i + 1) + '文字目が盤面（' + XW.sol[cells[i][0]][cells[i][1]] + '）と一致しません');
        }
      });
    });
    XW.clues.sort(function (a, b) { return a.no - b.no; });
    XW.markers = {};
    (cw.markers || []).forEach(function (m) { XW.markers[key(m.r, m.c)] = m.label; });
    XW.ok = XW.clues.length > 0;
    if (XW.warnings.length) window.__configWarnings = XW.warnings;
  }

  function xwVisibleNos() {
    if (noHints()) return [];
    var cw = Q('q3').crossword || {}, a = cw.assignment || {}, nos;
    var k = state.table + '-' + state.seat;
    if (a.overrides && Array.isArray(a.overrides[k])) nos = a.overrides[k].slice();
    else if (a.basedOn === 'seatTable') {
      // 参加者番号 = (座席番号-1)×perSeat + テーブル番号 → 同じ番号の鍵を渡す
      // 鍵の最大番号を超えたら1番から繰り返す（例: 鍵25個なら26→1, 28→3）
      var pn = (state.seat - 1) * (a.perSeat || limits().tableMax) + state.table;
      var maxNo = Math.max.apply(null, XW.clues.map(function (c) { return c.no; }));
      nos = (a.common || []).concat([((pn - 1) % maxNo) + 1]);
    } else if (Array.isArray(a.groups) && a.groups.length) {
      var n = a.basedOn === 'table' ? state.table : a.basedOn === 'tableSeat' ? state.table + state.seat - 1 : state.seat;
      var g = a.groups, idx = (((n - 1) % g.length) + g.length) % g.length;
      nos = (a.common || []).concat(g[idx]);
    } else nos = XW.clues.map(function (c) { return c.no; });
    return nos.filter(function (no) { return XW.byNo[no]; });
  }
  function xwShownNos() {
    if (noHints()) return [];
    var set = {}, out = [];
    xwVisibleNos().concat(state.q3.revealed).forEach(function (no) { if (XW.byNo[no] && !set[no]) { set[no] = 1; out.push(no); } });
    return out.sort(function (a, b) { return a - b; });
  }
  function xwLocked() {
    var set = {};
    state.q3.revealed.forEach(function (no) {
      var cl = XW.byNo[no]; if (cl) cl.cells.forEach(function (p) { set[key(p[0], p[1])] = true; });
    });
    return set;
  }
  function curClue() {
    var s = XW.sel; if (!XW.ok || !s) return null;
    var e = (s.dir === 'across' ? XW.acrossAt : XW.downAt)[key(s.r, s.c)];
    return e ? e.clue : null;
  }
  function curIdx() {
    var cl = curClue(); if (!cl) return 0;
    for (var i = 0; i < cl.cells.length; i++) if (cl.cells[i][0] === XW.sel.r && cl.cells[i][1] === XW.sel.c) return i;
    return 0;
  }
  function canEdit() { return !!state.startedAt && !isTimeUp(); }

  function xwDefaultSel() {
    if (!XW.ok) return;
    var nos = xwShownNos(), cl = XW.byNo[nos[0]] || XW.clues[0];
    XW.sel = { r: cl.cells[0][0], c: cl.cells[0][1], dir: cl.dir };
  }
  function xwSelect(r, c, tap) {
    if (!XW.ok || r < 0 || c < 0 || r >= XW.R || c >= XW.C || XW.black[r][c]) return;
    var k = key(r, c), a = XW.acrossAt[k], d = XW.downAt[k];
    if (!a && !d) return;
    var dir = XW.sel ? XW.sel.dir : 'across', starts = XW.startAt[k];
    if (starts) {
      // 数字のマス → その番号の鍵の向き（同じマスから縦横両方が始まる場合だけ、再タップで切り替え）
      var same = XW.sel && XW.sel.r === r && XW.sel.c === c, i = 0;
      if (same && tap && starts.length > 1) {
        for (var j = 0; j < starts.length; j++) if (starts[j].dir === dir) i = (j + 1) % starts.length;
      }
      dir = starts[i].dir;
    } else if (!(a && d)) dir = a ? 'across' : 'down';
    // 数字のない交差マスは今の向きのまま
    XW.sel = { r: r, c: c, dir: dir };
    xwCancelPreview();
    xwRefresh();
  }
  function xwStepClue(delta) {
    var nos = xwShownNos(); if (!nos.length) nos = XW.clues.map(function (c) { return c.no; });
    var cl = curClue(), i = cl ? nos.indexOf(cl.no) : -1;
    var next = XW.byNo[nos[(((i + delta) % nos.length) + nos.length) % nos.length]];
    var cells = next.cells, pick = cells[0], locked = xwLocked();
    for (var j = 0; j < cells.length; j++) { var kk = key(cells[j][0], cells[j][1]); if (!state.q3.cells[kk] && !locked[kk]) { pick = cells[j]; break; } }
    XW.sel = { r: pick[0], c: pick[1], dir: next.dir };
    xwCancelPreview(); xwRefresh();
  }
  function xwPickClue(no) {
    var cl = XW.byNo[no]; if (!cl) return;
    XW.sel = { r: cl.cells[0][0], c: cl.cells[0][1], dir: cl.dir };
    xwCancelPreview(); xwRefresh(); xwFocus(true);
  }
  function xwArrow(dr, dc) {
    if (!XW.sel) return;
    var r = XW.sel.r + dr, c = XW.sel.c + dc;
    while (r >= 0 && c >= 0 && r < XW.R && c < XW.C) {
      if (!XW.black[r][c]) {
        var k = key(r, c), pref = dr !== 0 ? 'down' : 'across';
        var has = pref === 'down' ? XW.downAt[k] : XW.acrossAt[k];
        if (!XW.acrossAt[k] && !XW.downAt[k]) { r += dr; c += dc; continue; }
        XW.sel = { r: r, c: c, dir: has ? pref : (pref === 'down' ? 'across' : 'down') };
        xwCancelPreview(); xwRefresh(); return;
      }
      r += dr; c += dc;
    }
  }

  function xwWrite(chars) {
    var cl = curClue(); if (!cl || !chars.length || !canEdit()) return;
    var cells = cl.cells, locked = xwLocked(), i = curIdx(), last = -1;
    for (var n = 0; n < chars.length; n++) {
      while (i < cells.length && locked[key(cells[i][0], cells[i][1])]) i++;
      if (i >= cells.length) break;
      state.q3.cells[key(cells[i][0], cells[i][1])] = chars[n];
      last = i; i++;
    }
    if (last < 0) return;
    var ni = i;
    while (ni < cells.length && locked[key(cells[ni][0], cells[ni][1])]) ni++;
    if (ni >= cells.length) ni = last;
    XW.sel = { r: cells[ni][0], c: cells[ni][1], dir: cl.dir };
    saveState();
  }
  function xwBackspace(stay) {
    var cl = curClue(); if (!cl || !canEdit()) return;
    var cells = cl.cells, locked = xwLocked(), i = curIdx(), k = key(cells[i][0], cells[i][1]);
    if (state.q3.cells[k] && !locked[k]) delete state.q3.cells[k];
    else if (!stay) {
      var j = i - 1;
      while (j >= 0 && locked[key(cells[j][0], cells[j][1])]) j--;
      if (j >= 0) { delete state.q3.cells[key(cells[j][0], cells[j][1])]; XW.sel = { r: cells[j][0], c: cells[j][1], dir: cl.dir }; }
    }
    saveState(); xwRefresh();
  }
  function buildPreview(chars) {
    var cl = curClue(); if (!cl) return null;
    var cells = cl.cells, locked = xwLocked(), i = curIdx(), map = {};
    for (var n = 0; n < chars.length; n++) {
      while (i < cells.length && locked[key(cells[i][0], cells[i][1])]) i++;
      if (i >= cells.length) break;
      map[key(cells[i][0], cells[i][1])] = chars[n]; i++;
    }
    return map;
  }
  function xwInputEl() { return document.getElementById('xwInput'); }
  function xwResetInput() {
    var el = xwInputEl(); if (!el) return;
    el.value = SENT;
    try { el.setSelectionRange(1, 1); } catch (e) { /* 無視 */ }
  }
  function xwCancelPreview() { if (XW.preview) { XW.preview = null; xwResetInput(); } }
  function xwFlush() {
    var el = xwInputEl(); if (!el) return;
    var chars = kanaChars(el.value.replace(/\u200b/g, ''));
    XW.preview = null;
    if (chars.length) xwWrite(chars);
    xwResetInput(); xwRefresh();
  }
  function xwFocus(scroll) {
    var el = xwInputEl(); if (!el || !canEdit()) return;
    try { el.focus({ preventScroll: true }); } catch (e) { el.focus(); }
    if (!el.value) xwResetInput();
    if (scroll) setTimeout(xwKeepVisible, 350);
  }
  function xwKeepVisible() {
    var g = document.getElementById('xw'); if (!g || !window.visualViewport) return;
    var rect = g.getBoundingClientRect(), vh = window.visualViewport.height;
    if (rect.bottom > vh - 6) window.scrollBy(0, rect.bottom - vh + 10);
  }

  function xwBannerHtml() {
    var cl = curClue();
    if (!cl) return '<span class="b-text dim">マスをタップして選びましょう。</span>';
    var meta = cl.no + '番 ' + (cl.dir === 'across' ? '横' : '縦') + '・' + cl.cells.length + '文字';
    var revealed = state.q3.revealed.indexOf(cl.no) >= 0;
    var shown = xwShownNos().indexOf(cl.no) >= 0;
    var body = shown ? '<span class="b-text">' + esc(cl.text) + (revealed ? '（答えが公開されました）' : '') + '</span>'
      : '<span class="b-text dim">この鍵は周りの人が持っています。聞いてみましょう！</span>';
    return '<span class="b-meta">' + meta + '</span>' + body;
  }
  function xwRefresh() {
    var grid = document.getElementById('xw'); if (!grid) return;
    var locked = xwLocked(), cl = curClue(), wordKeys = {};
    if (cl) cl.cells.forEach(function (p) { wordKeys[key(p[0], p[1])] = true; });
    var pv = XW.preview || {}, selKey = XW.sel ? key(XW.sel.r, XW.sel.c) : '';
    $$('.cell.w', grid).forEach(function (el) {
      var k = key(el.dataset.r, el.dataset.c), ch = state.q3.cells[k] || '', isPv = false;
      if (pv[k] !== undefined) { ch = pv[k]; isPv = true; }
      $('.ch', el).textContent = ch;
      el.classList.toggle('word', !!wordKeys[k]);
      el.classList.toggle('sel', k === selKey);
      el.classList.toggle('lock', !!locked[k]);
      el.classList.toggle('pv', isPv);
    });
    var b = document.getElementById('xwActive'); if (b) b.innerHTML = xwBannerHtml();
    $$('.clue').forEach(function (btn) { btn.classList.toggle('active', !!cl && Number(btn.dataset.no) === cl.no); });
    var rv = $$('.clue em'); // 公開済み表示は再描画時に反映
    void rv;
  }

  function xwReveal(no) {
    var cl = XW.byNo[no]; if (!cl || state.q3.revealed.indexOf(no) >= 0) return false;
    state.q3.revealed.push(no);
    cl.cells.forEach(function (p) { if (XW.sol[p[0]][p[1]]) state.q3.cells[key(p[0], p[1])] = XW.sol[p[0]][p[1]]; });
    return true;
  }
  function autoRevealTick() {
    if (!XW.ok || !state.startedAt || state.solved.q3) return;
    var ar = (Q('q3').crossword || {}).autoReveal;
    if (!ar || ar.enabled === false) return;
    var remSec = remainingMs() / 1000, th = ar.startWhenRemainingSec || 180;
    if (remSec >= th) return;
    var interval = Math.max(1, ar.intervalSec || 7);
    var order = (ar.order && ar.order.length) ? ar.order : XW.clues.map(function (c) { return c.no; });
    var target = Math.min(order.length, Math.floor((th - remSec) / interval) + 1), changed = false;
    for (var i = 0; i < target; i++) if (xwReveal(order[i])) changed = true;
    if (changed) { saveState(); if (ui.screen === 'game' && state.view === 'q3') { rebuildClueList(); xwRefresh(); } }
  }

  function clueListHtml() {
    var nos = xwShownNos(), revealed = state.q3.revealed;
    function list(dir) {
      var items = nos.filter(function (n) { return XW.byNo[n].dir === dir; }).map(function (n) {
        var cl = XW.byNo[n];
        return '<li><button type="button" class="clue" data-act="pick-clue" data-no="' + n + '"><b>' + n + '</b><small>（' + cl.cells.length + '文字）</small>' +
          esc(cl.text) + (revealed.indexOf(n) >= 0 ? ' <em>答え公開済み</em>' : '') + '</button></li>';
      });
      return items.length ? '<ul class="clue-list">' + items.join('') + '</ul>' : '<p class="note">なし</p>';
    }
    var others = XW.clues.filter(function (c) { return nos.indexOf(c.no) < 0; }).map(function (c) {
      return c.no + '(' + (c.dir === 'across' ? '横' : '縦') + ')';
    });
    return '<h3>縦の鍵</h3>' + list('down') + '<h3>横の鍵</h3>' + list('across') +
      (others.length ? '<p class="others">ほかの鍵は周りの人が持っています：' + others.join('、') + '</p>' : '');
  }
  function rebuildClueList() {
    var p = document.getElementById('cluePanel'); if (p) p.innerHTML = clueListHtml();
  }
  function xwGridHtml() {
    var h = '';
    for (var r = 0; r < XW.R; r++) for (var c = 0; c < XW.C; c++) {
      if (XW.black[r][c]) { h += '<div class="cell b"></div>'; continue; }
      var k = key(r, c), mk = XW.markers[k], no = XW.startNo[k];
      h += '<div class="cell w' + (mk ? ' has-mk' : '') + '" data-r="' + r + '" data-c="' + c + '">' +
        (no ? '<span class="no">' + no + '</span>' : '') + '<span class="ch"></span>' +
        (mk ? '<span class="mk" aria-label="答えのマス ' + esc(mk) + '">' + esc(mk) + '</span>' : '') + '</div>';
    }
    return h;
  }
  function xwBind() {
    var el = xwInputEl(); if (!el) return;
    el.value = SENT;
    el.addEventListener('compositionstart', function () { XW.composing = true; });
    el.addEventListener('compositionend', function () { XW.composing = false; xwFlush(); });
    el.addEventListener('input', function (e) {
      if (!canEdit()) { xwResetInput(); return; }
      var v = el.value;
      if (v.indexOf(SENT) !== 0 && !XW.composing && !e.isComposing) { xwResetInput(); xwBackspace(false); return; }
      if (XW.composing || e.isComposing) {
        XW.preview = buildPreview(kanaChars(v.replace(/\u200b/g, ''))); xwRefresh(); return;
      }
      xwFlush();
    });
    el.addEventListener('keydown', function (e) {
      if (e.isComposing || e.keyCode === 229) return;
      var k = e.key;
      if (k === 'Backspace') { e.preventDefault(); xwBackspace(false); }
      else if (k === 'Delete') { e.preventDefault(); xwBackspace(true); }
      else if (k === 'ArrowLeft') { e.preventDefault(); xwArrow(0, -1); }
      else if (k === 'ArrowRight') { e.preventDefault(); xwArrow(0, 1); }
      else if (k === 'ArrowUp') { e.preventDefault(); xwArrow(-1, 0); }
      else if (k === 'ArrowDown') { e.preventDefault(); xwArrow(1, 0); }
      else if (k === 'Enter') { e.preventDefault(); }
    });
    if (window.visualViewport) window.visualViewport.addEventListener('resize', function () {
      if (document.activeElement === el) xwKeepVisible();
    });
  }

  /* =====================================================================
     画面の描画
     ===================================================================== */
  function render() {
    if (ui.screen === 'title') renderTitle();
    else if (ui.screen === 'setup') renderSetup();
    else if (ui.screen === 'review') renderReview();
    else renderGame();
  }

  function renderTitle() {
    var warns = (DEBUG && (XW.warnings.length || !storageOK))
      ? '<div class="warnbox"><b>設定チェック</b><br>' + XW.warnings.map(esc).join('<br>') + (storageOK ? '' : '<br>端末内保存が使えません') + '</div>' : '';
    appEl.innerHTML = '<main class="wrap title">' +
      '<h1 class="big-title">' + esc(CFG.title) + '</h1>' +
      (CFG.subtitle ? '<p class="sub">' + esc(CFG.subtitle) + '</p>' : '') +
      '<p class="lead">' + esc((CFG.titleScreen && CFG.titleScreen.lead) || '') + '</p>' +
      '<section class="card qr-card"><h2>参加用QRコード</h2>' + qrBlock() + '</section>' +
      '<button type="button" class="btn primary big" data-act="to-setup">' + esc((CFG.titleScreen && CFG.titleScreen.startLabel) || 'ゲーム開始画面へ') + '</button>' +
      '<div class="sig" aria-hidden="true"><i></i><i></i><i></i></div>' + warns + '</main>';
    window.scrollTo(0, 0);
  }

  function renderSetup() {
    var mins = minutesOverride || (CFG.timer && CFG.timer.limitMinutes) || 20;
    appEl.innerHTML = '<main class="wrap"><div class="col"><section class="card"><h2>参加者情報の入力</h2>' +
      '<p>あなたのテーブル番号と座席番号を入力してください。</p>' +
      '<form id="setupForm" novalidate>' +
      '<label class="fld">テーブル番号<input name="table" type="text" inputmode="numeric" pattern="[0-9]*" autocomplete="off" value="' + esc(state.table || '') + '"></label>' +
      '<label class="fld">座席番号<input name="seat" type="text" inputmode="numeric" pattern="[0-9]*" autocomplete="off" value="' + esc(state.seat || '') + '"></label>' +
      '<p class="err" id="setupErr" role="alert"></p>' +
      '<p class="note">「ゲームスタート」を押すと、制限時間' + esc(mins) + '分のカウントダウンが始まります。</p>' +
      '<div class="btn-row"><button type="button" class="btn ghost" data-act="back-title">戻る</button>' +
      '<button type="submit" class="btn primary">ゲームスタート</button></div></form></section></div></main>';
    window.scrollTo(0, 0);
  }

  function renderHeader() {
    var label = ui.screen === 'review' ? '振り返り' : labelOf(state.view);
    return '<header class="app-header"><div class="hd">' +
      '<div class="hd-title"><i></i><i></i><i></i>' + esc(CFG.title) + '</div>' +
      '<button type="button" class="hd-gear" data-act="open-menu" aria-label="設定メニューを開く"><span aria-hidden="true">⚙</span> 設定</button>' +
      '<div class="hd-q" id="hdQ">' + esc(label) + '</div>' +
      '<div class="hd-timer" id="timer" role="timer"><span class="lab">残り</span><span id="timeText">--:--</span></div>' +
      '</div></header>';
  }
  function renderTabs() {
    return '<nav class="qtabs" aria-label="問題の切り替え">' + QORDER.map(function (id) {
      var done = !!state.solved[id], open = isUnlocked(id), cur = ui.screen === 'game' && state.view === id;
      return '<button type="button" class="tab' + (cur ? ' cur' : '') + (done ? ' done' : '') + '" data-act="goto" data-q="' + id + '"' +
        (open ? '' : ' disabled') + (cur ? ' aria-current="page"' : '') + '>' + (done ? '✓ ' : (open ? '' : '🔒 ')) + esc(labelOf(id)) + '</button>';
    }).join('') + '<button type="button" class="tab' + (ui.screen === 'review' ? ' cur' : '') + '" data-act="review">📖 振り返り</button></nav>';
  }
  function frame(body) {
    return renderHeader() + renderTabs() +
      (isTimeUp() ? '<div class="banner" role="alert">⏰ ' + esc(MSG.timeUp) + '（振り返りは見られます）</div>' : '') +
      '<main class="wrap">' + body + '</main>';
  }
  function unsetNotice() { return '<p class="notice">' + esc(MSG.unset) + '</p>'; }
  function qHead(id) { return '<h2 class="qh"><span class="qn">' + esc(labelOf(id)) + '</span></h2>'; }

  function answerForm(id) {
    var q = Q(id);
    if (!q.answers || !q.answers.length) return unsetNotice();
    if (state.solved[id]) {
      var next = nextOf(id);
      return '<div class="success" role="status"><p class="ok-title">✓ ' + esc(MSG.correct) + '</p>' +
        (id === 'final' ? '<p>' + esc(q.clearMessage || 'クリアです！') + '</p>' : '') +
        '<div class="btn-row">' + (next ? '<button type="button" class="btn primary" data-act="next">次の問題へ ▶</button>' : '') +
        '<button type="button" class="btn" data-act="review-q" data-q="' + id + '">📖 振り返りを見る</button></div></div>';
    }
    var m = ui.msg[id], dis = isTimeUp() ? ' disabled' : '';
    return '<form class="ans" data-form="' + id + '" autocomplete="off" novalidate>' +
      '<label class="lbl" for="ans-' + id + '">こたえ</label><div class="ans-row">' +
      '<input id="ans-' + id + '" type="text" enterkeyhint="send" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" lang="ja" value="' + esc(state.drafts[id] || '') + '"' + dis + '>' +
      '<button type="submit" class="btn primary"' + dis + '>回答する</button></div>' +
      '<div class="msg' + (m ? ' ' + m.t : '') + '" role="status" aria-live="polite">' + (m ? (m.t === 'ng' ? '✕ ' : '') + esc(m.s) : '') + '</div></form>';
  }

  function bodyQ1() {
    var q = Q('q1');
    if (!q.text && !q.image) return '<div class="col"><section class="card">' + qHead('q1') + unsetNotice() + '</section></div>';
    var hint = q1Hint(), h = q.hint || {};
    var img = q.image ? '<figure class="qimg"><img src="' + esc(q.image) + '" alt="' + esc(q.imageAlt || '問題画像') + '" data-fallback="1"></figure>'
      : '<figure class="qimg"><div class="noimg">問題画像が未設定です</div></figure>';
    return '<div class="col"><section class="card">' + qHead('q1') + img +
      (q.text ? '<p class="qtext">' + nl(q.text) + '</p>' : '') +
      (hint ? '<div class="hintbox"><b>' + esc(h.title || 'ヒント') + '（' + (h.basedOn === 'table' ? 'テーブル' : '座席') + ' ' + esc(h.basedOn === 'table' ? tableShown() : state.seat) + '番）</b><p>' + nl(hint) + '</p></div>' : '') +
      answerForm('q1') + '</section></div>';
  }
  function bodyQ2() {
    var q = Q('q2');
    if (!q.text) return '<div class="col"><section class="card">' + qHead('q2') + unsetNotice() + '</section></div>';
    var t = q2Testimonies();
    return '<div class="col"><section class="card">' + qHead('q2') + '<p class="qtext">' + nl(q.text) + '</p>' +
      (t.length ? '<ul class="testi">' + t.map(function (x) {
        return '<li><span class="who">' + esc(x.speaker) + 'の証言</span><p>「' + esc(x.text) + '」</p></li>';
      }).join('') + '</ul>' : '') + answerForm('q2') + '</section></div>';
  }
  function bodyQ3() {
    var q = Q('q3');
    if (!XW.ok) return '<div class="col"><section class="card">' + qHead('q3') + unsetNotice() + '</section></div>';
    return '<div class="q3-layout">' +
      '<section class="card xw-panel" id="xwPanel">' + qHead('q3') +
      (q.text ? '<p class="qtext">' + nl(q.text) + '</p>' : '') +
      '<div class="xw-active" id="xwActive" aria-live="polite"></div>' +
      '<div class="xw-ctrl"><button type="button" class="btn" data-act="xw-prev">◀ 前の鍵</button>' +
      '<button type="button" class="btn" data-act="xw-next">次の鍵 ▶</button>' +
      '<button type="button" class="btn" data-act="xw-del">⌫ 消す</button></div>' +
      '<div class="xw-wrap"><input id="xwInput" class="xw-input" type="text" inputmode="text" lang="ja" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" enterkeyhint="done" aria-label="クロスワードの入力欄"' + (canEdit() ? '' : ' disabled') + '>' +
      '<div class="xw" id="xw" role="group" aria-label="9×9クロスワード">' + xwGridHtml() + '</div></div>' +
      '<p class="xw-help">数字のマスをタップすると、その番号の鍵の向き（縦または横）で入力できます。ひらがなで入力してください。</p></section>' +
      '<section class="card clue-panel" id="cluePanel">' + clueListHtml() + '</section>' +
      '<section class="card ans-panel"><h2>こたえ</h2>' + answerForm('q3') + '</section></div>';
  }
  function bodyFinal() {
    var q = Q('final');
    if (!q.text) return '<div class="col"><section class="card">' + qHead('final') + unsetNotice() + '</section></div>';
    return '<div class="col"><section class="card">' + qHead('final') + '<p class="qtext">' + nl(q.text) + '</p>' +
      '<button type="button" class="btn" data-act="review">📖 振り返りを見る</button>' + answerForm('final') + '</section></div>';
  }

  function renderGame() {
    ui.screen = 'game';
    if (QORDER.indexOf(state.view) < 0 || !isUnlocked(state.view)) state.view = firstUnsolved();
    var body = state.view === 'q1' ? bodyQ1() : state.view === 'q2' ? bodyQ2() : state.view === 'q3' ? bodyQ3() : bodyFinal();
    appEl.innerHTML = frame(body);
    afterRender();
  }
  function afterRender() {
    $$('img[data-fallback]').forEach(function (img) {
      function fb() {
        var d = document.createElement('div'); d.className = 'noimg';
        d.textContent = '問題画像が未設定です（' + (img.getAttribute('src') || '') + ' を配置してください）';
        if (img.parentNode) img.parentNode.replaceChild(d, img);
      }
      img.addEventListener('error', fb);
      if (img.complete && img.naturalWidth === 0) fb();
    });
    if (state.view === 'q3' && ui.screen === 'game' && XW.ok) {
      if (!XW.sel) xwDefaultSel();
      xwBind(); xwRefresh();
    }
    updateTimerUI();
  }

  /* ---- 振り返り ---- */
  function tileHtml(t) {
    var col = t.color && CFG.colors && CFG.colors[t.color];
    if (!col) return '<div class="tile-wrap"><div class="tile"><span class="tch">' + esc(t.char) + '</span></div><div class="tile-cap">&nbsp;</div></div>';
    var bg;
    if (Array.isArray(t.shape) && t.shape.length) {
      var rows = t.shape.length, cols = t.shape[0].length;
      bg = '<div class="shape" aria-hidden="true" style="grid-template-columns:repeat(' + cols + ',1fr);grid-template-rows:repeat(' + rows + ',1fr)">' +
        t.shape.reduce(function (a, r) { return a.concat(r); }, []).map(function (v) {
          return '<i class="' + (v ? 'on' : 'off') + '"' + (v ? ' style="background:' + esc(col.css) + '"' : '') + '></i>';
        }).join('') + '</div>';
    } else bg = '<div class="fill" aria-hidden="true" style="background:' + esc(col.css) + '"></div>';
    return '<div class="tile-wrap"><div class="tile" role="img" aria-label="' + esc(t.char + '（' + col.label + '色の背景）') + '">' + bg +
      '<span class="tch">' + esc(t.char) + '</span></div><div class="tile-cap" style="background:' + esc(col.css) + '">' + esc(col.label) + '</div></div>';
  }
  function renderReview() {
    ui.screen = 'review';
    var cards = QORDER.map(function (id) {
      var q = Q(id), id2 = 'rv-' + id;
      if (!state.solved[id]) return '<section class="card locked-card" id="' + id2 + '"><h2>' + esc(labelOf(id)) + '</h2><p>まだ正解していません。</p></section>';
      state.reviewViewed[id] = true;
      var tiles = (q.review && q.review.tiles) || [];
      var colored = tiles.filter(function (t) { return t.color && CFG.colors && CFG.colors[t.color]; });
      return '<section class="card" id="' + id2 + '"><h2>' + esc(labelOf(id)) + 'の答え</h2>' +
        (tiles.length ? '<div class="rv-tiles">' + tiles.map(tileHtml).join('') + '</div>' : '<p class="notice">' + esc(MSG.unset) + '</p>') +
        (colored.length ? '<ul class="legend">' + colored.map(function (t) { return '<li>色付きの文字：' + esc(t.char) + '（' + esc(CFG.colors[t.color].label) + '）</li>'; }).join('') + '</ul>' : '') +
        (q.review && q.review.note ? '<p>' + nl(q.review.note) + '</p>' : '') + '</section>';
    }).join('');
    saveState();
    appEl.innerHTML = frame('<div class="col">' + cards +
      '<button type="button" class="btn primary big" data-act="back-game">問題に戻る</button></div>');
    updateTimerUI();
    if (ui.reviewFocus) {
      var t = document.getElementById('rv-' + ui.reviewFocus);
      if (t) t.scrollIntoView({ block: 'start' });
      ui.reviewFocus = null;
    } else window.scrollTo(0, 0);
  }

  /* ---- オーバーレイ（メニュー・QR拡大） ---- */
  var lastFocus = null;
  function openOverlay(kind) { lastFocus = document.activeElement; ui.overlay = kind; renderOverlay(); }
  function closeOverlay() {
    ui.overlay = null; renderOverlay();
    if (lastFocus && lastFocus.focus && document.body.contains(lastFocus)) { try { lastFocus.focus({ preventScroll: true }); } catch (e) { /* 無視 */ } }
  }
  function menuHtml() {
    return '<div class="ov-bg" data-act="close-overlay"></div><div class="sheet" role="dialog" aria-modal="true" aria-labelledby="menuTitle">' +
      '<div class="sheet-head"><h2 id="menuTitle">設定メニュー</h2><button type="button" class="btn ghost" data-act="close-overlay">✕ 閉じる</button></div>' +
      '<form id="numForm" novalidate>' +
      '<label class="fld">テーブル番号<div class="stepper"><button type="button" class="btn" data-act="step" data-f="mTable" data-d="-1" aria-label="テーブル番号を1減らす">−</button>' +
      '<input id="mTable" type="text" inputmode="numeric" pattern="[0-9]*" autocomplete="off" value="' + esc(tableShown()) + '">' +
      '<button type="button" class="btn" data-act="step" data-f="mTable" data-d="1" aria-label="テーブル番号を1増やす">＋</button></div></label>' +
      '<label class="fld">座席番号<div class="stepper"><button type="button" class="btn" data-act="step" data-f="mSeat" data-d="-1" aria-label="座席番号を1減らす">−</button>' +
      '<input id="mSeat" type="text" inputmode="numeric" pattern="[0-9]*" autocomplete="off" value="' + esc(state.seat) + '">' +
      '<button type="button" class="btn" data-act="step" data-f="mSeat" data-d="1" aria-label="座席番号を1増やす">＋</button></div></label>' +
      '<p class="err" id="mErr" role="alert"></p>' +
      '<button type="submit" class="btn primary big">番号を保存して問題に戻る</button></form>' +
      '<button type="button" class="btn big" data-act="open-qr">QRコードを拡大表示</button>' +
      '<button type="button" class="btn ghost big" data-act="close-overlay">メニューを閉じる</button>' +
      '<button type="button" class="btn big danger" data-act="reset-all">リセット（タイマー・進行状況をすべて消去）</button></div>';
  }
  function qrZoomHtml() {
    var url = getJoinUrl(), svg = qrSvg(url);
    return '<div class="qr-zoom" role="dialog" aria-modal="true" aria-label="QRコード拡大表示">' +
      (svg ? '<div class="qr-zoom-box">' + svg + '</div>' : '<p class="qr-fail">QRコードを表示できませんでした。下のURLを直接開いてください。</p>') +
      '<p class="qr-url">' + esc(url) + '</p><button type="button" class="btn primary" data-act="close-overlay">元の画面に戻る</button></div>';
  }
  function renderOverlay() {
    if (!ui.overlay) { overlayEl.hidden = true; overlayEl.innerHTML = ''; document.body.classList.remove('no-scroll'); return; }
    overlayEl.hidden = false; document.body.classList.add('no-scroll');
    overlayEl.innerHTML = ui.overlay === 'menu' ? menuHtml() : qrZoomHtml();
    var f = $('button, input', overlayEl);
    if (f) f.focus();
  }

  /* =====================================================================
     操作の処理
     ===================================================================== */
  // タイマー・番号・回答・クロスワードの入力をすべて消してタイトル画面に戻る
  function resetAll() {
    if (!window.confirm('タイマーと進行状況をすべて消去して、最初からやり直します。よろしいですか？')) return;
    try { localStorage.removeItem(STORE_KEY); } catch (e) { /* 無視 */ }
    state = defaultState();
    ui.msg = {}; ui.reviewFocus = null; ui.timeUpHandled = false;
    XW.sel = null; XW.preview = null; XW.composing = false;
    lastFocus = null; closeOverlay();
    ui.screen = 'title'; render(); toast('リセットしました');
  }
  function go(view) {
    state.view = view; saveState(); ui.screen = 'game'; render(); window.scrollTo(0, 0);
  }
  function submitAnswer(id, input) {
    if (state.solved[id]) return;
    if (isTimeUp()) { ui.msg[id] = { t: 'ng', s: MSG.timeUp }; render(); return; }
    if (!String(input).trim()) { ui.msg[id] = { t: 'ng', s: MSG.empty }; render(); return; }
    state.drafts[id] = input;
    if (isCorrect(id, input)) {
      state.solved[id] = true; delete state.drafts[id]; ui.msg[id] = null;
      if (id === 'final') state.finishedAt = Date.now();
      saveState(); render(); toast(MSG.correct);
    } else {
      ui.msg[id] = { t: 'ng', s: MSG.wrong }; saveState(); render();
      var inp = document.getElementById('ans-' + id); if (inp) inp.focus();
    }
  }

  document.addEventListener('click', function (e) {
    var cell = e.target.closest && e.target.closest('.cell.w');
    if (cell && ui.screen === 'game') { xwSelect(Number(cell.dataset.r), Number(cell.dataset.c), true); xwFocus(true); return; }
    var el = e.target.closest && e.target.closest('[data-act]');
    if (!el) return;
    var act = el.dataset.act;
    switch (act) {
      case 'to-setup': ui.screen = 'setup'; render(); break;
      case 'back-title': ui.screen = 'title'; render(); break;
      case 'goto': if (isUnlocked(el.dataset.q)) go(el.dataset.q); break;
      case 'next': { var n = nextOf(state.view); if (n) go(n); break; }
      case 'review': renderReview(); break;
      case 'review-q': ui.reviewFocus = el.dataset.q; renderReview(); break;
      case 'back-game': ui.screen = 'game'; render(); window.scrollTo(0, 0); break;
      case 'open-menu': openOverlay('menu'); break;
      case 'close-overlay': closeOverlay(); break;
      case 'open-qr': ui.overlay = 'qr'; renderOverlay(); break;
      case 'reset-all': resetAll(); break;
      case 'step': {
        var inp = document.getElementById(el.dataset.f), cur = parsePosInt(inp.value, 1e9) || 1;
        var stepMax = el.dataset.f === 'mTable' ? limits().tableMax : limits().seatMax;
        inp.value = Math.min(stepMax, Math.max(1, cur + Number(el.dataset.d))); break;
      }
      case 'pick-clue': xwPickClue(Number(el.dataset.no)); break;
      case 'xw-prev': if (XW.ok) { xwStepClue(-1); xwFocus(false); } break;
      case 'xw-next': if (XW.ok) { xwStepClue(1); xwFocus(false); } break;
      case 'xw-del': xwBackspace(false); xwFocus(false); break;
    }
  });

  document.addEventListener('submit', function (e) {
    var f = e.target;
    e.preventDefault();
    if (f.id === 'setupForm') {
      var L = limits(), t = parseTable(f.elements.table.value, L.tableMax), s = parsePosInt(f.elements.seat.value, L.seatMax);
      var err = document.getElementById('setupErr');
      if (t == null || !s) {
        err.textContent = '番号は1以上の整数で入力してください（テーブル1〜' + L.tableMax + '、座席1〜' + L.seatMax + '）。'; return;
      }
      state.table = t; state.seat = s;
      if (!state.startedAt) {
        state.startedAt = Date.now();
        state.limitSec = Math.round((minutesOverride || (CFG.timer && CFG.timer.limitMinutes) || 20) * 60);
      }
      saveState(); ui.screen = 'game'; render(); window.scrollTo(0, 0);
    } else if (f.id === 'numForm') {
      var L2 = limits(), tv = $('#mTable').value, s2 = parsePosInt($('#mSeat').value, L2.seatMax);
      // テーブル0は欄に表示しないため、空欄のまま保存したら0を維持する
      var t2 = (state.table === 0 && !String(tv).trim()) ? 0 : parseTable(tv, L2.tableMax);
      if (t2 == null || !s2) { $('#mErr').textContent = '番号は1以上の整数で入力してください（テーブル1〜' + L2.tableMax + '、座席1〜' + L2.seatMax + '）。'; return; }
      state.table = t2; state.seat = s2; saveState();
      closeOverlay(); render(); toast('番号を更新しました');
    } else if (f.dataset && f.dataset.form) {
      submitAnswer(f.dataset.form, $('input', f).value);
    }
  });

  document.addEventListener('input', function (e) {
    var f = e.target.closest && e.target.closest('form[data-form]');
    if (f && e.target.matches('input')) { state.drafts[f.dataset.form] = e.target.value; saveState(); }
  });

  document.addEventListener('keydown', function (e) {
    if (!ui.overlay) return;
    if (e.key === 'Escape') { closeOverlay(); return; }
    if (e.key === 'Tab') {
      var items = $$('button, input', overlayEl).filter(function (x) { return !x.disabled; });
      if (!items.length) return;
      var first = items[0], last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  });

  /* ---------- 1秒ごとの更新 ---------- */
  function tick() {
    updateTimerUI();
    if (!state.startedAt || state.finishedAt) return;
    autoRevealTick();
    if (!ui.timeUpHandled && remainingMs() <= 0) {
      ui.timeUpHandled = true;
      if (ui.screen === 'game') render();
      toast('制限時間が終了しました');
    }
  }
  setInterval(tick, 250);
  document.addEventListener('visibilitychange', tick);

  /* ---------- 起動 ---------- */
  xwInit();
  if (state.startedAt && hasNumbers()) {
    ui.screen = 'game';
    if (isTimeUp()) ui.timeUpHandled = true;
  } else if (state.table != null || state.seat != null) ui.screen = 'setup';
  else ui.screen = 'title';
  if (!storageOK && ui.screen !== 'title') toast('端末内保存が使えないため、再読み込みで進行が消えます');
  render();
  if (state.startedAt) autoRevealTick();
})();
