# Chat Server

自建消息服务器 - 最小可用版本

## 功能

- 用户注册/登录 (JWT认证)
- 消息收发 (REST API + WebSocket实时推送)
- SQLite本地存储
- **图片消息** - 支持发送和接收图片
- OpenClaw集成 (Webhook回调)
- 管理后台 (`/admin`) - 用户管理、消息管理
- 用户客户端 (`/`) - 聊天界面

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
| ADMIN_SECRET | admin123 | 管理后台密钥 |
| SC3_BOT_TOKEN | - | Server酱³ Bot Token (可选，用于推送图片) |
| SC3_API_URL | https://bot-go.apijia.cn | Server酱³ API地址 |

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
# 发送文本消息
POST /api/messages/send
Authorization: Bearer <token>
{"receiver_id":2,"content":"你好"}

# 发送图片消息
POST /api/messages/send
Authorization: Bearer <token>
{"receiver_id":2,"content":"图片描述","image_url":"https://example.com/image.jpg"}

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

// 发送正在输入状态
ws.send(JSON.stringify({ type: 'typing', receiver_id: 2 }));

// 接收消息
ws.onmessage = (e) => console.log(JSON.parse(e.data));
```

### OpenClaw 集成

```bash
# OpenClaw消息回调
POST /api/openclaw/webhook
{"user_id":1,"content":"消息内容","image_url":"https://example.com/img.jpg"}
```

## 目录结构

```
chat-server/
├── server.js          # 主服务
├── Dockerfile         # Docker镜像
├── docker-compose.yml # Docker编排
├── install.sh         # 一键部署脚本
├── package.json       # 依赖
├── public/
│   ├── index.html     # 用户聊天界面
│   └── admin.html     # 管理后台
└── README.md
```

## License

MIT
