// ===============================
//  AnantKripa Signaling Server (FIXED)
// ===============================

const express = require("express");
const app = express();
const http = require("http").createServer(app);

app.use(express.static("public"));   // ⭐ FIX #1 — SERVE PUBLIC FILES

const io = require("socket.io")(http, {
  cors: { origin: "*" }
});

let rooms = {};

io.on("connection", (socket) => {

  console.log("User connected:", socket.id);

  // ---------------------------
  // Guest Waiting Room
  // ---------------------------
  socket.on("join-request", ({ room, userName }) => {

    if (!rooms[room]) {
      rooms[room] = {
        host: null,
        waiting: [],
        users: {}
      };
    }

    rooms[room].waiting.push({ id: socket.id, name: userName });

    if (rooms[room].host) {
      io.to(rooms[room].host).emit("waiting-user", rooms[room].waiting);
    }
  });

  // ---------------------------
  // Host or Approved Guest Joins
  // ---------------------------
  socket.on("join-room", ({ room, userName, host }) => {

    if (!rooms[room]) {
      rooms[room] = { host: null, waiting: [], users: {} };
    }

    if (host) rooms[room].host = socket.id;

    rooms[room].users[socket.id] = { name: userName, isHost: !!host };

    socket.join(room);

    const peerIds = Object.keys(rooms[room].users).filter(id => id !== socket.id);
    socket.emit("peers", peerIds);

    socket.to(room).emit("peer-joined", {
      id: socket.id,
      userName,
      isHost: !!host
    });

    console.log(`${userName} joined → ${room}`);
  });

  // ---------------------------
  // Host approves all guests
  // ---------------------------
  socket.on("approve-all", (room) => {

    if (!rooms[room]) return;

    rooms[room].waiting.forEach(g => {
      io.to(g.id).emit("approved", room);
    });

    rooms[room].waiting = [];

    io.to(rooms[room].host).emit("waiting-user", []);
  });

  // ---------------------------
  // WebRTC Signaling
  // ---------------------------
  socket.on("signal", ({ to, data }) => {
    io.to(to).emit("signal", { from: socket.id, data });
  });

  // ---------------------------
  // Chat
  // ---------------------------
  socket.on("send-chat", ({ room, message }) => {
    const user = rooms[room]?.users[socket.id]?.name || "User";
    io.to(room).emit("chat", { name: user, message });
  });

  // ---------------------------
  // Emoji
  // ---------------------------
  socket.on("send-emoji", ({ room, emoji }) => {
    const user = rooms[room]?.users[socket.id]?.name || "User";
    io.to(room).emit("emoji", { name: user, emoji });
  });

  // ---------------------------
  // Leave room
  // ---------------------------
  socket.on("leave-room", (room) => {
    handleLeave(socket, room);
  });

  // ---------------------------
  // Disconnect
  // ---------------------------
  socket.on("disconnect", () => {

    for (const room in rooms) {
      if (rooms[room].users[socket.id]) {
        handleLeave(socket, room);
      }
    }
  });

  function handleLeave(socket, room) {

    if (!rooms[room]) return;

    delete rooms[room].users[socket.id];

    socket.to(room).emit("peer-left", { id: socket.id });

    if (rooms[room].host === socket.id) {
      io.to(room).emit("meeting-ended");
      delete rooms[room];
      console.log("Meeting ended:", room);
    }

    socket.leave(room);
  }
});

http.listen(3000, () => {
  console.log("🚀 Server running on http://localhost:3000");
});
