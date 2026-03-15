/**
 * 最小消息服务器 Demo
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

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 3000;
const JWT_SECRET = 'your-secret-key-change-in-production';

// 中间件
app.use(cors());
app.use(express.json());

// 数据库初始化
const db = new sqlite3.Database('./messages.db');

db.serialize(() => {
  // 用户表
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE,
    password TEXT,
    nickname TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // 消息表
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

  // 设备表
  db.run(`CREATE TABLE IF NOT EXISTS devices (
    id TEXT PRIMARY KEY,
    user_id INTEGER,
    platform TEXT,
    push_token TEXT,
    last_active DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id)
  )`);
});

// WebSocket 连接管理
const clients = new Map(); // userId -> WebSocket

wss.on('connection', (ws, req) => {
  let currentUserId = null;

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      
      if (data.type === 'auth') {
        // 验证Token并绑定用户
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
    if (currentUserId) {
      clients.delete(currentUserId);
    }
  });
});

// 广播消息给指定用户
function sendToUser(userId, message) {
  const ws = clients.get(userId);
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
    return true;
  }
  return false;
}

// ============ API 路由 ============

// 注册
app.post('/api/auth/register', async (req, res) => {
  const { username, password, nickname } = req.body;
  
  if (!username || !password) {
    return res.json({ success: false, error: 'Username and password required' });
  }

  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    
    db.run(
      'INSERT INTO users (username, password, nickname) VALUES (?, ?, ?)',
      [username, hashedPassword, nickname || username],
      function(err) {
        if (err) {
          return res.json({ success: false, error: 'Username already exists' });
        }
        res.json({ success: true, userId: this.lastID });
      }
    );
  } catch (e) {
    res.json({ success: false, error: e.message });
  }
});

// 登录
app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;
  
  db.get('SELECT * FROM users WHERE username = ?', [username], async (err, user) => {
    if (err || !user) {
      return res.json({ success: false, error: 'User not found' });
    }

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) {
      return res.json({ success: false, error: 'Invalid password' });
    }

    const token = jwt.sign({ userId: user.id, username: user.username }, JWT_SECRET, { expiresIn: '7d' });
    
    res.json({ 
      success: true, 
      token, 
      user: { id: user.id, username: user.username, nickname: user.nickname }
    });
  });
});

// 获取用户资料
app.get('/api/auth/profile', authenticateToken, (req, res) => {
  db.get('SELECT id, username, nickname, created_at FROM users WHERE id = ?', [req.user.userId], (err, user) => {
    if (err || !user) {
      return res.json({ success: false, error: 'User not found' });
    }
    res.json({ success: true, user });
  });
});

// 发送消息
app.post('/api/messages/send', authenticateToken, (req, res) => {
  const { receiver_id, content, type = 'text' } = req.body;
  
  if (!receiver_id || !content) {
    return res.json({ success: false, error: 'receiver_id and content required' });
  }

  db.run(
    'INSERT INTO messages (sender_id, receiver_id, content, type) VALUES (?, ?, ?, ?)',
    [req.user.userId, receiver_id, content, type],
    function(err) {
      if (err) {
        return res.json({ success: false, error: err.message });
      }

      const message = {
        id: this.lastID,
        sender_id: req.user.userId,
        receiver_id,
        content,
        type,
        status: 'sent',
        created_at: new Date().toISOString()
      };

      // WebSocket推送
      sendToUser(receiver_id, { type: 'message', data: message });

      res.json({ success: true, message });
    }
  );
});

// 获取消息列表
app.get('/api/messages', authenticateToken, (req, res) => {
  const { other_id, limit = 50, offset = 0 } = req.query;
  
  let sql = `
    SELECT m.*, u.username as sender_username, u.nickname as sender_nickname
    FROM messages m
    LEFT JOIN users u ON m.sender_id = u.id
    WHERE (m.sender_id = ? AND m.receiver_id = ?) OR (m.sender_id = ? AND m.receiver_id = ?)
    ORDER BY m.created_at DESC
    LIMIT ? OFFSET ?
  `;

  db.all(sql, [req.user.userId, other_id, other_id, req.user.userId, limit, offset], (err, messages) => {
    if (err) {
      return res.json({ success: false, error: err.message });
    }
    res.json({ success: true, messages: messages.reverse() });
  });
});

// 获取用户列表
app.get('/api/users', authenticateToken, (req, res) => {
  db.all('SELECT id, username, nickname FROM users WHERE id != ?', [req.user.userId], (err, users) => {
    if (err) {
      return res.json({ success: false, error: err.message });
    }
    res.json({ success: true, users });
  });
});

// OpenClaw 回调 - 收到消息后推送给APP
app.post('/api/openclaw/webhook', (req, res) => {
  const { user_id, content, from } = req.body;
  
  // 存储消息
  db.run(
    'INSERT INTO messages (sender_id, receiver_id, content, type) VALUES (?, ?, ?, ?)',
    [0, user_id, content, 'text'],
    function(err) {
      if (!err) {
        // 推送给APP
        sendToUser(user_id, { 
          type: 'message', 
          data: {
            id: this.lastID,
            sender_id: 0,
            sender_username: 'openclaw',
            content,
            created_at: new Date().toISOString()
          }
        });
      }
    }
  );

  res.json({ success: true });
});

// OpenClaw 发送消息
app.post('/api/openclaw/send', authenticateToken, (req, res) => {
  const { content } = req.body;
  
  // 这里可以调用OpenClaw的API发送消息
  // 暂时只返回成功
  res.json({ success: true, message: 'Message queued' });
});

// 中间件：验证Token
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.json({ success: false, error: 'Token required' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.json({ success: false, error: 'Invalid token' });
    }
    req.user = user;
    next();
  });
}

// 启动服务器
server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`WebSocket running on ws://localhost:${PORT}`);
});
