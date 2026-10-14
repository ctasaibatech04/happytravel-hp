// お店の人向け：予約一覧ページ（/admin）
// happytravel_reservations の予約を新しい順に表示し、状態の変更と予約内容の編集ができる

// お客様の個人情報を出すページなので、
// .env に ADMIN_PASSWORD があればパスワード（ユーザー名は admin）を求め、
// 無ければこのパソコン自身（localhost）からのアクセスだけを許可する
function requireAdmin(req, res, next) {
  const password = process.env.ADMIN_PASSWORD;

  if (!password) {
    const ip = req.socket.remoteAddress || '';
    if (ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1') return next();
    return res.status(403).send('このページはお店のパソコンからのみ開けます。');
  }

  const [scheme, encoded] = (req.headers.authorization || '').split(' ');
  if (scheme === 'Basic' && encoded) {
    const [user, pass] = Buffer.from(encoded, 'base64').toString().split(/:(.*)/s);
    if (user === 'admin' && pass === password) return next();
  }
  res.set('WWW-Authenticate', 'Basic realm="HappyTravel Admin", charset="UTF-8"');
  res.status(401).send('パスワードが必要です。');
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

// DBの「2026-09-15」を「2026年9月15日」に戻す
function toJapaneseDate(isoDate) {
  const m = String(isoDate).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return isoDate;
  return `${m[1]}年${Number(m[2])}月${Number(m[3])}日`;
}

// 受付日時を日本時間で「2026/09/30 14:05」のように表示する
function toJapanTime(timestamp) {
  return new Date(timestamp).toLocaleString('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit'
  });
}

// 管理ページで選べる予約の状態
const STATUSES = ['未確認', '確認済み', 'キャンセル'];

// お店のご予約フォーム（contact.html）と同じ旅行プラン
const PLANS = ['ご家族向けツアー', 'ご年配向けツアー', '海外旅行', '国内旅行', '割安航空券', 'その他のご相談'];

const ROW_COLUMNS = 'id, name, phone, people, plan, date, status, created_at';
const EDIT_COLUMNS = 'id, name, phone, people, plan, date, message';

// 状態ごとに行の色を変えるためのクラス名
function statusClass(status) {
  return { '未確認': 'is-new', '確認済み': 'is-confirmed', 'キャンセル': 'is-cancelled' }[status] || '';
}

// 編集画面から届いた内容を確かめて、DBに入れる形に整える
function validateReservation(body) {
  const name = String(body.name ?? '').trim();
  const phone = String(body.phone ?? '').trim();
  const people = Number(body.people);
  const plan = String(body.plan ?? '').trim();
  const date = String(body.date ?? '').trim();
  const message = String(body.message ?? '').trim();

  if (!name || name.length > 100) return { error: 'お名前を100文字以内で入力してください。' };
  if (!phone || phone.length > 30) return { error: 'お電話番号を30文字以内で入力してください。' };
  if (!Number.isInteger(people) || people < 1 || people > 99) return { error: '人数は1〜99の数字で入力してください。' };
  if (!plan || plan.length > 100) return { error: '旅行プランを選んでください。' };
  const d = new Date(date + 'T00:00:00Z');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || isNaN(d) || d.toISOString().slice(0, 10) !== date) {
    return { error: 'ご希望日を正しく入力してください。' };
  }
  if (message.length > 2000) return { error: 'ご相談内容は2000文字以内で入力してください。' };

  return { value: { name, phone, people, plan, date, message: message || null } };
}

function renderRow(r) {
  return `
          <tr class="${statusClass(r.status)}" data-id="${escapeHtml(r.id)}">
            <td data-label="受付日時">${escapeHtml(toJapanTime(r.created_at))}</td>
            <td data-label="お名前">${escapeHtml(r.name)} 様</td>
            <td data-label="お電話番号"><a href="tel:${escapeHtml(r.phone)}">${escapeHtml(r.phone)}</a></td>
            <td data-label="人数">${escapeHtml(r.people)}名</td>
            <td data-label="旅行プラン">${escapeHtml(r.plan)}</td>
            <td data-label="ご希望日">${escapeHtml(toJapaneseDate(r.date))}</td>
            <td data-label="状態" class="status-cell">
              <select class="status-select" data-current="${escapeHtml(r.status)}" aria-label="${escapeHtml(r.name)} 様の状態">
                ${STATUSES.includes(r.status) ? '' : `<option selected disabled>${escapeHtml(r.status || '（なし）')}</option>`}
                ${STATUSES.map((s) => `<option value="${s}"${s === r.status ? ' selected' : ''}>${s}</option>`).join('')}
              </select>
              <span class="status-msg" role="status"></span>
            </td>
            <td class="edit-cell">
              <button type="button" class="edit-btn" aria-label="${escapeHtml(r.name)} 様の予約を編集">編集</button>
            </td>
          </tr>`;
}

function renderPage(rows, errorMessage) {
  let body;
  if (errorMessage) {
    body = `<p class="notice notice-error">${escapeHtml(errorMessage)}</p>`;
  } else if (rows.length === 0) {
    body = '<p class="notice">まだご予約はありません。</p>';
  } else {
    body = `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>受付日時</th>
            <th>お名前</th>
            <th>お電話番号</th>
            <th>人数</th>
            <th>旅行プラン</th>
            <th>ご希望日</th>
            <th>状態</th>
            <th><span class="visually-hidden">操作</span></th>
          </tr>
        </thead>
        <tbody>
          ${rows.map(renderRow).join('')}
        </tbody>
      </table>
    </div>`;
  }

  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>予約一覧｜ハッピートラベル 管理</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=M+PLUS+Rounded+1c:wght@400;500;700&display=swap" rel="stylesheet">
<style>
  :root {
    --blue-navy: #0D3247;
    --blue-mid: #1B6E96;
    --blue-pale: #EAF7FC;
    --text-main: #253746;
    --text-sub: #4B5E6D;
    --line: #D5E6EE;
    --error: #B3261E;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    background: #F6FAFC;
    color: var(--text-main);
    font-family: 'M PLUS Rounded 1c', 'Hiragino Maru Gothic ProN', 'Yu Gothic', sans-serif;
  }
  .visually-hidden {
    position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap;
  }
  header {
    background: var(--blue-navy);
    color: #fff;
    padding: 1rem 16px;
  }
  header h1 { margin: 0; font-size: 1.2rem; }
  main { max-width: 1100px; margin: 0 auto; padding: 1.5rem 16px 3rem; }
  .summary {
    display: flex; justify-content: space-between; align-items: center;
    gap: 1rem; flex-wrap: wrap; margin-bottom: 1rem; color: var(--text-sub);
  }
  .summary strong { color: var(--text-main); font-size: 1.1rem; }
  .reload, .edit-btn, .btn-sub {
    border: 1px solid var(--blue-mid); color: var(--blue-mid); background: #fff;
    border-radius: 999px; padding: .4rem 1.1rem; font: inherit; cursor: pointer;
  }
  .reload:hover, .edit-btn:hover, .btn-sub:hover { background: var(--blue-pale); }
  .edit-btn { font-size: .85rem; padding: .3rem .9rem; }
  .table-wrap {
    background: #fff; border-radius: 12px; overflow-x: auto;
    box-shadow: 0 6px 20px rgba(22, 74, 102, 0.08);
  }
  table { width: 100%; border-collapse: collapse; }
  th, td { padding: .8rem 1rem; text-align: left; border-bottom: 1px solid var(--line); white-space: nowrap; }
  th { background: var(--blue-pale); color: var(--blue-navy); font-size: .9rem; }
  tbody tr:last-child td { border-bottom: none; }
  tbody tr:hover { background: #FAFDFE; }
  tbody tr.is-saved { animation: saved 1.6s ease-out; }
  @keyframes saved { from { background: #FFF4C2; } to { background: transparent; } }
  td a { color: var(--blue-mid); }
  .notice { background: #fff; border-radius: 12px; padding: 2rem; text-align: center; color: var(--text-sub); }
  .notice-error { color: var(--error); }

  .status-select {
    font: inherit; font-size: .9rem; padding: .3rem .5rem;
    border: 1px solid var(--line); border-radius: 8px; background: #fff; cursor: pointer;
  }
  .status-select:disabled { opacity: .6; cursor: wait; }
  .status-msg { margin-left: .4rem; font-size: .8rem; color: var(--text-sub); }
  .status-msg.is-error { color: var(--error); }
  tr.is-new .status-select { border-color: #FF9A44; background: #FFF4EA; }
  tr.is-confirmed .status-select { border-color: #3A9A5B; background: #EDF8F0; }
  tr.is-cancelled td { color: #9AA8B2; }
  tr.is-cancelled td:not(.status-cell):not(.edit-cell) { text-decoration: line-through; }
  tr.is-cancelled .status-select { color: var(--text-sub); background: #F1F3F5; }

  /* 編集画面 */
  dialog {
    width: min(520px, calc(100% - 32px)); max-height: calc(100% - 32px);
    border: none; border-radius: 16px; padding: 1.5rem;
    color: var(--text-main); box-shadow: 0 16px 40px rgba(13, 50, 71, 0.25);
  }
  dialog::backdrop { background: rgba(13, 50, 71, 0.45); }
  dialog h2 { margin: 0 0 1rem; font-size: 1.1rem; color: var(--blue-navy); }
  .field { margin-bottom: .9rem; }
  .field label { display: block; font-size: .85rem; color: var(--text-sub); margin-bottom: .3rem; }
  .field input, .field select, .field textarea {
    width: 100%; font: inherit; padding: .5rem .7rem;
    border: 1px solid var(--line); border-radius: 8px; background: #fff; color: var(--text-main);
  }
  .field textarea { min-height: 6rem; resize: vertical; }
  .field input:focus, .field select:focus, .field textarea:focus { outline: 2px solid var(--blue-mid); outline-offset: 0; }
  .form-error { color: var(--error); font-size: .9rem; min-height: 1.2em; margin: .2rem 0 .8rem; }
  .form-actions { display: flex; justify-content: flex-end; gap: .6rem; }
  .btn-main {
    border: none; background: var(--blue-mid); color: #fff;
    border-radius: 999px; padding: .5rem 1.4rem; font: inherit; font-weight: 700; cursor: pointer;
  }
  .btn-main:hover { background: var(--blue-navy); }
  .btn-main:disabled { opacity: .6; cursor: wait; }

  @media (max-width: 700px) {
    table, thead, tbody, tr, td { display: block; }
    thead { display: none; }
    tbody tr { padding: .6rem 0; border-bottom: 1px solid var(--line); }
    td { border: none; padding: .25rem 1rem; white-space: normal; }
    td[data-label]::before {
      content: attr(data-label); display: inline-block; width: 6.5em;
      color: var(--text-sub); font-size: .85rem;
    }
    .edit-cell { padding-top: .5rem; }
  }
</style>
</head>
<body>
<header><h1>ハッピートラベル　予約一覧</h1></header>
<main>
  <div class="summary">
    <span>新しい順に表示しています。${errorMessage ? '' : `全 <strong>${rows.length}</strong> 件`}</span>
    <button class="reload" onclick="location.reload()">最新の情報にする</button>
  </div>
  ${body}
</main>

<dialog id="editDialog" aria-labelledby="editTitle">
  <form id="editForm" novalidate>
    <h2 id="editTitle">予約内容の編集</h2>
    <div class="field">
      <label for="f-name">お名前</label>
      <input type="text" id="f-name" name="name" maxlength="100" required>
    </div>
    <div class="field">
      <label for="f-phone">お電話番号</label>
      <input type="tel" id="f-phone" name="phone" maxlength="30" required>
    </div>
    <div class="field">
      <label for="f-people">人数</label>
      <select id="f-people" name="people" required></select>
    </div>
    <div class="field">
      <label for="f-plan">旅行プラン</label>
      <select id="f-plan" name="plan" required></select>
    </div>
    <div class="field">
      <label for="f-date">ご希望日</label>
      <input type="date" id="f-date" name="date" required>
    </div>
    <div class="field">
      <label for="f-message">ご相談内容</label>
      <textarea id="f-message" name="message" maxlength="2000"></textarea>
    </div>
    <p class="form-error" id="formError" role="alert"></p>
    <div class="form-actions">
      <button type="button" class="btn-sub" id="cancelEdit">やめる</button>
      <button type="submit" class="btn-main" id="saveEdit">保存する</button>
    </div>
  </form>
</dialog>

<script>
  const PLANS = ${JSON.stringify(PLANS)};

  // 保存が終わったら、サーバーから届いた新しい行に差し替える
  function replaceRow(oldRow, html) {
    const tbody = document.createElement('tbody');
    tbody.innerHTML = html.trim();
    const newRow = tbody.firstElementChild;
    oldRow.replaceWith(newRow);
    newRow.classList.add('is-saved');
    return newRow;
  }

  async function postJson(url, data) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    const result = await res.json().catch(() => ({}));
    if (!res.ok || !result.ok) throw new Error(result.error || '保存できませんでした。');
    return result;
  }

  // ---- 状態の変更 ----
  document.addEventListener('change', async (e) => {
    const select = e.target.closest('.status-select');
    if (!select) return;
    const row = select.closest('tr');
    const msg = row.querySelector('.status-msg');

    select.disabled = true;
    msg.className = 'status-msg';
    msg.textContent = '保存中…';

    try {
      const result = await postJson('/admin/reservations/' + encodeURIComponent(row.dataset.id) + '/status', { status: select.value });
      const newMsg = replaceRow(row, result.html).querySelector('.status-msg');
      newMsg.textContent = '保存しました';
      setTimeout(() => { newMsg.textContent = ''; }, 2000);
    } catch (err) {
      // 失敗したら元の状態に戻す
      select.value = select.dataset.current;
      select.disabled = false;
      msg.className = 'status-msg is-error';
      msg.textContent = err.message;
    }
  });

  // ---- 予約内容の編集 ----
  const dialog = document.getElementById('editDialog');
  const form = document.getElementById('editForm');
  const formError = document.getElementById('formError');
  const saveButton = document.getElementById('saveEdit');
  let editingRow = null;

  function fillOptions(select, values, current, label) {
    select.innerHTML = '';
    if (current != null && current !== '' && !values.map(String).includes(String(current))) {
      values = [current].concat(values);
    }
    values.forEach((v) => {
      const opt = document.createElement('option');
      opt.value = v;
      opt.textContent = label(v);
      select.appendChild(opt);
    });
    select.value = current;
  }

  document.addEventListener('click', async (e) => {
    const button = e.target.closest('.edit-btn');
    if (!button) return;
    const row = button.closest('tr');
    button.disabled = true;

    try {
      // 開くたびに最新の内容を読み込む
      const res = await fetch('/admin/reservations/' + encodeURIComponent(row.dataset.id));
      const result = await res.json().catch(() => ({}));
      if (!res.ok || !result.ok) throw new Error(result.error || '予約を読み込めませんでした。');
      const r = result.reservation;

      editingRow = row;
      form.elements.name.value = r.name || '';
      form.elements.phone.value = r.phone || '';
      fillOptions(form.elements.people, Array.from({ length: 12 }, (_, i) => i + 1), r.people, (v) => v + '名');
      fillOptions(form.elements.plan, PLANS, r.plan, (v) => v);
      form.elements.date.value = r.date || '';
      form.elements.message.value = r.message || '';
      formError.textContent = '';
      saveButton.disabled = false;
      dialog.showModal();
      form.elements.name.focus();
    } catch (err) {
      const msg = row.querySelector('.status-msg');
      msg.className = 'status-msg is-error';
      msg.textContent = err.message;
    } finally {
      button.disabled = false;
    }
  });

  document.getElementById('cancelEdit').addEventListener('click', () => dialog.close());

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!editingRow) return;

    const data = {
      name: form.elements.name.value.trim(),
      phone: form.elements.phone.value.trim(),
      people: Number(form.elements.people.value),
      plan: form.elements.plan.value,
      date: form.elements.date.value,
      message: form.elements.message.value.trim()
    };
    if (!data.name) { formError.textContent = 'お名前を入力してください。'; return; }
    if (!data.phone) { formError.textContent = 'お電話番号を入力してください。'; return; }
    if (!data.date) { formError.textContent = 'ご希望日を入力してください。'; return; }

    saveButton.disabled = true;
    formError.textContent = '';

    try {
      const result = await postJson('/admin/reservations/' + encodeURIComponent(editingRow.dataset.id), data);
      replaceRow(editingRow, result.html);
      editingRow = null;
      dialog.close();
    } catch (err) {
      formError.textContent = err.message;
      saveButton.disabled = false;
    }
  });
</script>
</body>
</html>`;
}

function registerAdmin(app, supabase) {
  app.get('/admin', requireAdmin, async (req, res) => {
    const { data, error } = await supabase
      .from('happytravel_reservations')
      .select(ROW_COLUMNS)
      .order('created_at', { ascending: false });

    res.set('Cache-Control', 'no-store');

    if (error) {
      console.error('予約一覧の取得に失敗しました:', error);
      return res.status(500).send(renderPage([], '予約の読み込みに失敗しました。時間をおいて「最新の情報にする」を押してください。'));
    }
    res.send(renderPage(data));
  });

  // 編集画面を開くときに、1件分の予約内容を返す
  app.get('/admin/reservations/:id', requireAdmin, async (req, res) => {
    const { data, error } = await supabase
      .from('happytravel_reservations')
      .select(EDIT_COLUMNS)
      .eq('id', req.params.id)
      .maybeSingle();

    res.set('Cache-Control', 'no-store');

    if (error) {
      console.error('予約の読み込みに失敗しました:', error);
      return res.status(500).json({ ok: false, error: '予約を読み込めませんでした。' });
    }
    if (!data) {
      return res.status(404).json({ ok: false, error: 'この予約が見つかりません。' });
    }
    res.json({ ok: true, reservation: data });
  });

  // 編集画面から予約内容を更新する
  app.post('/admin/reservations/:id', requireAdmin, async (req, res) => {
    const { value, error: invalid } = validateReservation(req.body || {});
    if (invalid) {
      return res.status(400).json({ ok: false, error: invalid });
    }

    const { data, error } = await supabase
      .from('happytravel_reservations')
      .update(value)
      .eq('id', req.params.id)
      .select(ROW_COLUMNS)
      .maybeSingle();

    if (error) {
      console.error('予約内容の更新に失敗しました:', error);
      return res.status(500).json({ ok: false, error: '保存できませんでした。' });
    }
    if (!data) {
      return res.status(404).json({ ok: false, error: 'この予約が見つかりません。' });
    }
    res.json({ ok: true, html: renderRow(data) });
  });

  // 一覧のプルダウンから予約の状態を変える
  app.post('/admin/reservations/:id/status', requireAdmin, async (req, res) => {
    const { status } = req.body || {};
    if (!STATUSES.includes(status)) {
      return res.status(400).json({ ok: false, error: '選べない状態です。' });
    }

    const { data, error } = await supabase
      .from('happytravel_reservations')
      .update({ status })
      .eq('id', req.params.id)
      .select(ROW_COLUMNS)
      .maybeSingle();

    if (error) {
      console.error('予約の状態の更新に失敗しました:', error);
      return res.status(500).json({ ok: false, error: '保存できませんでした。' });
    }
    if (!data) {
      return res.status(404).json({ ok: false, error: 'この予約が見つかりません。' });
    }
    res.json({ ok: true, status: data.status, html: renderRow(data) });
  });
}

module.exports = { registerAdmin };
