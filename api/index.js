// Vercel 用の入口。/admin と /api/* へのアクセスを Express（server.js）に渡す（vercel.json の rewrites を参照）
module.exports = require('../server');
