# Chat Server

自建消息服务器 - 完整体验对标Server酱

## 特性

- 💬 实时消息收发 (WebSocket)
- 👥 用户管理 (注册/登录)
- 🖼️ 图片消息支持
- 📱 跨平台Web界面
- 🔒 JWT认证
- 📊 管理后台

## 快速部署

### Docker

```bash
docker build -t chat-server .
docker run -d -p 3000:3000 -v $(pwd)/data:/app/data chat-server
```

### 一键部署

```bash
curl -sSL https://raw.githubusercontent.com/SilentReed/chat-server/main/install.sh | bash
```

### 手动

```bash
npm install
node server.js
```

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| PORT | 3000 | 服务端口 |
| JWT_SECRET | - | JWT密钥(生产环境必填) |
| ADMIN_SECRET | admin123 | 管理后台密码 |

## API

### 认证
```bash
POST /api/auth/register {"username":"user","password":"pass","nickname":"昵称"}
POST /api/auth/login {"username":"user","password":"pass"}
```

### 消息
```bash
POST /api/messages/send {"receiver_id":2,"content":"你好","image_url":"https://..."}
GET /api/messages?other_id=2
```

### WebSocket
```javascript
ws = new WebSocket('ws://localhost:3000');
ws.send(JSON.stringify({ type: 'auth', token: 'JWT' }));
```

## 访问

- 用户端: http://localhost:3000
- 管理后台: http://localhost:3000/admin

## License

MIT
