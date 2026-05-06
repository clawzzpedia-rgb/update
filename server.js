const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

app.use(express.static(__dirname));
app.use(express.json());

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// ==== Simple auth (no DB) ====
const DATA_DIR = path.join(__dirname, 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');

function ensureDataFiles() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(USERS_FILE)) {
    fs.writeFileSync(USERS_FILE, JSON.stringify({ users: {}, __meta: { createdAt: new Date().toISOString() } }, null, 2));
  }
}

function readUsers() {
  ensureDataFiles();
  try {
    const raw = fs.readFileSync(USERS_FILE, 'utf8');
    return JSON.parse(raw);
  } catch {
    return { users: {}, __meta: { createdAt: new Date().toISOString() } };
  }
}

function writeUsers(payload) {
  ensureDataFiles();
  fs.writeFileSync(USERS_FILE, JSON.stringify(payload, null, 2));
}

function findUserByUsername(payload, username) {
  const u = (payload.users && payload.users[username]) || null;
  return u;
}

function normalizeUsername(username) {
  return String(username || '').trim();
}

// NOTE: ini demo sederhana. Password disimpan plaintext.
// Untuk production wajib pakai hash (bcrypt/argon2).
app.post('/api/register', (req, res) => {
  const username = normalizeUsername(req.body?.username);
  const password = String(req.body?.password || '');

  if (!username || username.length < 3) return res.status(400).json({ ok: false, error: 'Username minimal 3 karakter' });
  if (!password || password.length < 4) return res.status(400).json({ ok: false, error: 'Password minimal 4 karakter' });

  const data = readUsers();
  if (findUserByUsername(data, username)) {
    return res.status(409).json({ ok: false, error: 'Username sudah dipakai' });
  }

  data.users[username] = { username, password, createdAt: new Date().toISOString() };
  writeUsers(data);
  return res.json({ ok: true });
});

app.post('/api/login', (req, res) => {
  const username = normalizeUsername(req.body?.username);
  const password = String(req.body?.password || '');

  const data = readUsers();
  const user = findUserByUsername(data, username);
  if (!user || user.password !== password) {
    return res.status(401).json({ ok: false, error: 'Login gagal' });
  }

  // Token sederhana: base64(username:timestamp)
  const token = Buffer.from(`${username}:${Date.now()}`).toString('base64');
  return res.json({ ok: true, token, username });
});

app.post('/api/delete-account', (req, res) => {
  const username = normalizeUsername(req.body?.username);
  const password = String(req.body?.password || '');

  const data = readUsers();
  const user = findUserByUsername(data, username);
  if (!user || user.password !== password) {
    return res.status(401).json({ ok: false, error: 'Password salah' });
  }

  delete data.users[username];
  writeUsers(data);
  return res.json({ ok: true });
});

// ==== Realtime state ====
const users = new Map(); // socket.id => profile+position+status
const audioConnections = new Map(); // socket.id => isMicActive

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  // default room untuk chat/lokasi realtime
  socket.roomId = 'default';
  socket.join(socket.roomId);

  socket.on('join-room', (roomId) => {
    const rid = String(roomId || 'default');
    socket.roomId = rid;
    socket.join(rid);
  });

  // Auth handshake dari client (biar socket punya username)
  socket.on('auth', (payload) => {
    const username = normalizeUsername(payload?.username);
    if (!username) return;
    users.set(socket.id, { ...(users.get(socket.id) || {}), username });
    io.to(socket.roomId || 'default').emit('user-online', { userId: socket.id, username });
  });

  const broadcastOnlineCount = () => {
    const roomId = socket.roomId || 'default';
    const room = io.sockets.adapter.rooms.get(roomId);
    const count = room ? room.size : 0;
    io.to(roomId).emit('online-count', { count });
  };

  // Location tracking
  socket.on('location-update', (data) => {
    const prev = users.get(socket.id) || {};
    const next = {
      ...prev,
      lat: data.lat,
      lng: data.lng,
      accuracy: data.accuracy,
      speed: data.speed ?? null,
      roadName: data.roadName ?? null,
      timestamp: Date.now()
    };
    users.set(socket.id, next);

    io.to(socket.roomId || 'default').emit('user-location', {
      id: socket.id,
      ...next
    });
  });

  // Chat messages
  socket.on('chat-message', (msg) => {
    const text = String(msg || '').trim();
    if (!text) return;
    io.to(socket.roomId || 'default').emit('chat-message', {
      id: socket.id,
      username: users.get(socket.id)?.username || 'Anonymous',
      message: text,
      timestamp: Date.now()
    });
  });

  // Battery updates
  socket.on('battery-update', (data) => {
    const level = typeof data?.level === 'number' ? data.level : null;
    const charging = !!data?.charging;
    const prev = users.get(socket.id) || {};
    users.set(socket.id, { ...prev, battery: { level, charging, timestamp: Date.now() } });
    io.to(socket.roomId || 'default').emit('battery-status', { userId: socket.id, battery: users.get(socket.id).battery });
  });

  // Audio control
  socket.on('audio-toggle', (isActive) => {
    audioConnections.set(socket.id, !!isActive);
    io.to(socket.roomId || 'default').emit('audio-status-update', {
      userId: socket.id,
      isActive: !!isActive
    });
  });

  // Audio stream (WebRTC signaling)
  socket.on('offer', (data) => {
    socket.to(data.target).emit('offer', {
      offer: data.offer,
      sender: socket.id
    });
  });

  socket.on('answer', (data) => {
    socket.to(data.target).emit('answer', {
      answer: data.answer,
      sender: socket.id
    });
  });

  socket.on('ice-candidate', (data) => {
    socket.to(data.target).emit('ice-candidate', {
      candidate: data.candidate,
      sender: socket.id
    });
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
    users.delete(socket.id);
    audioConnections.delete(socket.id);
    io.to(socket.roomId || 'default').emit('user-disconnected', socket.id);
    broadcastOnlineCount();
  });

  // hitung online setelah connect
  broadcastOnlineCount();
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
