/* ═══════════════════════════════════════════════════
   AuraChat — Client
   ═══════════════════════════════════════════════════ */

// ── DOM ──
const qs = (s, p) => (p || document).querySelector(s);
const qa = (s, p) => [...(p || document).querySelectorAll(s)];

const loginScreen = qs('#login-screen');
const chatScreen = qs('#chat-screen');
const usernameInput = qs('#username-input');
const loginBtn = qs('#login-btn');
const loginError = qs('#login-error');
const swatches = qa('.swatch');
const meAvatar = qs('#me-avatar');
const meName = qs('#me-name');
const msgInput = qs('#msg-input');
const sendBtn = qs('#send-btn');
const msgList = qs('#msg-list');
const messages = qs('#messages');
const welcome = qs('#welcome');
const sideBody = qs('#side-body');
const onlineCount = qs('#online-count');
const sideCount = qs('#side-count');
const typing = qs('#typing');
const typingName = qs('#typing-name');
const logoutBtn = qs('#logout-btn');
const fileBtn = qs('#file-btn');
const filePicker = qs('#file-picker');

// ── State ──
let socket = null;
let me = null;
let accent = '#6366F1';
let accentH = '#06B6D4';
let typingTimer = null;
let isTyping = false;

// ── Theme Swatches ──
swatches.forEach(s => {
  s.addEventListener('click', () => {
    swatches.forEach(x => x.classList.remove('active'));
    s.classList.add('active');
    accent = s.dataset.color;
    accentH = s.dataset.h;
    applyTheme(accent, accentH);
  });
});

function applyTheme(a, b) {
  const root = document.documentElement;
  root.style.setProperty('--a', a);
  root.style.setProperty('--a-hover', a);
  root.style.setProperty('--a-glow', a + '33');
  root.style.setProperty('--a-gradient', `linear-gradient(135deg, ${a}, ${b})`);
}

// ── Socket ──
function initSocket() {
  socket = io({ transports: ['websocket', 'polling'] });

  socket.on('user:logged-in', u => {
    me = u;
    meAvatar.textContent = u.username.charAt(0).toUpperCase();
    meAvatar.style.background = u.color;
    meName.textContent = u.username;
    enterChat();
  });

  socket.on('user:login-error', err => {
    loginError.textContent = err.error;
    loginBtn.disabled = false;
    loginBtn.innerHTML = `<span>进入聊天</span>
      <svg viewBox="0 0 20 20" width="16" height="16"><path d="M4 10h12M11 4l6 6-6 6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  });

  socket.on('user:joined', d => { addSys(`${d.username} 加入了聊天`, '🎉'); });
  socket.on('user:left', d => { addSys(`${d.username} 离开了聊天`, '👋'); updateCount(d.onlineCount); });

  // 历史消息 — 登录后收到，批量渲染
  socket.on('messages:history', msgs => {
    if (!msgs || msgs.length === 0) return;
    welcome?.classList.add('hidden');
    // 用文档片段批量插入，避免反复重排
    const frag = document.createDocumentFragment();
    for (const m of msgs) frag.appendChild(buildMsgEl(m));
    msgList.appendChild(frag);
    scrollDown();
  });

  socket.on('message:new', m => renderMsg(m));
  socket.on('message:error', err => addSys(err.error, '⚠️'));
  socket.on('message:edited', d => handleEdited(d));
  socket.on('message:deleted', d => handleDeleted(d));

  socket.on('users:online', users => {
    renderUsers(users);
    updateCount(users.length);
  });

  socket.on('user:typing', d => {
    if (d.userId !== socket.id) showTyping(d.username, d.isTyping);
  });

  socket.on('disconnect', () => addSys('连接已断开，正在重连…', '🔌'));
  socket.on('connect', () => { if (me) socket.emit('user:login', me.username); });
}

// ── Login ──
function handleLogin() {
  const name = usernameInput.value.trim();
  if (!name) { loginError.textContent = '请输入昵称'; usernameInput.focus(); return; }
  if (name.length > 20) { loginError.textContent = '昵称不能超过20个字符'; return; }
  loginError.textContent = '';
  loginBtn.disabled = true;
  loginBtn.innerHTML = '<span>连接中…</span>';
  if (!socket) initSocket();
  socket.emit('user:login', name);
}

function enterChat() {
  loginScreen.classList.add('hidden');
  chatScreen.classList.remove('hidden');
  chatScreen.style.display = 'flex';
  loginBtn.disabled = false;
  loginBtn.innerHTML = `<span>进入聊天</span>
    <svg viewBox="0 0 20 20" width="16" height="16"><path d="M4 10h12M11 4l6 6-6 6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  msgInput.focus();
}

// ── Render Message ──

/** 构建单条消息 DOM 元素（不插入文档） */
function buildMsgEl(m) {
  const isSelf = m.userId === (me?.id || socket?.id);
  const el = document.createElement('div');
  el.className = `msg ${isSelf ? 'msg-self' : 'msg-other'}`;
  el.dataset.msgId = m.id;
  const initial = m.username.charAt(0).toUpperCase();
  const time = new Date(m.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });

  // 已撤回
  if (m.deleted) {
    el.innerHTML = `
      <div class="msg-av" style="background:${m.color}">${initial}</div>
      <div class="msg-body">
        <div class="msg-name" style="color:${m.color}">${esc(m.username)}</div>
        <div class="msg-bub deleted-bub"><span class="deleted-text">${esc(m.username)} 撤回了消息</span></div>
      </div>`;
    return el;
  }

  // 图片消息
  let bubbleContent;
  if (m.type === 'image' && m.imageData) {
    bubbleContent = `
      <div class="msg-bub" style="padding:6px;overflow:hidden">
        <img class="msg-img" src="${esc(m.imageData)}" alt="${esc(m.content)}"
             onclick="this.classList.toggle('msg-img-full')">
      </div>`;
  } else if (m.type === 'file' && m.fileData) {
    const icon = getFileIcon(m.content);
    const size = m.fileSize ? fmtSize(m.fileSize) : '';
    bubbleContent = `
      <div class="msg-bub file-bub" onclick="downloadFile('${esc(m.fileData)}','${esc(m.content)}')">
        <span class="file-icon">${icon}</span>
        <span class="file-info">
          <span class="file-name">${esc(m.content)}</span>
          ${size ? `<span class="file-size">${size}</span>` : ''}
        </span>
        <span class="file-dl">⬇</span>
      </div>`;
  } else {
    const editedLabel = m.edited ? ' <span class="edited-tag">已编辑</span>' : '';
    bubbleContent = `<div class="msg-bub">${esc(m.content)}${editedLabel}</div>`;
  }

  // 自己消息的操作按钮
  const actions = isSelf && !m.deleted ? `
    <div class="msg-actions">
      <button class="msg-action" onclick="editMsg('${esc(m.id)}')" title="编辑">✏</button>
      <button class="msg-action" onclick="deleteMsg('${esc(m.id)}')" title="撤回">🗑</button>
    </div>` : '';

  el.innerHTML = `
    <div class="msg-av" style="background:${m.color}">${initial}</div>
    <div class="msg-body">
      <div class="msg-name" style="color:${m.color}">${esc(m.username)}</div>
      ${bubbleContent}
      ${actions}
      <div class="msg-time">${time}</div>
    </div>`;
  return el;
}

function renderMsg(m) {
  welcome?.classList.add('hidden');
  msgList.appendChild(buildMsgEl(m));
  scrollDown();
}

// ── System Message ──
function addSys(text, icon = '') {
  const el = document.createElement('div');
  el.className = 'sys-msg';
  el.innerHTML = `<span class="sys-msg-inner">${icon} ${esc(text)}</span>`;
  msgList.appendChild(el);
  scrollDown();
}

// ── Users ──
function renderUsers(users) {
  sideBody.innerHTML = '';
  for (const u of users) {
    const isSelf = u.id === (me?.id || socket?.id);
    const el = document.createElement('div');
    el.className = 'user-row';
    const initial = u.username.charAt(0).toUpperCase();
    el.innerHTML = `
      <div class="user-dot" style="background:${u.color}"></div>
      <span class="user-name">${esc(u.username)}</span>
      ${isSelf ? '<span class="user-tag">我</span>' : ''}`;
    sideBody.appendChild(el);
  }
}

function updateCount(n) {
  onlineCount.textContent = n;
  sideCount.textContent = n;
}

// ── Typing ──
function showTyping(name, on) {
  if (on) {
    typingName.textContent = `${name} 正在输入…`;
    typing.classList.remove('hidden');
  } else {
    typing.classList.add('hidden');
  }
}

// ── Send (文本 + 图片) ──
function sendMsg() {
  const content = msgInput.value.trim();
  if (!content || !socket) return;
  socket.emit('message:send', { type: 'text', content });
  msgInput.value = '';
  sendBtn.disabled = true;
  if (isTyping) { isTyping = false; socket.emit('user:typing', false); }
}

/** 发送文件（自动区分图片/普通文件） */
function sendFile(file) {
  if (!socket) return;
  const maxSize = 1;
  if (file.size > maxSize * 1024 * 1024) {
    alert(`文件不能超过 ${maxSize}MB`);
    return;
  }
  // 粘贴图片时给个即时反馈
  if (file.type.startsWith('image/')) {
    msgInput.placeholder = '正在上传图片...';
    msgInput.disabled = true;
  }
  const reader = new FileReader();
  reader.onload = e => {
    const payload = { type: 'text', content: file.name };
    if (file.type.startsWith('image/')) {
      payload.type = 'image';
      payload.imageData = e.target.result;
    } else {
      payload.type = 'file';
      payload.fileData = e.target.result;
      payload.fileName = file.name;
      payload.fileSize = file.size;
    }
    socket.emit('message:send', payload);
    // 恢复输入框
    msgInput.placeholder = '写点什么...  (Ctrl+V 粘贴)';
    msgInput.disabled = false;
    msgInput.focus();
  };
  reader.onerror = () => {
    msgInput.placeholder = '写点什么...  (Ctrl+V 粘贴)';
    msgInput.disabled = false;
    alert('图片读取失败，请重试');
  };
  reader.readAsDataURL(file);
}

/** 处理粘贴 — 仅在聊天界面下才捕获图片粘贴 */
function handlePaste(e) {
  if (!socket || !me) return;  // 不在聊天界面则忽略
  const items = e.clipboardData?.items;
  if (!items) return;
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item.type.startsWith('image/')) {
      e.preventDefault();
      const file = item.getAsFile();
      if (!file) {
        // 备用方案：从 clipboardData.files 读取
        const cf = e.clipboardData.files;
        if (cf.length) sendFile(cf[0]);
        return;
      }
      sendFile(file);
      return;
    }
  }
}

// 全局粘贴 — 即使用户焦点不在输入框也能捕获
document.addEventListener('paste', handlePaste);

// ── 编辑/撤回 ──

/** 编辑消息：显示行内编辑框 */
window.editMsg = function(msgId) {
  const el = document.querySelector(`[data-msg-id="${esc(msgId)}"]`);
  if (!el) return;
  const bub = el.querySelector('.msg-bub');
  if (!bub || bub.classList.contains('editing')) return;
  const oldText = bub.textContent.replace('已编辑', '').trim();
  bub.classList.add('editing');
  bub.innerHTML = `
    <div class="edit-inline">
      <input type="text" class="edit-input" value="${esc(oldText)}" maxlength="500" autofocus>
      <div class="edit-actions">
        <button class="edit-cancel" onclick="cancelEdit('${esc(msgId)}')">取消</button>
        <button class="edit-save" onclick="saveEdit('${esc(msgId)}')">保存</button>
      </div>
    </div>`;
  const inp = bub.querySelector('.edit-input');
  inp.focus();
  inp.setSelectionRange(inp.value.length, inp.value.length);
  inp.addEventListener('keydown', e => {
    if (e.key === 'Enter') saveEdit(msgId);
    if (e.key === 'Escape') cancelEdit(msgId);
  });
};

/** 取消编辑 */
window.cancelEdit = function(msgId) {
  const el = document.querySelector(`[data-msg-id="${esc(msgId)}"]`);
  if (!el) return;
  const bub = el.querySelector('.msg-bub');
  if (bub) {
    bub.classList.remove('editing');
    bub.innerHTML = '已取消';
    bub.style.fontSize = '12px';
    bub.style.color = 'var(--text-muted)';
  }
};

/** 保存编辑 */
window.saveEdit = function(msgId) {
  const el = document.querySelector(`[data-msg-id="${esc(msgId)}"]`);
  if (!el) return;
  const inp = el.querySelector('.edit-input');
  if (!inp) return;
  const content = inp.value.trim();
  if (!content) return;
  socket.emit('message:edit', { id: msgId, content });
  // 本地立即更新，服务端回传时覆盖
  const bub = el.querySelector('.msg-bub');
  if (bub) {
    bub.classList.remove('editing');
    bub.innerHTML = esc(content) + ' <span class="edited-tag">已编辑</span>';
  }
};

/** 撤回消息 */
window.deleteMsg = function(msgId) {
  if (!confirm('确定撤回这条消息？')) return;
  socket.emit('message:delete', msgId);
  // 本地立即标记
  const el = document.querySelector(`[data-msg-id="${esc(msgId)}"]`);
  if (el) {
    const name = (el.querySelector('.msg-name')?.textContent || '用户').trim();
    const body = el.querySelector('.msg-body');
    if (body) body.innerHTML = `
      <div class="msg-name" style="color:var(--text-muted)"></div>
      <div class="msg-bub deleted-bub"><span class="deleted-text">${esc(name)} 撤回了消息</span></div>`;
    const actions = el.querySelector('.msg-actions');
    if (actions) actions.remove();
  }
};

/** 服务端回传编辑确认 */
function handleEdited(d) {
  const el = document.querySelector(`[data-msg-id="${esc(d.id)}"]`);
  if (!el) return;
  const bub = el.querySelector('.msg-bub');
  if (bub && !bub.classList.contains('editing')) {
    bub.innerHTML = esc(d.content) + ' <span class="edited-tag">已编辑</span>';
  }
  // 更新历史消息中的数据（供下次重新渲染）
}

/** 服务端回传删除确认 */
function handleDeleted(d) {
  const el = document.querySelector(`[data-msg-id="${esc(d.id)}"]`);
  if (!el) return;
  const name = (el.querySelector('.msg-name')?.textContent || '用户').trim();
  const body = el.querySelector('.msg-body');
  if (body) body.innerHTML = `
    <div class="msg-name" style="color:var(--text-muted)"></div>
    <div class="msg-bub deleted-bub"><span class="deleted-text">${esc(name)} 撤回了消息</span></div>`;
  const actions = el.querySelector('.msg-actions');
  if (actions) actions.remove();
}
function scrollDown() { requestAnimationFrame(() => { messages.scrollTop = messages.scrollHeight; }); }
function esc(t) { const d = document.createElement('div'); d.textContent = t; return d.innerHTML; }

/** 根据文件名返回文件图标 emoji */
function getFileIcon(name) {
  const ext = name.split('.').pop()?.toLowerCase();
  if (/pdf/.test(ext)) return '📄';
  if (/zip|rar|7z|tar|gz/.test(ext)) return '📦';
  if (/doc|docx/.test(ext)) return '📝';
  if (/xls|xlsx|csv/.test(ext)) return '📊';
  if (/ppt|pptx/.test(ext)) return '📽';
  if (/mp3|wav|flac|aac|ogg/.test(ext)) return '🎵';
  if (/mp4|avi|mkv|mov|wmv/.test(ext)) return '🎬';
  if (/txt|log|md/.test(ext)) return '📃';
  if (/js|ts|py|java|cpp|c|go|rs|rb|php/.test(ext)) return '💻';
  return '📎';
}
/** 格式化文件大小 */
function fmtSize(bytes) {
  if (bytes < 1024) return bytes + 'B';
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + 'KB';
  return (bytes / 1048576).toFixed(1) + 'MB';
}
/** 下载文件（全局，供 onclick 调用） */
window.downloadFile = function(dataUrl, fileName) {
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
};

// ── Events ──
usernameInput.addEventListener('keydown', e => { if (e.key === 'Enter') handleLogin(); });
loginBtn.addEventListener('click', handleLogin);

msgInput.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMsg(); }
});

msgInput.addEventListener('input', () => {
  sendBtn.disabled = !msgInput.value.trim();
  if (!isTyping && socket) { isTyping = true; socket.emit('user:typing', true); }
  clearTimeout(typingTimer);
  typingTimer = setTimeout(() => {
    if (isTyping && socket) { isTyping = false; socket.emit('user:typing', false); }
  }, 1000);
});

sendBtn.addEventListener('click', sendMsg);

// ── 文件上传 ──
fileBtn.addEventListener('click', () => filePicker.click());
filePicker.addEventListener('change', () => {
  for (const f of filePicker.files) sendFile(f);
  filePicker.value = '';
});

logoutBtn.addEventListener('click', () => {
  if (!confirm('确定退出聊天室？')) return;
  socket?.disconnect();
  me = null;
  msgList.innerHTML = '';
  welcome?.classList.remove('hidden');
  sideBody.innerHTML = '';
  onlineCount.textContent = '0';
  sideCount.textContent = '0';
  chatScreen.classList.add('hidden');
  chatScreen.style.display = '';
  loginScreen.classList.remove('hidden');
  usernameInput.value = '';
  usernameInput.focus();
});

// ── Start ──
usernameInput.focus();
