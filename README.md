# Chat Server

自建消息服务器 - 最小可用版本

## 功能

- 用户注册/登录 (JWT认证)
- 消息收发 (REST API + WebSocket实时推送)
- SQLite本地存储
- OpenClaw集成 (Webhook回调)

## 快速部署

### Docker 部署

```bash
# 构建
docker build -t chat-server .

# 运行
docker run -d -p 3000:3000 -v $(pwd)/data:/app/data chat-server
```

### 一键部署

```bash
curl -sSL https://raw.githubusercontent.com/YOUR_USERNAME/chat-server/main/install.sh | bash
```

### 手动部署

```bash
# 安装依赖
npm install

# 启动
node server.js
```

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| PORT | 3000 | 服务端口 |
| JWT_SECRET | your-secret-key | JWT密钥(生产环境请修改) |
| DB_PATH | ./messages.db | 数据库路径 |

## API 文档

### 认证

```bash
# 注册
POST /api/auth/register
{"username":"user","password":"pass","nickname":"昵称"}

# 登录
POST /api/auth/login
{"username":"user","password":"pass"}
# 返回: {"success":true,"token":"xxx","user":{...}}
```

### 消息

```bash
# 发送消息
POST /api/messages/send
Authorization: Bearer <token>
{"receiver_id":2,"content":"你好"}

# 获取消息
GET /api/messages?other_id=2&limit=50
Authorization: Bearer <token>
```

### WebSocket

```javascript
// 连接
const ws = new WebSocket('ws://localhost:3000');

// 认证
ws.send(JSON.stringify({ type: 'auth', token: 'JWT_TOKEN' }));

// 接收消息
ws.onmessage = (e) => console.log(JSON.parse(e.data));
```

### OpenClaw 集成

```bash
# OpenClaw消息回调
POST /api/openclaw/webhook
{"user_id":1,"content":"消息内容","from":"openclaw"}
```

## 目录结构

```
chat-server/
├── server.js          # 主服务
├── Dockerfile         # Docker镜像
├── docker-compose.yml # Docker编排
├── install.sh         # 一键部署脚本
├── package.json      # 依赖
└── README.md
```

## License

MIT
