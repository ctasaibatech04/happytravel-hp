require('dotenv').config();

const express = require('express');
const path = require('path');
const { Resend } = require('resend');
const { createClient } = require('@supabase/supabase-js');
const { registerAdmin } = require('./admin');

const app = express();
const PORT = process.env.PORT || 3000;

// Vercel などのプロキシ越しでも https 判定やアクセス元IPを正しく取れるようにする
app.set('trust proxy', 1);

const resend = new Resend(process.env.RESEND_API_KEY);
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

app.use(express.json());

// お店のトップページ（/）を開いたら public/index.html を表示する
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.use(express.static(path.join(__dirname, 'public')));

// 「2026年9月15日」のような日本語表記の日付をDBが扱えるISO形式「2026-09-15」に変換する
function toIsoDate(japaneseDate) {
  const m = String(japaneseDate).match(/^(\d{4})年(\d{1,2})月(\d{1,2})日$/);
  if (!m) return null;
  const [, y, mo, d] = m;
  return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
}

app.post('/api/reserve', async (req, res) => {
  const { name, phone, people, plan, date, message } = req.body || {};

  if (!name || !phone || !people || !plan || !date) {
    return res.status(400).json({ ok: false, error: '必須項目が入力されていません。' });
  }

  const isoDate = toIsoDate(date);
  if (!isoDate) {
    return res.status(400).json({ ok: false, error: 'ご希望日の形式が正しくありません。' });
  }

  console.log('----- 新しいご予約 -----');
  console.log('お名前：' + name + ' 様');
  console.log('お電話番号：' + phone);
  console.log('ご相談人数：' + people + '名');
  console.log('旅行プラン：' + plan);
  console.log('ご希望日：' + date);
  console.log('ご相談内容：' + (message ? message : '（記入なし）'));
  console.log('------------------------');

  const { error: dbError } = await supabase
    .from('happytravel_reservations')
    .insert({ name, phone, people, plan, date: isoDate, message: message || null });

  if (dbError) {
    console.error('Supabaseへの保存に失敗しました:', dbError);
  }

  try {
    await resend.emails.send({
      from: process.env.MAIL_FROM,
      to: process.env.MAIL_TO,
      subject: `【ご予約】${name} 様より`,
      text:
        `お名前：${name} 様\n` +
        `お電話番号：${phone}\n` +
        `ご相談人数：${people}名\n` +
        `旅行プラン：${plan}\n` +
        `ご希望日：${date}\n` +
        `ご相談内容：${message ? message : '（記入なし）'}\n`
    });

    res.json({ ok: true, savedToDatabase: !dbError });
  } catch (err) {
    console.error('メール送信に失敗しました:', err);
    res.status(500).json({ ok: false, error: 'メールの送信に失敗しました。' });
  }
});

registerAdmin(app, supabase);

// npm start で直接起動したときだけサーバーを立ち上げる（Vercel では api/index.js から app を読み込んで使う）
if (require.main === module) {
  app.listen(PORT, () => {
    console.log('サーバーを起動しました：http://localhost:' + PORT);
  });
}

module.exports = app;
