<div align="center">
  <img src="https://img.shields.io/badge/FastAPI-0.115-009688?logo=fastapi" alt="FastAPI">
  <img src="https://img.shields.io/badge/Python-3.13-3776AB?logo=python" alt="Python">
  <img src="https://img.shields.io/badge/Socket.IO-4.7-010101?logo=socket.io" alt="Socket.IO">
  <img src="https://img.shields.io/badge/license-MIT-blue" alt="License">
</div>

<br>

<div align="center">
  <h1>AuraChat</h1>
  <p><strong>轻盈 · 清澈 · 如约而至</strong></p>
  <p>一个基于 FastAPI + Socket.IO 的实时聊天室应用</p>
</div>

---

## ✨ 特性

- **实时消息** — 基于 WebSocket 的即时消息收发
- **图片/文件传输** — 支持粘贴、上传图片和各类文件（≤1MB）
- **历史消息** — 登录后自动加载最近 30 条聊天记录
- **消息编辑/撤回** — 发送后可编辑或撤回自己的消息
- **在线用户列表** — 实时显示当前在线用户
- **输入中提示** — 显示其他用户正在输入的状态
- **多主题色** — 6 种主题色自由切换
- **文件下载** — 文件消息点击即可下载
- **全格式支持** — 图片、PDF、文档、表格、代码等
- **响应式布局** — 桌面端 / 平板 / 手机自适应
- **安全防护** — 速率限制、输入净化、安全响应头

## 🚀 快速开始

### 环境要求

- Python 3.9+
- pip

### 安装与运行

```bash
# 克隆仓库
git clone https://github.com/ekeer/aura-chat.git
cd aura-chat

# 安装依赖
pip install -r requirements.txt

# 启动服务器
python main.py
```

打开浏览器访问 `http://localhost:3000`

### 使用 Docker

```bash
docker build -t aura-chat .
docker run -p 3000:3000 aura-chat
```

## 🖥️ 技术栈

| 层级 | 技术 |
|------|------|
| 后端框架 | FastAPI |
| 实时通信 | python-socketio (Socket.IO v4) |
| 服务器 | Uvicorn |
| 前端 | Vanilla JS + CSS3 |
| 字体 | Inter + JetBrains Mono |

## 🔒 安全措施

- 消息/登录速率限制（滑动窗口）
- 连接频率控制（IP 级别）
- 用户名 XSS 净化
- 消息长度/文件大小校验
- 安全响应头（X-Frame-Options, X-XSS-Protection 等）
- CORS 中间件

## 📁 项目结构

```
aura-chat/
├── main.py              # FastAPI 后端 + Socket.IO 事件处理
├── requirements.txt     # Python 依赖
├── public/
│   ├── index.html       # 主页面
│   ├── style.css        # 样式表
│   └── script.js        # 前端逻辑
└── .gitignore
```

## 📝 License

MIT
