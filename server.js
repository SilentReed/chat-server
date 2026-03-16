/**
 * Chat Server - 完整版
 * 使用: npm install express ws sqlite3 jsonwebtoken bcryptjs cors axios
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
const axios = require('axios');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';
const ADMIN_SECRET = process.env.ADMIN_SECRET || 'admin123';

// Server酱³ Bot配置（用于发送图片消息）
const SC3_BOT_TOKEN = process.env.SC3_BOT_TOKEN || '';
const SC3_API_URL = process.env.SC3_API_URL || 'https://bot-go.apijia.cn';

// 中间件
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// 数据库
const db = new sqlite3.Database('./messages.db');

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE,
    password TEXT,
    nickname TEXT,
    avatar TEXT,
    role TEXT DEFAULT 'user',
    status TEXT DEFAULT 'online',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sender_id INTEGER,
    receiver_id INTEGER,
    content TEXT,
    type TEXT DEFAULT 'text',
    image_url TEXT,
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

// WebSocket
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
          db.run('UPDATE users SET status = "online" WHERE id = ?', [currentUserId]);
          broadcastOnlineUsers();
        } catch (e) {
          ws.send(JSON.stringify({ type: 'auth', success: false }));
        }
      } else if (data.type === 'typing') {
        const receiverWs = clients.get(data.receiver_id);
        if (receiverWs) {
          receiverWs.send(JSON.stringify({ type: 'typing', from: currentUserId }));
        }
      }
    } catch (e) {}
  });

  ws.on('close', () => {
    if (currentUserId) {
      clients.delete(currentUserId);
      db.run('UPDATE users SET status = "offline" WHERE id = ?', [currentUserId]);
      broadcastOnlineUsers();
    }
  });
});

function broadcastOnlineUsers() {
  const online = Array.from(clients.keys());
  const data = JSON.stringify({ type: 'online', users: online });
  clients.forEach(ws => {
    if (ws.readyState === WebSocket.OPEN) ws.send(data);
  });
}

function sendToUser(userId, message) {
  const ws = clients.get(userId);
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
    return true;
  }
  return false;
}

// 发送图片到Server酱³ Bot
async function sendImageToSc3(chatId, imageUrl, caption) {
  if (!SC3_BOT_TOKEN) return null;
  
  try {
    const response = await axios.post(`${SC3_API_URL}/bot${SC3_BOT_TOKEN}/sendPhoto`, {
      chat_id: chatId,
      photo: imageUrl,
      caption: caption || ''
    });
    return response.data;
  } catch (e) {
    console.error('Send image to SC3 failed:', e.message);
    return null;
  }
}

// ============ API ============

// 管理后台登录
app.post('/api/admin/login', (req, res) => {
  const { secret } = req.body;
  if (secret !== ADMIN_SECRET) {
    return res.json({ success: false, error: 'Invalid secret' });
  }
  const token = jwt.sign({ admin: true }, JWT_SECRET, { expiresIn: '24h' });
  res.json({ success: true, token });
});

function authenticateAdmin(req, res, next) {
  const token = req.headers['authorization']?.split(' ')[1];
  if (!token) return res.json({ success: false, error: 'Token required' });
  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err || !user.admin) return res.json({ success: false, error: 'Invalid token' });
    next();
  });
}

app.get('/api/admin/stats', authenticateAdmin, (req, res) => {
  db.get('SELECT COUNT(*) as c FROM users', (e, r) => {
    db.get('SELECT COUNT(*) as c FROM messages', (e2, r2) => {
      db.get('SELECT COUNT(*) as c FROM devices WHERE datetime(last_active) > datetime("now", "-5 min")', (e3, r3) => {
        res.json({ success: true, stats: { users: r.c, messages: r2.c, online: r3.c } });
      });
    });
  });
});

app.get('/api/admin/users', authenticateAdmin, (req, res) => {
  db.all('SELECT id, username, nickname, role, status, created_at FROM users', (err, users) => {
    res.json({ success: true, users });
  });
});

app.post('/api/admin/users', authenticateAdmin, async (req, res) => {
  const { username, password, nickname, role = 'user' } = req.body;
  if (!username || !password) return res.json({ success: false, error: 'Required' });
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

app.delete('/api/admin/users/:id', authenticateAdmin, (req, res) => {
  db.run('DELETE FROM users WHERE id = ? AND role != "admin"', [req.params.id], function(err) {
    res.json({ success: true, deleted: this.changes });
  });
});

app.get('/api/admin/messages', authenticateAdmin, (req, res) => {
  const { limit = 100, offset = 0 } = req.query;
  db.all(`
    SELECT m.*, s.username as sender, r.username as receiver
    FROM messages m
    LEFT JOIN users s ON m.sender_id = s.id
    LEFT JOIN users r ON m.receiver_id = r.id
    ORDER BY m.created_at DESC LIMIT ? OFFSET ?
  `, [limit, offset], (err, messages) => {
    res.json({ success: true, messages: messages.reverse() });
  });
});

app.delete('/api/admin/messages/:id', authenticateAdmin, (req, res) => {
  db.run('DELETE FROM messages WHERE id = ?', [req.params.id], function(err) {
    res.json({ success: true, deleted: this.changes });
  });
});

// 用户认证
app.post('/api/auth/register', async (req, res) => {
  const { username, password, nickname } = req.body;
  if (!username || !password) return res.json({ success: false, error: 'Required' });
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
    res.json({ success: true, token, user: { id: user.id, username: user.username, nickname: user.nickname, avatar: user.avatar } });
  });
});

function authenticateToken(req, res, next) {
  const token = req.headers['authorization']?.split(' ')[1];
  if (!token) return res.json({ success: false, error: 'Token required' });
  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.json({ success: false, error: 'Invalid token' });
    req.user = user;
    next();
  });
}

app.get('/api/auth/profile', authenticateToken, (req, res) => {
  db.get('SELECT id, username, nickname, avatar, status, created_at FROM users WHERE id = ?', [req.user.userId], (err, user) => {
    if (err || !user) return res.json({ success: false, error: 'User not found' });
    res.json({ success: true, user });
  });
});

// 用户列表
app.get('/api/users', authenticateToken, (req, res) => {
  db.all('SELECT id, username, nickname, avatar, status FROM users WHERE id != ?', [req.user.userId], (err, users) => {
    res.json({ success: true, users });
  });
});

// 发送消息（支持文本和图片）
app.post('/api/messages/send', authenticateToken, (req, res) => {
  const { receiver_id, content, type = 'text', image_url } = req.body;
  
  if (!receiver_id || (!content && !image_url)) {
    return res.json({ success: false, error: 'Required' });
  }

  const msgType = image_url ? 'image' : type;

  db.run('INSERT INTO messages (sender_id, receiver_id, content, type, image_url) VALUES (?, ?, ?, ?, ?)',
    [req.user.userId, receiver_id, content || '', msgType, image_url || null],
    async function(err) {
      if (err) return res.json({ success: false, error: err.message });

      const message = {
        id: this.lastID,
        sender_id: req.user.userId,
        receiver_id,
        content: content || '',
        type: msgType,
        image_url: image_url || null,
        status: 'sent',
        created_at: new Date().toISOString()
      };

      // 推送给接收者
      sendToUser(receiver_id, { type: 'message', data: message });

      // 如果配置了Server酱³ Bot且是图片消息，发送到Server酱
      if (image_url && SC3_BOT_TOKEN) {
        // 获取接收者的chat_id（这里简化处理，实际需要映射）
        const user = await new Promise((resolve) => {
          db.get('SELECT username FROM users WHERE id = ?', [receiver_id], (err, u) => resolve(u));
        });
        // 发送图片到Server酱
        await sendImageToSc3(receiver_id, image_url, content);
      }

      res.json({ success: true, message });
    }
  );
});

app.get('/api/messages', authenticateToken, (req, res) => {
  const { other_id, limit = 50, offset = 0 } = req.query;
  db.all(`
    SELECT m.*, s.username as sender_username, s.nickname as sender_nickname
    FROM messages m
    LEFT JOIN users s ON m.sender_id = s.id
    WHERE (m.sender_id = ? AND m.receiver_id = ?) OR (m.sender_id = ? AND m.receiver_id = ?)
    ORDER BY m.created_at DESC LIMIT ? OFFSET ?
  `, [req.user.userId, other_id, other_id, req.user.userId, limit, offset], (err, messages) => {
    res.json({ success: true, messages: messages.reverse() });
  });
});

// OpenClaw 集成
app.post('/api/openclaw/webhook', (req, res) => {
  const { user_id, content, image_url } = req.body;
  if (!user_id || (!content && !image_url)) return res.json({ success: false, error: 'Required' });

  const msgType = image_url ? 'image' : 'text';
  db.run('INSERT INTO messages (sender_id, receiver_id, content, type, image_url) VALUES (?, ?, ?, ?, ?)',
    [0, user_id, content || '', msgType, image_url || null],
    function(err) {
      if (!err) {
        sendToUser(user_id, { 
          type: 'message', 
          data: { 
            id: this.lastID, 
            sender_id: 0, 
            content: content || '', 
            type: msgType,
            image_url: image_url || null,
            created_at: new Date().toISOString() 
          }
        });
      }
    }
  );
  res.json({ success: true });
});

server.listen(PORT, () => {
  console.log(`Server: http://localhost:${PORT}`);
  console.log(`Admin:  http://localhost:${PORT}/admin`);
});
