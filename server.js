// server.js
// AnantKripa Signaling Server (Express + Socket.io)
// Run with: node server.js
// Make sure `public/meeting.html` exists and socket.io client is loaded from /socket.io/socket.io.js

const express = require("express");
const path = require("path");
const app = express();
const http = require("http").createServer(app);
const io = require("socket.io")(http, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});

app.use(express.static(path.join(__dirname, "public")));

// Simple health route
app.get("/health", (req, res) => res.json({ ok: true }));

/**
 rooms structure:
 rooms = {
   roomId: {
     host: socketId | null,
     waiting: [{ id, name }],
     users: { socketId: { name, isHost } }
   }
 }
*/
const rooms = {};

io.on("connection", (socket) => {
  console.log("socket connected:", socket.id);

  // Guest asks to join -> goes to waiting room
  socket.on("join-request", ({ room, userName }) => {
    if (!room) return;
    if (!rooms[room]) rooms[room] = { host: null, waiting: [], users: {} };

    // Add to waiting (avoid duplicates)
    rooms[room].waiting = rooms[room].waiting.filter(w => w.id !== socket.id);
    rooms[room].waiting.push({ id: socket.id, name: userName || "Guest" });

    // Notify host about waiting users
    if (rooms[room].host) {
      io.to(rooms[room].host).emit("waiting-user", rooms[room].waiting);
    }
    console.log(`[${room}] join-request from ${userName || 'Guest'} (${socket.id})`);
  });

  // When host or approved user joins room
  socket.on("join-room", ({ room, userName, host }) => {
    if (!room) return;
    if (!rooms[room]) rooms[room] = { host: null, waiting: [], users: {} };

    if (host) {
      rooms[room].host = socket.id;
    }

    // Add to users map
    rooms[room].users[socket.id] = { name: userName || "Guest", isHost: !!host };
    socket.join(room);

    // Build peers metadata to send back (send array of objects)
    const peers = Object.keys(rooms[room].users)
      .filter(id => id !== socket.id)
      .map(id => ({ id, userName: rooms[room].users[id].name, isHost: !!rooms[room].users[id].isHost }));

    socket.emit("peers", peers);

    // Notify other room members about this new peer
    socket.to(room).emit("peer-joined", {
      id: socket.id,
      userName: userName || "Guest",
      isHost: !!host
    });

    // Host should also know about waiting list when he joins
    if (rooms[room].host) {
      io.to(rooms[room].host).emit("waiting-user", rooms[room].waiting);
    }

    console.log(`[${room}] joined: ${userName || 'Guest'} (${socket.id}) host=${!!host}`);
  });

  // Approve all waiting users (host action)
  socket.on("approve-all", (room) => {
    if (!rooms[room]) return;
    if (rooms[room].host !== socket.id) return; // only host
    // notify each waiting socket
    for (const g of rooms[room].waiting) {
      io.to(g.id).emit("approved", room);
    }
    rooms[room].waiting = [];
    // update host waiting list
    io.to(rooms[room].host).emit("waiting-user", []);
  });

  // Signaling: relay SDP/ICE between peers
  socket.on("signal", ({ to, data }) => {
    if (!to) return;
    io.to(to).emit("signal", { from: socket.id, data });
  });

  // Chat message
  socket.on("send-chat", ({ room, message }) => {
    if (!room) return;
    const sender = rooms[room]?.users[socket.id]?.name || "User";
    io.to(room).emit("chat", { name: sender, message });
  });

  // Emoji/reaction
  socket.on("send-emoji", ({ room, emoji }) => {
    if (!room) return;
    const sender = rooms[room]?.users[socket.id]?.name || "User";
    io.to(room).emit("emoji", { name: sender, emoji });
  });

  // Leave room (explicit)
  socket.on("leave-room", (room) => {
    if (!room) return;
    handleDisconnectFromRoom(socket, room);
  });

  // Handle socket disconnect
  socket.on("disconnect", () => {
    // find rooms that include this socket in users or waiting
    for (const roomName of Object.keys(rooms)) {
      const r = rooms[roomName];
      if (!r) continue;

      // remove from waiting
      r.waiting = r.waiting.filter(w => w.id !== socket.id);

      if (r.users[socket.id]) {
        // remove user
        const wasHost = (r.host === socket.id);
        const userMeta = r.users[socket.id];
        delete r.users[socket.id];

        // notify other peers
        socket.to(roomName).emit("peer-left", { id: socket.id });

        // if host left -> end meeting and clean up room
        if (wasHost) {
          io.to(roomName).emit("meeting-ended");
          // notify everyone and delete room
          delete rooms[roomName];
          console.log(`Meeting ended (host left): ${roomName}`);
        } else {
          // if no users and no waiting and no host -> cleanup
          const hasUsers = Object.keys(r.users).length > 0;
          const hasWaiting = r.waiting.length > 0;
          if (!hasUsers && !hasWaiting && (!r.host || r.host === null)) {
            delete rooms[roomName];
          } else {
            // update host with waiting list if host still present
            if (r.host) io.to(r.host).emit("waiting-user", r.waiting);
          }
        }
      }
    }
  });

  // helper
  function handleDisconnectFromRoom(socket, room) {
    if (!rooms[room]) return;
    // remove from waiting
    rooms[room].waiting = rooms[room].waiting.filter(w => w.id !== socket.id);
    // remove user if present
    if (rooms[room].users[socket.id]) {
      const wasHost = rooms[room].host === socket.id;
      delete rooms[room].users[socket.id];
      socket.to(room).emit("peer-left", { id: socket.id });

      if (wasHost) {
        io.to(room).emit("meeting-ended");
        delete rooms[room];
      } else {
        if (rooms[room].host) io.to(rooms[room].host).emit("waiting-user", rooms[room].waiting);
      }
    }
    socket.leave(room);
  }

});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => console.log(`🚀 Signaling Server running on port ${PORT}`));
