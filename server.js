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
    origin: process.env.FRONTEND_ORIGIN || "*",
    methods: ["GET", "POST"]
  }
});

/*
----------------------------------------------
   MEMORY STRUCTURE
----------------------------------------------
*/
const roomUsers = {};       // room → { socketId: {name, isHost} }
const waitingUsers = {};    // room → [ {id, name} ]
const roomHost = {};        // room → host socket id


/*
----------------------------------------------
   SOCKET CONNECTION HANDLER
----------------------------------------------
*/
io.on("connection", (socket) => {
  console.log("Connected:", socket.id);

  /*
  ----------------------------------------------
      JOIN REQUEST → Sits in WAITING ROOM
  ----------------------------------------------
  */
  socket.on("join-request", ({ room, userName }) => {
    socket.data.userName = userName || "Guest";
    socket.data.room = room;

    if (!waitingUsers[room]) waitingUsers[room] = [];
    waitingUsers[room].push({ id: socket.id, name: socket.data.userName });

    // Notify host someone is waiting
    if (roomHost[room]) {
      io.to(roomHost[room]).emit("waiting-user", waitingUsers[room]);
    }
  });


  /*
  ----------------------------------------------
      HOST APPROVES ALL USERS
  ----------------------------------------------
  */
  socket.on("approve-all", (room) => {
    if (!waitingUsers[room]) return;

    waitingUsers[room].forEach(u => {
      io.to(u.id).emit("approved", room);
    });

    waitingUsers[room] = [];
  });


  /*
  ----------------------------------------------
      FINAL JOIN ROOM (after approval)
  ----------------------------------------------
  */
  socket.on("join-room", ({ room, userName, host }) => {
    socket.join(room);
    socket.data.userName = userName || "Guest";
    socket.data.room = room;

    if (!roomUsers[room]) roomUsers[room] = {};

    // Mark host
    if (host === true) {
      roomHost[room] = socket.id;
      roomUsers[room][socket.id] = { name: socket.data.userName, isHost: true };
    } else {
      roomUsers[room][socket.id] = { name: socket.data.userName, isHost: false };
    }

    // Send peer list to new user
    const users = Object.keys(roomUsers[room]).filter(id => id !== socket.id);
    socket.emit("peers", users);

    // Notify others
    socket.to(room).emit("peer-joined", {
      id: socket.id,
      userName: socket.data.userName,
      isHost: roomUsers[room][socket.id].isHost
    });

    console.log(socket.id, "joined room", room);
  });


  /*
  ----------------------------------------------
      SIGNALING (Offer, Answer, ICE)
  ----------------------------------------------
  */
  socket.on("signal", ({ to, data }) => {
    if (to) io.to(to).emit("signal", { from: socket.id, data });
  });


  /*
  ----------------------------------------------
      CHAT
  ----------------------------------------------
  */
  socket.on("send-chat", ({ room, message }) => {
    io.to(room).emit("chat-message", {
      from: socket.id,
      message,
      name: socket.data.userName,
      ts: Date.now()
    });
  });


  /*
  ----------------------------------------------
      EMOJI
  ----------------------------------------------
  */
  socket.on("emoji", ({ room, emoji }) => {
    io.to(room).emit("emoji", {
      emoji,
      from: socket.id
    });
  });


  /*
  ----------------------------------------------
      AUTO DISCONNECT ON LEAVE
  ----------------------------------------------
  */
  socket.on("disconnecting", () => {
    const room = socket.data.room;
    if (!room) return;

    socket.to(room).emit("peer-left", { id: socket.id });

    if (roomUsers[room]) {
      delete roomUsers[room][socket.id];
    }

    // If host disconnects, meeting ends for everyone
    if (roomHost[room] === socket.id) {
      io.to(room).emit("meeting-ended");
      delete roomHost[room];
      delete roomUsers[room];
      delete waitingUsers[room];
    }
  });
});



/*
----------------------------------------------
   END MEETING API (Called by PHP)
----------------------------------------------
*/
app.get("/endRoom", (req, res) => {
  const room = req.query.room;
  io.to(room).emit("meeting-ended");

  delete roomUsers[room];
  delete waitingUsers[room];
  delete roomHost[room];

  res.json({ success: true });
});


/*
----------------------------------------------
   HEALTH CHECK
----------------------------------------------
*/
app.get("/health", (req, res) => res.json({ ok: true }));


/*
----------------------------------------------
   START SERVER
----------------------------------------------
*/
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
