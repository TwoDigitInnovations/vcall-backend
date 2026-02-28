const apps = require("express")();
require("dotenv").config();
const passport = require("passport");
const bodyParser = require("body-parser");
const noc = require("no-console");
const cors = require("cors");
const http = require("http");


const { Server } = require('socket.io');

// Bootstrap schemas, models
require("./bootstrap");


noc(apps);
apps.use(bodyParser.json({ limit: '50mb' }));
apps.use(passport.initialize());
apps.use(cors());

const server = http.createServer(apps);
const io = new Server(server, {
    cors: { origin: '*', methods: ['GET', 'POST'] },
    transports: ['websocket', 'polling'],
});

// roomId → Set of socket IDs


const ONESIGNAL_APP_ID = process.env.ONESIGNAL_APP_ID_VCALL;
const ONESIGNAL_API_KEY = process.env.ONESIGNAL_REST_API_KEY_VCALL;


// ─── In-memory stores ─────────────────────────────────────────────────────────
const rooms = new Map(); // roomId → Set<socketId>
const onlineUsers = new Map(); // userId → { name, socketId, online, lastSeen }
const fcmPlayers = new Map(); // userId → OneSignal playerId

// ─── REST: Register user + OneSignal player ID ────────────────────────────────
// Call on app launch: POST /register { userId, name, playerId }
apps.post('/register', (req, res) => {
    const { userId, name, playerId } = req.body;
    if (!userId || !name) return res.status(400).json({ error: 'userId and name required' });

    // Update or create user record
    const existing = onlineUsers.get(userId) || {};
    onlineUsers.set(userId, {
        ...existing,
        userId,
        name,
        online: false,
        lastSeen: existing.lastSeen || null,
    });

    if (playerId) {
        fcmPlayers.set(userId, playerId);
        console.log(`Registered player: ${userId} (${name}) playerId: ${playerId}`);
    }

    res.json({ success: true });
});

// ─── REST: Get all users with online status ───────────────────────────────────
// UsersScreen calls: GET /users?currentUserId=xxx
apps.get('/users', (req, res) => {
    const { currentUserId } = req.query;
    const users = [];

    onlineUsers.forEach((user, userId) => {
        if (userId === currentUserId) return; // exclude self
        users.push({
            userId: user.userId,
            name: user.name,
            online: user.online,
            lastSeen: user.lastSeen,
        });
    });

    // Sort: online first, then alphabetical
    users.sort((a, b) => {
        if (a.online && !b.online) return -1;
        if (!a.online && b.online) return 1;
        return a.name.localeCompare(b.name);
    });

    res.json({ users });
});

// ─── REST: Notify callee of incoming call ─────────────────────────────────────
apps.post('/notify-call', async (req, res) => {
    const { callerId, callerName, calleeId, roomId } = req.body;
    if (!callerId || !calleeId || !roomId) {
        return res.status(400).json({ error: 'callerId, calleeId and roomId required' });
    }

    // ── Always try socket delivery first (works when app is open) ────────────
    const calleeUser = onlineUsers.get(calleeId);
    if (calleeUser?.socketId) {
        io.to(calleeUser.socketId).emit('incoming-call', {
            callerId,
            callerName: callerName || callerId,
            roomId,
        });
        console.log(`✅ Socket incoming-call → ${calleeId} (socket: ${calleeUser.socketId})`);
    } else {
        console.log(`⚠️  Callee ${calleeId} not connected via socket`);
    }

    // ── Try OneSignal push (works when app is in background/closed) ──────────
    const playerId = fcmPlayers.get(calleeId);
    if (!playerId) {
        console.log(`No OneSignal player ID for callee: ${calleeId} — socket only`);
        return res.json({ success: true, method: 'socket' });
    }

    try {
        const response = await fetch('https://onesignal.com/api/v1/notifications', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Basic ${ONESIGNAL_API_KEY}`,
            },
            body: JSON.stringify({
                app_id: ONESIGNAL_APP_ID,
                include_player_ids: [playerId],
                headings: { en: `📞 ${callerName || callerId} is calling` },
                contents: { en: 'Tap to answer' },
                data: { type: 'incoming_call', callerId, callerName: callerName || callerId, roomId },
                android_channel_id: 'incoming_call',
                priority: 10,
                wake_lock_timeout: 15,
                ios_sound: 'default',
                content_available: true,
                mutable_content: true,
            }),
        });

        const result = await response.json();
        if (result.errors) throw new Error(JSON.stringify(result.errors));
        console.log(`✅ OneSignal push sent → ${calleeId}`);
        res.json({ success: true, method: 'socket+push' });
    } catch (err) {
        console.error('OneSignal error:', err.message);
        // Don't fail — socket delivery already succeeded above
        res.json({ success: true, method: 'socket', pushError: err.message });
    }
});

// ─── REST: Cancel call ────────────────────────────────────────────────────────
apps.post('/cancel-call', (req, res) => {
    const { calleeId, roomId } = req.body;
    if (!calleeId) return res.status(400).json({ error: 'calleeId required' });
    io.emit('call-cancelled', { roomId });
    res.json({ success: true });
});

// ─── SOCKET.IO ────────────────────────────────────────────────────────────────
io.on('connection', (socket) => {
    console.log('Client connected:', socket.id);

    // ── Go online ──────────────────────────────────────────────────────────────
    // App emits this right after connecting: socket.emit('user-online', { userId })
    socket.on('user-online', ({ userId, name }) => {
        if (!userId) return;
        socket.data.userId = userId;

        // Create or update user entry — works even without prior POST /register
        const existing = onlineUsers.get(userId) || {};
        onlineUsers.set(userId, {
            ...existing,
            userId,
            name: name || existing.name || userId,
            online: true,
            socketId: socket.id,
        });

        // Broadcast updated presence to all clients
        io.emit('presence-update', { userId, online: true });
        console.log(`🟢 ${userId} is online (socket: ${socket.id})`);
    });

    // ── Join call room ─────────────────────────────────────────────────────────
    socket.on('join', ({ roomId, userId }) => {
        if (!roomId) return;
        socket.data.roomId = roomId;
        socket.data.userId = userId;

        if (!rooms.has(roomId)) rooms.set(roomId, new Set());

        const room = rooms.get(roomId);
        const isInitiator = room.size === 0;

        room.add(socket.id);
        socket.join(roomId);

        console.log(`[${roomId}] ${socket.id} joined (initiator: ${isInitiator})`);

        socket.emit('joined', { roomId, initiator: isInitiator });

        if (!isInitiator) {
            socket.to(roomId).emit('peer-joined', { socketId: socket.id });
        }
    });

    socket.on('offer', ({ roomId, offer }) => {
        if (!roomId || !offer) return;
        socket.to(roomId).emit('offer', { offer, from: socket.id });
    });

    socket.on('answer', ({ roomId, answer }) => {
        if (!roomId || !answer) return;
        socket.to(roomId).emit('answer', { answer, from: socket.id });
    });

    socket.on('ice-candidate', ({ roomId, candidate }) => {
        if (!roomId || !candidate) return;
        socket.to(roomId).emit('ice-candidate', { candidate, from: socket.id });
    });

    socket.on('call-declined', ({ roomId }) => {
        if (!roomId) return;
        socket.to(roomId).emit('call-declined');
    });

    socket.on('leave', ({ roomId }) => {
        socket.data.roomId = null; // mark as left so disconnecting doesn't re-fire
        handleLeave(socket, roomId);
    });

    socket.on('disconnecting', () => {
        const roomId = socket.data.roomId;
        if (roomId) handleLeave(socket, roomId); // only fires if leave wasn't called
    });

    // ── Go offline ─────────────────────────────────────────────────────────────
    socket.on('disconnect', (reason) => {
        console.log('Client disconnected:', socket.id, reason);

        const userId = socket.data.userId;
        if (userId) {
            const user = onlineUsers.get(userId);
            // Only mark offline if THIS socket is the one currently registered.
            // If UsersScreen socket is still alive, it will have re-registered
            // with a newer socketId — don't clobber it.
            if (user && user.socketId === socket.id) {
                onlineUsers.set(userId, {
                    ...user,
                    online: false,
                    lastSeen: new Date().toISOString(),
                    socketId: null,
                });
                io.emit('presence-update', { userId, online: false, lastSeen: new Date().toISOString() });
                console.log(`🔴 ${userId} is offline`);
            } else {
                console.log(`ℹ️  ${userId} still online via another socket`);
            }
        }
    });
});

function handleLeave(socket, roomId) {
    if (!roomId) return;
    socket.leave(roomId);

    const room = rooms.get(roomId);
    if (room) {
        room.delete(socket.id);
        if (room.size === 0) {
            rooms.delete(roomId);
            console.log(`[${roomId}] Room deleted (empty)`);
        }
    }

    socket.to(roomId).emit('peer-left', { socketId: socket.id });
    console.log(`[${roomId}] ${socket.id} left`);
}

// ─── Debug endpoints ──────────────────────────────────────────────────────────
apps.get('/health', (_req, res) => res.json({ status: 'ok', rooms: rooms.size, users: onlineUsers.size }));
apps.get('/rooms', (_req, res) => {
    const data = {};
    rooms.forEach((sockets, roomId) => { data[roomId] = [...sockets]; });
    res.json(data);
});


// apps.use(morgan(':method :url :status :user-agent - :response-time ms'));

//Database connection
require('./db');
//Passport configuration
require('./passport')(passport);
//Routes configuration
require("./../src/routes")(apps);

const app = server;
module.exports = app;