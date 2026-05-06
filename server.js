const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

app.use(express.static(__dirname));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

const users = new Map();
const audioConnections = new Map();

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  // Join room (optional - bisa pakai room untuk group)
  socket.on('join-room', (roomId) => {
    socket.join(roomId);
    socket.roomId = roomId;
  });

  // Location tracking
  socket.on('location-update', (data) => {
    users.set(socket.id, {
      ...users.get(socket.id),
      lat: data.lat,
      lng: data.lng,
      accuracy: data.accuracy,
      timestamp: Date.now()
    });
    
    // Broadcast to all users in room
    socket.to(socket.roomId || 'default').emit('user-location', {
      id: socket.id,
      ...users.get(socket.id)
    });
    
    // Broadcast to all users
    socket.broadcast.emit('user-location', {
      id: socket.id,
      ...users.get(socket.id)
    });
  });

  // Chat messages
  socket.on('chat-message', (msg) => {
    io.to(socket.roomId || 'default').emit('chat-message', {
      id: socket.id,
      username: users.get(socket.id)?.username || 'Anonymous',
      message: msg,
      timestamp: Date.now()
    });
  });

  // Audio control
  socket.on('audio-toggle', (isActive) => {
    audioConnections.set(socket.id, isActive);
    
    // Notify all users
    io.emit('audio-status-update', {
      userId: socket.id,
      isActive: isActive
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

  socket.on('set-username', (username) => {
    if (users.has(socket.id)) {
      users.set(socket.id, {
        ...users.get(socket.id),
        username
      });
    }
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
    users.delete(socket.id);
    audioConnections.delete(socket.id);
    io.emit('user-disconnected', socket.id);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});