const apps = require("express")();
require("dotenv").config();
const passport = require("passport");
const bodyParser = require("body-parser");
const noc = require("no-console");
const cors = require("cors");
const http = require("http");
const path = require('path');
const { GoogleAuth } = require('google-auth-library');

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
// 'BHVdgcLvQWCGel6Wd-0sU7pVtheq2AxETGL_TQ6xdOz_-VQGNct6pUL4T44ODiijbbH4jb88sU42a6KkqZwLlMc'

const FIREBASE_PROJECT_ID = 'digit-vcall';
const SERVICE_ACCOUNT_PATH = path.join(__dirname, 'firebase-service-account.json');



// ─── FCM v1 — get OAuth2 access token via service account ────────────────────
let _fcmAccessToken = null;
let _fcmTokenExpiresAt = 0;

async function getFcmAccessToken() {
    // Cache token until 5 min before expiry
    if (_fcmAccessToken && Date.now() < _fcmTokenExpiresAt - 300000) {
        return _fcmAccessToken;
    }
    try {
        const auth = new GoogleAuth({
            keyFile: SERVICE_ACCOUNT_PATH,
            scopes: ['https://www.googleapis.com/auth/firebase.messaging'],
        });
        const client = await auth.getClient();
        const token = await client.getAccessToken();
        _fcmAccessToken = token.token;
        _fcmTokenExpiresAt = token.res?.data?.expiry_date || (Date.now() + 3600000);
        return _fcmAccessToken;
    } catch (err) {
        console.error('FCM auth error:', err.message);
        return null;
    }
}

// ─── Send FCM v1 message ──────────────────────────────────────────────────────
// Sends a NOTIFICATION + DATA combined message.
// Android shows the notification automatically even when app is killed —
// no background handler or Notifee needed.
// When user taps → app opens → getInitialNotification() fires → join call.
async function sendFcmV1(fcmToken, callData) {
    const accessToken = await getFcmAccessToken();
    if (!accessToken) return false;

    const { callerId, callerName, roomId } = callData;
    const url = `https://fcm.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/messages:send`;

    const body = {
        message: {
            token: fcmToken,

            // ── Notification — Android shows this on lock screen automatically ──
            notification: {
                title: `📞 ${callerName || callerId} is calling`,
                body: 'Tap to answer',
            },

            // ── Data — passed to app when user taps the notification ─────────────
            data: {
                type: 'incoming_call',
                callerId: callerId || '',
                callerName: callerName || '',
                roomId: roomId || '',
            },

            // ── Android config ────────────────────────────────────────────────────
            android: {
                priority: 'high',          // wakes device even in Doze mode
                ttl: '60s',
                notification: {
                    channel_id: 'incoming_call_v2',   // NEW channel ID — forces Android to recreate with sound
                    sound: 'ringtone',
                    visibility: 'PUBLIC',
                    default_vibrate_timings: true,
                    notification_priority: 'PRIORITY_MAX',
                },
            },
        },
    };

    try {
        const res = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${accessToken}`,
            },
            body: JSON.stringify(body),
        });
        const result = await res.json();
        if (result.name) {
            return true;
        } else {
            console.error('FCM v1 error:', JSON.stringify(result));
            return false;
        }
    } catch (err) {
        console.error('FCM v1 fetch error:', err.message);
        return false;
    }
}

// ─── In-memory stores ─────────────────────────────────────────────────────────
const rooms = new Map(); // roomId  → Set<socketId>
const onlineUsers = new Map(); // userId  → { name, socketId, online, lastSeen, fcmToken, playerId }

// ─────────────────────────────────────────────────────────────────────────────
// REST ENDPOINTS
// ─────────────────────────────────────────────────────────────────────────────

// ── Register user presence + tokens ───────────────────────────────────────────
apps.post('/register', (req, res) => {
    const { userId, name, playerId, fcmToken } = req.body;
    if (!userId || !name) return res.status(400).json({ error: 'userId and name required' });

    const existing = onlineUsers.get(userId) || {};
    onlineUsers.set(userId, {
        ...existing,
        userId,
        name,
        playerId: playerId || existing.playerId || null,
        fcmToken: fcmToken || existing.fcmToken || null,
        online: existing.online || false,
        lastSeen: existing.lastSeen || null,
    });

    console.log(`📋 Registered: ${userId} (${name}) fcm:${!!fcmToken} onesignal:${!!playerId}`);
    res.json({ success: true });
});

// ── Register FCM token (Android — for killed-app wakeup) ─────────────────────
apps.post('/register-fcm', (req, res) => {
    const { userId, fcmToken } = req.body;
    if (!userId || !fcmToken) return res.status(400).json({ error: 'userId and fcmToken required' });

    const existing = onlineUsers.get(userId) || {};
    onlineUsers.set(userId, { ...existing, userId, fcmToken });
    console.log(`🔥 FCM token registered: ${userId}`);
    res.json({ success: true });
});

// ── Register OneSignal player ID (iOS + Android fallback) ────────────────────
apps.post('/register-player', (req, res) => {
    const { userId, playerId } = req.body;
    if (!userId || !playerId) return res.status(400).json({ error: 'userId and playerId required' });

    const existing = onlineUsers.get(userId) || {};
    onlineUsers.set(userId, { ...existing, userId, playerId });
    console.log(`📱 OneSignal player registered: ${userId}`);
    res.json({ success: true });
});

// ── Register iOS VoIP token ───────────────────────────────────────────────────
apps.post('/register-voip', (req, res) => {
    const { userId, voipToken } = req.body;
    if (!userId || !voipToken) return res.status(400).json({ error: 'userId and voipToken required' });

    const existing = onlineUsers.get(userId) || {};
    onlineUsers.set(userId, { ...existing, userId, voipToken });
    console.log(`🍎 VoIP token registered: ${userId}`);
    res.json({ success: true });
});

// ── Get online users ──────────────────────────────────────────────────────────
apps.get('/users', (_req, res) => {
    const users = Array.from(onlineUsers.values()).map(u => ({
        userId: u.userId,
        name: u.name,
        online: u.online,
        lastSeen: u.lastSeen,
    }));
    res.json({ users });
});

// ── Notify callee of incoming call ────────────────────────────────────────────
apps.post('/notify-call', async (req, res) => {
    const { callerId, callerName, calleeId, roomId } = req.body;
    if (!callerId || !calleeId || !roomId) {
        return res.status(400).json({ error: 'callerId, calleeId and roomId required' });
    }

    const calleeUser = onlineUsers.get(calleeId);
    const results = { socket: false, fcm: false, oneSignal: false };

    // ── 1. Socket delivery — instant when app is OPEN ────────────────────────
    if (calleeUser?.socketId) {
        io.to(calleeUser.socketId).emit('incoming-call', {
            callerId,
            callerName: callerName || callerId,
            roomId,
        });
        results.socket = true;
        console.log(`✅ Socket → ${calleeId}`);
    } else {
        console.log(`⚠️  ${calleeId} not on socket`);
    }

    // ── 2. FCM v1 data message — wakes KILLED Android app ───────────────────
    if (calleeUser?.fcmToken) {
        const ok = await sendFcmV1(calleeUser.fcmToken, {
            type: 'incoming_call',
            callerId,
            callerName: callerName || callerId,
            roomId,
        });
        results.fcm = ok;
        console.log(ok ? `✅ FCM v1 → ${calleeId}` : `❌ FCM v1 failed → ${calleeId}`);
    } else {
        console.log(`⚠️  No FCM token for ${calleeId}`);
    }

    // ── 3. OneSignal — iOS + Android fallback ────────────────────────────────
    if (calleeUser?.playerId) {
        try {
            const osRes = await fetch('https://onesignal.com/api/v1/notifications', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Basic ${ONESIGNAL_API_KEY}`,
                },
                body: JSON.stringify({
                    app_id: ONESIGNAL_APP_ID,
                    include_player_ids: [calleeUser.playerId],
                    headings: { en: `📞 ${callerName || callerId} is calling` },
                    contents: { en: 'Tap to answer' },
                    data: {
                        type: 'incoming_call',
                        callerId,
                        callerName: callerName || callerId,
                        roomId,
                    },
                    android_channel_id: 'incoming_call',
                    priority: 10,
                    android_visibility: 1,
                    android_background_data: true,
                    android_full_screen_intent: true,
                    wake_lock_timeout: 60000,
                    content_available: true,
                    mutable_content: true,
                    ios_sound: 'default',
                    android_sound: 'ringtone'

                }),
            });

            const osResult = await osRes.json();
            if (!osResult.errors) {
                results.oneSignal = true;
                console.log(`✅ OneSignal → ${calleeId}`);
            } else {
                console.log(`❌ OneSignal error:`, osResult.errors);
            }
        } catch (err) {
            console.error('OneSignal error:', err.message);
        }
    }

    console.log(`📊 notify-call results:`, results);
    res.json({ success: true, results });
});

// ── Cancel call ───────────────────────────────────────────────────────────────
apps.post('/cancel-call', (req, res) => {
    const { calleeId, roomId } = req.body;
    if (!calleeId) return res.status(400).json({ error: 'calleeId required' });

    // Notify via socket if app is open
    const calleeUser = onlineUsers.get(calleeId);
    if (calleeUser?.socketId) {
        io.to(calleeUser.socketId).emit('call-cancelled', { roomId });
    }

    res.json({ success: true });
});

// ── Health check ──────────────────────────────────────────────────────────────
apps.get('/health', (_req, res) => {
    res.json({
        status: 'ok',
        rooms: rooms.size,
        users: onlineUsers.size,
        online: Array.from(onlineUsers.values()).filter(u => u.online).length,
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// SOCKET.IO
// ─────────────────────────────────────────────────────────────────────────────

function handleLeave(socket, roomId) {
    if (!roomId) return;
    const room = rooms.get(roomId);
    if (room) {
        room.delete(socket.id);
        if (room.size === 0) rooms.delete(roomId);
    }
    socket.leave(roomId);
    socket.to(roomId).emit('peer-left', { socketId: socket.id });
    console.log(`[${roomId}] ${socket.id} left`);
}

io.on('connection', (socket) => {
    console.log('Client connected:', socket.id);

    // ── User comes online ─────────────────────────────────────────────────────
    socket.on('user-online', ({ userId, name }) => {
        if (!userId) return;
        socket.data.userId = userId;

        const existing = onlineUsers.get(userId) || {};
        onlineUsers.set(userId, {
            ...existing,
            userId,
            name: name || existing.name || userId,
            online: true,
            socketId: socket.id,
        });

        io.emit('presence-update', { userId, online: true });
        console.log(`🟢 ${userId} online (socket: ${socket.id})`);
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

    // ── WebRTC signaling ──────────────────────────────────────────────────────
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

    // ── Leave / disconnect ────────────────────────────────────────────────────
    socket.on('leave', ({ roomId }) => {
        socket.data.roomId = null;
        handleLeave(socket, roomId);
    });

    socket.on('disconnecting', () => {
        const roomId = socket.data.roomId;
        if (roomId) handleLeave(socket, roomId);
    });

    socket.on('disconnect', (reason) => {
        console.log('Client disconnected:', socket.id, reason);
        const userId = socket.data.userId;
        if (userId) {
            const user = onlineUsers.get(userId);
            // Only mark offline if THIS socket is the currently registered one
            if (user && user.socketId === socket.id) {
                onlineUsers.set(userId, {
                    ...user,
                    online: false,
                    lastSeen: new Date().toISOString(),
                    socketId: null,
                });
                io.emit('presence-update', {
                    userId,
                    online: false,
                    lastSeen: new Date().toISOString(),
                });
                console.log(`🔴 ${userId} offline`);
            } else {
                console.log(`ℹ️  ${userId} still online via another socket`);
            }
        }
    });
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