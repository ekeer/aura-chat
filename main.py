"""
聊天室后端 - FastAPI + python-socketio
v4 — 专家优化版
"""
import asyncio
import mimetypes
import random
import string
import time
from collections import defaultdict, deque

from fastapi import FastAPI, Request
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
import socketio

# ── 配置 ──
HOST = "0.0.0.0"
PORT = 3000
MAX_USERNAME_LEN = 20
MAX_MSG_LEN = 500
RATE_LIMIT_WINDOW = 10          # 秒
RATE_LIMIT_MAX_MSGS = 20        # 每窗口最大消息数
RATE_LIMIT_MAX_LOGINS = 10      # 每窗口最大登录尝试数
CONNECT_RATE_WINDOW = 30        # 秒
CONNECT_RATE_MAX = 15           # 每窗口最大连接数
HISTORY_LIMIT = 30              # 保留最近 N 条消息
MAX_FILE_SIZE = 1024 * 1024      # 文件最大 1MB
MAX_IMAGE_SIZE = 1024 * 1024      # 图片最大 1MB

AVATAR_COLORS = [
    "#FF6B6B", "#4ECDC4", "#45B7D1", "#96CEB4",
    "#FFEAA7", "#DDA0DD", "#98D8C8", "#F7DC6F",
    "#BB8FCE", "#85C1E9", "#F0B27A", "#82E0AA",
    "#FF9FF3", "#54A0FF", "#5F27CD", "#01A3A4",
]

# ── 工具函数 ──
def _rand_color() -> str:
    return random.choice(AVATAR_COLORS)

def _rand_suffix() -> str:
    return "".join(random.choices(string.ascii_lowercase + string.digits, k=5))

def _sanitize_name(name: str) -> str:
    """净化用户名：只保留可见字符，去除控制字符"""
    return "".join(c for c in name if c.isprintable() and c not in "\r\n\t").strip()

# ── 速率限制器 ──
class RateLimiter:
    """基于滑动窗口的速率限制器"""
    def __init__(self):
        self._ip_records: dict[str, list[float]] = {}
        self._sid_records: dict[str, dict[str, list[float]]] = {}  # sid -> {type: [timestamps]}

    def check_ip(self, ip: str, key: str, max_count: int, window: int) -> bool:
        now = time.time()
        ip_key = f"{ip}:{key}"
        records = self._ip_records.setdefault(ip_key, [])
        # 清理过期记录
        cutoff = now - window
        records[:] = [t for t in records if t > cutoff]
        if len(records) >= max_count:
            return False
        records.append(now)
        return True

    def check_sid(self, sid: str, key: str, max_count: int, window: int) -> bool:
        now = time.time()
        records = self._sid_records.setdefault(sid, {})
        timestamps = records.setdefault(key, [])
        cutoff = now - window
        timestamps[:] = [t for t in timestamps if t > cutoff]
        if len(timestamps) >= max_count:
            return False
        timestamps.append(now)
        return True

    def cleanup(self, sid: str):
        self._sid_records.pop(sid, None)

# ── Socket.IO 服务端 ──
sio = socketio.AsyncServer(
    async_mode="asgi",
    cors_allowed_origins=[],           # 交由 FastAPI CORS 中间件管理
    max_http_buffer_size=10 * 1024 * 1024,  # 10MB — 支持 5MB 文件(base64)
    logger=False,
    engineio_logger=False,
)

online_users: dict[str, dict] = {}
message_history: deque = deque(maxlen=HISTORY_LIMIT)  # 最近 N 条历史消息
messages_by_id: dict[str, dict] = {}  # id → msg 索引，用于编辑/删除
rate_limiter = RateLimiter()
# 连接频率跟踪 (IP 级别) — 定期清理旧记录避免内存泄漏
connect_records: dict[str, list[float]] = {}
_connect_cleanup_counter = 0

def _maybe_cleanup_connect_records():
    global _connect_cleanup_counter
    _connect_cleanup_counter += 1
    if _connect_cleanup_counter >= 50:  # 每约 50 次连接清理一次
        _connect_cleanup_counter = 0
        now = time.time()
        cutoff = now - CONNECT_RATE_WINDOW * 2  # 保留两倍窗口
        expired = [ip for ip, rec in connect_records.items()
                   if not rec or rec[-1] < cutoff]
        for ip in expired:
            del connect_records[ip]

# 已登录 sid 集合 — 防止重复 login
_logged_in_sids: set[str] = set()

@sio.event
async def connect(sid, environ, auth):
    # 获取客户端 IP
    ip = environ.get("REMOTE_ADDR") or environ.get("HTTP_X_FORWARDED_FOR", "unknown").split(",")[0].strip()

    # 连接速率限制
    now = time.time()
    cutoff = now - CONNECT_RATE_WINDOW
    records = connect_records.setdefault(ip, [])
    records[:] = [t for t in records if t > cutoff]
    if len(records) >= CONNECT_RATE_MAX:
        print(f"[拒绝] IP {ip} 连接过于频繁")
        return False  # 拒绝连接
    records.append(now)
    _maybe_cleanup_connect_records()

    print(f"[连接] {sid[:8]}... | IP: {ip}")


@sio.event
async def disconnect(sid):
    _logged_in_sids.discard(sid)
    user = online_users.pop(sid, None)
    rate_limiter.cleanup(sid)
    if user:
        print(f"[断开] {user['username']} 离开了")
        await sio.emit("user:left", {
            "id": sid,
            "username": user["username"],
            "onlineCount": len(online_users),
        })
        await _broadcast_users()


@sio.on("user:login")
async def handle_login(sid, username):
    # 防止重复登录
    if sid in _logged_in_sids:
        return

    # 限流
    if not rate_limiter.check_sid(sid, "login", RATE_LIMIT_MAX_LOGINS, RATE_LIMIT_WINDOW):
        await sio.emit("user:login-error", {"error": "操作过于频繁，请稍后再试"}, to=sid)
        return

    # 净化与校验
    username = _sanitize_name(username or "")
    if not username:
        await sio.emit("user:login-error", {"error": "昵称不能为空"}, to=sid)
        return
    if len(username) > MAX_USERNAME_LEN:
        await sio.emit("user:login-error", {"error": f"昵称不能超过{MAX_USERNAME_LEN}个字符"}, to=sid)
        return

    # 检查昵称是否已被使用（本应用允许重名，但可根据需要开启）
    # for uid, uinfo in online_users.items():
    #     if uinfo["username"] == username and uid != sid:
    #         await sio.emit("user:login-error", {"error": "该昵称已被使用"}, to=sid)
    #         return

    color = _rand_color()
    online_users[sid] = {"username": username, "color": color}
    _logged_in_sids.add(sid)

    await sio.emit("user:logged-in", {
        "id": sid,
        "username": username,
        "color": color,
    }, to=sid)

    # 发送最近的历史消息
    if message_history:
        print(f"[历史] 向 {username} 推送 {len(message_history)} 条历史消息")
        await sio.emit("messages:history", list(message_history), to=sid)

    await sio.emit("user:joined", {
        "id": sid,
        "username": username,
        "color": color,
        "onlineCount": len(online_users),
    })

    await _broadcast_users()
    print(f"[登录] {username} 加入了 (在线: {len(online_users)})")


@sio.on("message:send")
async def handle_message(sid, data):
    user = online_users.get(sid)
    if not user:
        return

    # 限流
    if not rate_limiter.check_sid(sid, "msg", RATE_LIMIT_MAX_MSGS, RATE_LIMIT_WINDOW):
        await sio.emit("message:error", {"error": "发送过于频繁，请稍后再试"}, to=sid)
        return

    # 兼容旧格式：直接发字符串 → 当作 text
    if isinstance(data, str):
        data = {"type": "text", "content": data}

    if not isinstance(data, dict):
        return

    msg_type = data.get("type", "text")
    content = (data.get("content") or "").strip()

    # ── 文本消息 ──
    if msg_type == "text":
        if not content:
            return
        if len(content) > MAX_MSG_LEN:
            content = content[:MAX_MSG_LEN]
        msg = {
            "id": f"{int(time.time() * 1000)}-{_rand_suffix()}",
            "userId": sid,
            "username": user["username"],
            "color": user["color"],
            "content": content,
            "timestamp": int(time.time() * 1000),
            "type": "text",
        }

    # ── 图片消息 ──
    elif msg_type == "image":
        image_data = data.get("imageData", "")
        if not image_data or not image_data.startswith("data:image/"):
            return
        if len(image_data) > MAX_IMAGE_SIZE:
            await sio.emit("message:error", {"error": "图片不能超过 1MB"}, to=sid)
            return
        msg = {
            "id": f"{int(time.time() * 1000)}-{_rand_suffix()}",
            "userId": sid,
            "username": user["username"],
            "color": user["color"],
            "content": content or "图片",
            "imageData": image_data,
            "timestamp": int(time.time() * 1000),
            "type": "image",
        }

    # ── 文件消息 ──
    elif msg_type == "file":
        file_data = data.get("fileData", "")
        file_name = data.get("fileName", "未知文件") or "未知文件"
        file_size = data.get("fileSize", 0)
        if not file_data:
            return
        if len(file_data) > MAX_FILE_SIZE:
            await sio.emit("message:error", {"error": "文件不能超过 1MB"}, to=sid)
            return
        mime_type, _ = mimetypes.guess_type(file_name)
        msg = {
            "id": f"{int(time.time() * 1000)}-{_rand_suffix()}",
            "userId": sid,
            "username": user["username"],
            "color": user["color"],
            "content": file_name,
            "fileData": file_data,
            "fileSize": file_size,
            "mimeType": mime_type or "application/octet-stream",
            "timestamp": int(time.time() * 1000),
            "type": "file",
        }
    else:
        return

    message_history.append(msg)
    messages_by_id[msg["id"]] = msg  # 加入索引
    await sio.emit("message:new", msg)
    tag = msg_type
    print(f"[消息] {user['username']} [{tag}]: {content[:50]}  (历史共 {len(message_history)} 条)")


@sio.on("message:edit")
async def handle_edit(sid, data):
    """编辑消息 — 仅限发送者"""
    user = online_users.get(sid)
    if not user or not isinstance(data, dict):
        return
    msg_id = data.get("id", "")
    new_content = (data.get("content") or "").strip()
    if not msg_id or not new_content:
        return
    if len(new_content) > MAX_MSG_LEN:
        new_content = new_content[:MAX_MSG_LEN]

    msg = messages_by_id.get(msg_id)
    if not msg or msg["userId"] != sid:
        return  # 消息不存在或不属该用户

    msg["content"] = new_content
    msg["edited"] = True
    msg["timestamp"] = int(time.time() * 1000)
    await sio.emit("message:edited", {
        "id": msg_id,
        "content": new_content,
        "edited": True,
        "timestamp": msg["timestamp"],
    })
    print(f"[编辑] {user['username']} 编辑了消息: {new_content[:50]}")


@sio.on("message:delete")
async def handle_delete(sid, msg_id):
    """撤回消息 — 仅限发送者"""
    user = online_users.get(sid)
    if not user or not msg_id or not isinstance(msg_id, str):
        return

    msg = messages_by_id.get(msg_id)
    if not msg or msg["userId"] != sid:
        return

    # 标记删除（不从 history 移除，保留占位）
    msg["deleted"] = True
    await sio.emit("message:deleted", {"id": msg_id})
    print(f"[删除] {user['username']} 撤回了消息")


@sio.on("user:typing")
async def handle_typing(sid, is_typing):
    user = online_users.get(sid)
    if not user:
        return
    await sio.emit("user:typing", {
        "userId": sid,
        "username": user["username"],
        "isTyping": bool(is_typing),
    }, skip_sid=sid)


async def _broadcast_users():
    users = [
        {"id": sid, "username": info["username"], "color": info["color"]}
        for sid, info in online_users.items()
    ]
    await sio.emit("users:online", users)


# ── FastAPI 应用 ──
app = FastAPI(title="ChatRoom")

# CORS 安全配置 — 生产环境应改为具体域名
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],    # 开发环境可放开，生产环境改为 ["http://localhost:3000"]
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/static", StaticFiles(directory="public"), name="static")

socket_app = socketio.ASGIApp(sio, other_asgi_app=app)


@app.get("/")
async def index():
    return FileResponse("public/index.html")


@app.get("/debug/history")
async def debug_history():
    """调试用 — 查看当前历史消息数量"""
    return {"count": len(message_history)}


@app.get("/debug/config")
async def debug_config():
    """调试用 — 查看服务端配置"""
    return {
        "max_http_buffer_size": getattr(sio.eio, "max_http_buffer_size", "unknown"),
        "online_users": len(online_users),
        "history_count": len(message_history),
    }


# ── 安全头中间件 ──
@app.middleware("http")
async def add_security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["X-XSS-Protection"] = "1; mode=block"
    response.headers["Referrer-Policy"] = "no-referrer"
    return response


# ── 启动 ──
if __name__ == "__main__":
    import uvicorn
    print(f"\n  === ChatRoom Backend (FastAPI + Socket.IO) ===")
    print(f"  http://localhost:{PORT}\n")
    uvicorn.run(socket_app, host=HOST, port=PORT, log_level="warning")
