require('dotenv').config();
const express = require('express');
const http = require('http');
const cors = require('cors');
const { Server } = require('socket.io');

const app = express();
app.use(cors());
app.use(express.static('public'));
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: process.env.FRONTEND_ORIGIN || '*',
    methods: ['GET','POST']
  }
});

// In-memory rooms -> participants (simple)
const rooms = {}; // { roomName: { socketId: userId, ... } }

io.on('connection', socket => {
  console.log('socket connected', socket.id);

  socket.on('join-room', ({ room, userName }) => {
    socket.join(room);
    socket.data.userName = userName || 'Guest';
    // notify existing peers
    const clients = Array.from(io.sockets.adapter.rooms.get(room) || []);
    // send peers list to caller
    const otherClients = clients.filter(id => id !== socket.id);
    socket.emit('peers', otherClients);
    // notify others that a new peer joined
    socket.to(room).emit('peer-joined', { id: socket.id, userName: socket.data.userName });
    console.log(`${socket.id} joined ${room}`);
  });

  // signaling: offer, answer, ice-candidate
  socket.on('signal', ({ to, from, data }) => {
    if (!to) return;
    io.to(to).emit('signal', { from, data });
  });

  socket.on('send-chat', ({ room, message, name }) => {
    io.to(room).emit('chat-message', { from: socket.id, message, name, ts: Date.now() });
  });

  socket.on('emoji', ({ room, emoji }) => {
    io.to(room).emit('emoji', { emoji, from: socket.id });
  });

  socket.on('disconnecting', () => {
    const roomsJoined = Array.from(socket.rooms).filter(r => r !== socket.id);
    roomsJoined.forEach(room => {
      socket.to(room).emit('peer-left', { id: socket.id });
    });
  });

  socket.on('disconnect', () => {
    console.log('socket disconnected', socket.id);
  });
});

// Health
app.get('/health', (req, res) => res.json({ ok: true }));

// Serve on port
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server listening on ${PORT}`));
