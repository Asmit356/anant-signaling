// =========================================
//  🚀 AnantKripa WebRTC Signaling Server
// =========================================

const express = require("express");
const path = require("path");
const app = express();

const http = require("http").createServer(app);
const io = require("socket.io")(http, {
  cors: { origin: "*" }
});

// Serve static files (meeting.html, assets, etc.)
app.use(express.static(path.join(__dirname, "public")));

// Test route
app.get("/", (req, res) => {
  res.send("🔥 AnantKripa Meet Signaling Server is Running...");
});

// Rooms structure
let rooms = {};
// rooms = {
//   roomName: {
//     host: socketId,
//     waiting: [{id, name}],
//     users: { socketId: {name, isHost} }
//   }
// };

io.on("connection", (socket) => {
  console.log("⚡ User connected:", socket.id);

  // -------------------------------
  // Guest requests to join a room
  // -------------------------------
  socket.on("join-request", ({ room, userName }) => {

    if (!rooms[room]) {
      rooms[room] = {
        host: null,
        waiting: [],
        users: {}
      };
    }

    // Guest goes to waiting room
    rooms[room].waiting.push({ id: socket.id, name: userName });

    // Notify host if exists
    if (rooms[room].host) {
      io.to(rooms[room].host).emit("waiting-user", rooms[room].waiting);
    }

    console.log(`👤 Guest requested to join room: ${room}`);
  });

  // -------------------------------
  // Host or approved guest joins
  // -------------------------------
  socket.on("join-room", ({ room, userName, host }) => {

    if (!rooms[room]) {
      rooms[room] = {
        host: null,
        waiting: [],
        users: {}
      };
    }

    // Mark host
    if (host) {
      rooms[room].host = socket.id;
    }

    rooms[room].users[socket.id] = { name: userName, isHost: !!host };
    socket.join(room);

    // Send list of existing peers to this new user
    const peers = Object.keys(rooms[room].users).filter(id => id !== socket.id);
    socket.emit("peers", peers);

    // Notify others in the room
    socket.to(room).emit("peer-joined", {
      id: socket.id,
      userName,
      isHost: !!host
    });

    console.log(`✅ ${userName} joined room: ${room} (Host: ${host})`);
  });

  // -------------------------------
  // Host approves all waiting users
  // -------------------------------
  socket.on("approve-all", (room) => {
    if (!rooms[room]) return;

    rooms[room].waiting.forEach(g => {
      io.to(g.id).emit("approved", room);
    });

    rooms[room].waiting = [];

    // Update host waiting UI
    io.to(rooms[room].host).emit("waiting-user", []);
  });

  // -------------------------------
  // WebRTC signaling exchange
  // -------------------------------
  socket.on("signal", ({ to, data }) => {
    io.to(to).emit("signal", { from: socket.id, data });
  });

  // -------------------------------
  // Chat system
  // -------------------------------
  socket.on("send-chat", ({ room, message }) => {
    const sender = rooms[room]?.users[socket.id]?.name || "User";
    io.to(room).emit("chat", { name: sender, message });
  });

  // -------------------------------
  // Emoji reaction system
  // -------------------------------
  socket.on("send-emoji", ({ room, emoji }) => {
    const sender = rooms[room]?.users[socket.id]?.name || "User";
    io.to(room).emit("emoji", { name: sender, emoji });
  });

  // -------------------------------
  // User leaves room
  // -------------------------------
  socket.on("leave-room", (room) => {
    handleDisconnect(socket, room);
  });

  // -------------------------------
  // Disconnect event
  // -------------------------------
  socket.on("disconnect", () => {
    for (const room in rooms) {
      if (rooms[room].users[socket.id]) {
        handleDisconnect(socket, room);
      }
    }
  });

  // -------------------------------
  // Disconnect helper
  // -------------------------------
  function handleDisconnect(socket, room) {
    if (!rooms[room]) return;

    const user = rooms[room].users[socket.id];
    delete rooms[room].users[socket.id];

    // Notify others
    socket.to(room).emit("peer-left", { id: socket.id });

    // If host leaves → end meeting for everyone
    if (rooms[room].host === socket.id) {
      io.to(room).emit("meeting-ended");
      delete rooms[room];
      console.log(`❌ Host left. Meeting ended: ${room}`);
    }

    socket.leave(room);
  }
});

// -------------------------------
// Start Server
// -------------------------------
const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
  console.log("🚀 Server running on port " + PORT);
});
