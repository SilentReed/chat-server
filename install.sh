#!/bin/bash

# Chat Server 一键部署脚本

set -e

echo "🚀 开始部署 Chat Server..."

# 检测系统
if [ -f /etc/os-release ]; then
    . /etc/os-release
    OS=$ID
else
    echo "❌ 无法检测系统"
    exit 1
fi

# 安装 Docker (如果未安装)
if ! command -v docker &> /dev/null; then
    echo "📦 安装 Docker..."
    if [ "$OS" = "ubuntu" ] || [ "$OS" = "debian" ]; then
        apt-get update
        apt-get install -y docker.io docker-compose
    elif [ "$OS" = "centos" ] || [ "$OS" = "almalinux" ] || [ "$OS" = "rocky" ]; then
        yum install -y docker docker-compose
    fi
    systemctl start docker || true
    systemctl enable docker || true
fi

# 创建工作目录
WORK_DIR="/opt/chat-server"
echo "📁 创建工作目录: $WORK_DIR"
mkdir -p $WORK_DIR
cd $WORK_DIR

# 下载代码
echo "📥 下载代码..."
if command -v git &> /dev/null; then
    git clone https://github.com/YOUR_USERNAME/chat-server.git .
else
    # 如果没有git，提示用户手动上传
    echo "⚠️ 请手动上传代码到 $WORK_DIR"
    echo "或者安装 git: apt-get install git"
    exit 1
fi

# 配置环境变量
echo "⚙️ 配置环境变量..."
if [ ! -f .env ]; then
    cat > .env << EOF
PORT=3000
JWT_SECRET=$(openssl rand -hex 32)
DB_PATH=./data/messages.db
EOF
    echo "✅ 环境变量已创建"
fi

# 构建并启动
echo "🐳 构建Docker镜像..."
docker-compose build

echo "🚀 启动服务..."
docker-compose up -d

# 检查状态
echo "📊 检查服务状态..."
sleep 3
docker-compose ps

echo ""
echo "✅ 部署完成!"
echo "   访问地址: http://你的服务器IP:3000"
echo ""
echo "   常用命令:"
echo "   - 查看日志: docker-compose logs -f"
echo "   - 重启服务: docker-compose restart"
echo "   - 停止服务: docker-compose down"
