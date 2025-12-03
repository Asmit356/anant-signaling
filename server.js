// ===============================
//  AnantKripa Signaling Server
// ===============================

const express = require("express");
const app = express();
const http = require("http").createServer(app);
const io = require("socket.io")(http, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});

let rooms = {};  
// rooms = {
//   roomName: {
//     host: socketId,
//     approved: [socketIds],
//     waiting: [{id, name}],
//     users: { socketId: {name, isHost} }
//   }
// };

io.on("connection", (socket) => {

  console.log("User connected:", socket.id);

  // -------------------------------------
  // Guest requests to join
  // -------------------------------------
  socket.on("join-request", ({ room, userName }) => {
    console.log(`[${room}] join-request from ${userName}`);

    if (!rooms[room]) {
      rooms[room] = {
        host: null,
        approved: [],
        waiting: [],
        users: {}
      };
    }

    rooms[room].waiting.push({ id: socket.id, name: userName });

    // Notify host
    if (rooms[room].host) {
      io.to(rooms[room].host).emit("waiting-user", rooms[room].waiting);
    }
  });

  // -------------------------------------
  // Host joins the room
  // -------------------------------------
  socket.on("join-room", ({ room, userName, host }) => {

    if (!rooms[room]) {
      rooms[room] = {
        host: null,
        approved: [],
        waiting: [],
        users: {}
      };
    }

    // Set host
    if (host) rooms[room].host = socket.id;

    rooms[room].users[socket.id] = { name: userName, isHost: !!host };

    socket.join(room);

    // Send peers list
    const peers = Object.keys(rooms[room].users).filter(id => id !== socket.id);
    socket.emit("peers", peers);

    // Notify others
    socket.to(room).emit("peer-joined", {
      id: socket.id,
      userName,
      isHost: !!host
    });

    console.log(`[${room}] ${userName} joined (Host: ${host})`);
  });

  // -------------------------------------
  // APPROVE ALL WAITING USERS
  // -------------------------------------
  socket.on("approve-all", (room) => {
    if (!rooms[room]) return;

    rooms[room].waiting.forEach(g => {
      io.to(g.id).emit("approved", room);
    });

    rooms[room].waiting = [];

    // Update host UI
    io.to(rooms[room].host).emit("waiting-user", []);
  });

  // -------------------------------------
  // SIGNALING (WebRTC)
  // -------------------------------------
  socket.on("signal", ({ to, data }) => {
    io.to(to).emit("signal", { from: socket.id, data });
  });

  // -------------------------------------
  // CHAT
  // -------------------------------------
  socket.on("send-chat", ({ room, message }) => {
    const sender = rooms[room]?.users[socket.id]?.name || "User";
    io.to(room).emit("chat", { name: sender, message });
  });

  // -------------------------------------
  // EMOJI
  // -------------------------------------
  socket.on("send-emoji", ({ room, emoji }) => {
    const sender = rooms[room]?.users[socket.id]?.name || "User";
    io.to(room).emit("emoji", { name: sender, emoji });
  });

  // -------------------------------------
  // LEAVE ROOM
  // -------------------------------------
  socket.on("leave-room", (room) => {
    handleDisconnect(socket, room);
  });

  // -------------------------------------
  // DISCONNECT
  // -------------------------------------
  socket.on("disconnect", () => {
    for (const room in rooms) {
      if (rooms[room].users[socket.id]) {
        handleDisconnect(socket, room);
      }
    }
  });

  function handleDisconnect(socket, room) {
    if (!rooms[room]) return;

    const user = rooms[room].users[socket.id];
    delete rooms[room].users[socket.id];

    socket.to(room).emit("peer-left", { id: socket.id });

    // If HOST leaves → end meeting
    if (rooms[room].host === socket.id) {
      io.to(room).emit("meeting-ended");
      delete rooms[room];
      console.log(`Meeting ended: ${room}`);
    }

    socket.leave(room);
  }
});

http.listen(3000, () => {
  console.log("🚀 Signaling Server Running on port 3000");
});
