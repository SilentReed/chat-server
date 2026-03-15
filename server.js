/**
 * Chat Server - 带后台管理界面
 * 使用: npm install express ws sqlite3 jsonwebtoken bcryptjs cors
 * 运行: node server.js
 */

const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const sqlite3 = require('sqlite3').verbose();
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const cors = require('cors');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';
const ADMIN_SECRET = process.env.ADMIN_SECRET || 'admin123';

// 中间件
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// 数据库初始化
const db = new sqlite3.Database('./messages.db');

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE,
    password TEXT,
    nickname TEXT,
    role TEXT DEFAULT 'user',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sender_id INTEGER,
    receiver_id INTEGER,
    content TEXT,
    type TEXT DEFAULT 'text',
    status TEXT DEFAULT 'sent',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(sender_id) REFERENCES users(id),
    FOREIGN KEY(receiver_id) REFERENCES users(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS devices (
    id TEXT PRIMARY KEY,
    user_id INTEGER,
    platform TEXT,
    push_token TEXT,
    last_active DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  )`);
});

// WebSocket 连接管理
const clients = new Map();

wss.on('connection', (ws, req) => {
  let currentUserId = null;

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      
      if (data.type === 'auth') {
        try {
          const decoded = jwt.verify(data.token, JWT_SECRET);
          currentUserId = decoded.userId;
          clients.set(currentUserId, ws);
          ws.send(JSON.stringify({ type: 'auth', success: true }));
        } catch (e) {
          ws.send(JSON.stringify({ type: 'auth', success: false, error: 'Invalid token' }));
        }
      }
    } catch (e) {
      console.error('WS message error:', e);
    }
  });

  ws.on('close', () => {
    if (currentUserId) clients.delete(currentUserId);
  });
});

function sendToUser(userId, message) {
  const ws = clients.get(userId);
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
    return true;
  }
  return false;
}

// ============ API 路由 ============

// 管理后台 - 登录
app.post('/api/admin/login', (req, res) => {
  const { secret } = req.body;
  if (secret !== ADMIN_SECRET) {
    return res.json({ success: false, error: 'Invalid secret' });
  }
  const token = jwt.sign({ admin: true }, JWT_SECRET, { expiresIn: '24h' });
  res.json({ success: true, token });
});

// 管理中间件
function authenticateAdmin(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.json({ success: false, error: 'Token required' });
  
  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err || !user.admin) return res.json({ success: false, error: 'Invalid token' });
    req.user = user;
    next();
  });
}

// 获取统计
app.get('/api/admin/stats', authenticateAdmin, (req, res) => {
  db.get('SELECT COUNT(*) as userCount FROM users', (err, r1) => {
    db.get('SELECT COUNT(*) as messageCount FROM messages', (err, r2) => {
      db.get('SELECT COUNT(*) as onlineCount FROM devices WHERE datetime(last_active) > datetime("now", "-5 minutes")', (err, r3) => {
        res.json({ 
          success: true, 
          stats: {
            users: r1.userCount,
            messages: r2.messageCount,
            online: r3.onlineCount
          }
        });
      });
    });
  });
});

// 获取所有用户
app.get('/api/admin/users', authenticateAdmin, (req, res) => {
  db.all('SELECT id, username, nickname, role, created_at FROM users ORDER BY id', (err, users) => {
    res.json({ success: true, users });
  });
});

// 创建用户
app.post('/api/admin/users', authenticateAdmin, async (req, res) => {
  const { username, password, nickname, role = 'user' } = req.body;
  if (!username || !password) {
    return res.json({ success: false, error: 'Username and password required' });
  }
  
  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    db.run('INSERT INTO users (username, password, nickname, role) VALUES (?, ?, ?, ?)',
      [username, hashedPassword, nickname || username, role],
      function(err) {
        if (err) return res.json({ success: false, error: 'Username exists' });
        res.json({ success: true, userId: this.lastID });
      }
    );
  } catch (e) {
    res.json({ success: false, error: e.message });
  }
});

// 删除用户
app.delete('/api/admin/users/:id', authenticateAdmin, (req, res) => {
  db.run('DELETE FROM users WHERE id = ? AND role != "admin"', [req.params.id], function(err) {
    res.json({ success: true, deleted: this.changes });
  });
});

// 获取所有消息
app.get('/api/admin/messages', authenticateAdmin, (req, res) => {
  const { limit = 50, offset = 0 } = req.query;
  db.all(`
    SELECT m.*, s.username as sender_username, r.username as receiver_username
    FROM messages m
    LEFT JOIN users s ON m.sender_id = s.id
    LEFT JOIN users r ON m.receiver_id = r.id
    ORDER BY m.created_at DESC LIMIT ? OFFSET ?
  `, [limit, offset], (err, messages) => {
    res.json({ success: true, messages: messages.reverse() });
  });
});

// 删除消息
app.delete('/api/admin/messages/:id', authenticateAdmin, (req, res) => {
  db.run('DELETE FROM messages WHERE id = ?', [req.params.id], function(err) {
    res.json({ success: true, deleted: this.changes });
  });
});

// 获取设置
app.get('/api/admin/settings', authenticateAdmin, (req, res) => {
  db.all('SELECT * FROM settings', (err, settings) => {
    const obj = {};
    settings.forEach(s => obj[s.key] = s.value);
    res.json({ success: true, settings: obj });
  });
});

// 保存设置
app.post('/api/admin/settings', authenticateAdmin, (req, res) => {
  const { key, value } = req.body;
  db.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', [key, value], function(err) {
    res.json({ success: true });
  });
});

// ============ 用户API ============

app.post('/api/auth/register', async (req, res) => {
  const { username, password, nickname } = req.body;
  if (!username || !password) {
    return res.json({ success: false, error: 'Username and password required' });
  }

  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    db.run('INSERT INTO users (username, password, nickname) VALUES (?, ?, ?)',
      [username, hashedPassword, nickname || username],
      function(err) {
        if (err) return res.json({ success: false, error: 'Username exists' });
        res.json({ success: true, userId: this.lastID });
      }
    );
  } catch (e) {
    res.json({ success: false, error: e.message });
  }
});

app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;
  
  db.get('SELECT * FROM users WHERE username = ?', [username], async (err, user) => {
    if (err || !user) return res.json({ success: false, error: 'User not found' });

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.json({ success: false, error: 'Invalid password' });

    const token = jwt.sign({ userId: user.id, username: user.username }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ 
      success: true, 
      token, 
      user: { id: user.id, username: user.username, nickname: user.nickname }
    });
  });
});

app.get('/api/auth/profile', authenticateToken, (req, res) => {
  db.get('SELECT id, username, nickname, created_at FROM users WHERE id = ?', [req.user.userId], (err, user) => {
    if (err || !user) return res.json({ success: false, error: 'User not found' });
    res.json({ success: true, user });
  });
});

app.post('/api/messages/send', authenticateToken, (req, res) => {
  const { receiver_id, content, type = 'text' } = req.body;
  if (!receiver_id || !content) {
    return res.json({ success: false, error: 'receiver_id and content required' });
  }

  db.run('INSERT INTO messages (sender_id, receiver_id, content, type) VALUES (?, ?, ?, ?)',
    [req.user.userId, receiver_id, content, type],
    function(err) {
      if (err) return res.json({ success: false, error: err.message });

      const message = {
        id: this.lastID,
        sender_id: req.user.userId,
        receiver_id,
        content,
        type,
        status: 'sent',
        created_at: new Date().toISOString()
      };

      sendToUser(receiver_id, { type: 'message', data: message });
      res.json({ success: true, message });
    }
  );
});

app.get('/api/messages', authenticateToken, (req, res) => {
  const { other_id, limit = 50, offset = 0 } = req.query;
  
  let sql = `
    SELECT m.*, u.username as sender_username, u.nickname as sender_nickname
    FROM messages m
    LEFT JOIN users u ON m.sender_id = u.id
    WHERE (m.sender_id = ? AND m.receiver_id = ?) OR (m.sender_id = ? AND m.receiver_id = ?)
    ORDER BY m.created_at DESC LIMIT ? OFFSET ?
  `;

  db.all(sql, [req.user.userId, other_id, other_id, req.user.userId, limit, offset], (err, messages) => {
    if (err) return res.json({ success: false, error: err.message });
    res.json({ success: true, messages: messages.reverse() });
  });
});

app.get('/api/users', authenticateToken, (req, res) => {
  db.all('SELECT id, username, nickname FROM users WHERE id != ?', [req.user.userId], (err, users) => {
    if (err) return res.json({ success: false, error: err.message });
    res.json({ success: true, users });
  });
});

function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.json({ success: false, error: 'Token required' });

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.json({ success: false, error: 'Invalid token' });
    req.user = user;
    next();
  });
}

server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`Admin: http://localhost:${PORT}/admin`);
  console.log(`WebSocket: ws://localhost:${PORT}`);
});
