const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

/* ---------------------------------------
   FIX 1 → Add route for / (IMPORTANT!)
----------------------------------------*/
app.get("/", (req, res) => {
    res.send("🚀 Anant Kripa Signaling Server is running!");
});

/* ---------------------------------------
   SOCKET.IO HANDLERS
----------------------------------------*/
io.on("connection", (socket) => {
    console.log("A user connected:", socket.id);

    socket.on("join-room", (room) => {
        socket.join(room);
        socket.to(room).emit("user-joined", socket.id);
    });

    socket.on("signal", (data) => {
        io.to(data.to).emit("signal", {
            from: data.from,
            signal: data.signal
        });
    });

    socket.on("disconnect", () => {
        console.log("User disconnected:", socket.id);
        socket.broadcast.emit("user-left", socket.id);
    });
});

/* ---------------------------------------
   FIX 2 → Render uses dynamic PORT
----------------------------------------*/
const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
    console.log("🚀 Signaling server running on port", PORT);
});
