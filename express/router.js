'use strict';

const express = require('express');
const router = express.Router();
// const fetch = require('node-fetch');
const { onlineUsers } = require('./store');
const { sendFcmV1 } = require('./fcm');


const ONESIGNAL_APP_ID = process.env.ONESIGNAL_APP_ID_VCALL;
const ONESIGNAL_API_KEY = process.env.ONESIGNAL_REST_API_KEY_VCALL;
// io instance — injected via init()
let _io = null;
function init(io) { _io = io; }

// ── Register user presence + tokens ──────────────────────────────────────────
router.post('/register', (req, res) => {
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

// ── Register FCM token ────────────────────────────────────────────────────────
router.post('/register-fcm', (req, res) => {
    const { userId, fcmToken } = req.body;
    if (!userId || !fcmToken) return res.status(400).json({ error: 'userId and fcmToken required' });

    const existing = onlineUsers.get(userId) || {};
    onlineUsers.set(userId, { ...existing, userId, fcmToken });
    console.log(`🔥 FCM token registered: ${userId}`);
    res.json({ success: true });
});

// ── Register OneSignal player ID ──────────────────────────────────────────────
router.post('/register-player', (req, res) => {
    const { userId, playerId } = req.body;
    if (!userId || !playerId) return res.status(400).json({ error: 'userId and playerId required' });

    const existing = onlineUsers.get(userId) || {};
    onlineUsers.set(userId, { ...existing, userId, playerId });
    console.log(`📱 OneSignal player registered: ${userId}`);
    res.json({ success: true });
});

// ── Register iOS VoIP token ───────────────────────────────────────────────────
router.post('/register-voip', (req, res) => {
    const { userId, voipToken } = req.body;
    if (!userId || !voipToken) return res.status(400).json({ error: 'userId and voipToken required' });

    const existing = onlineUsers.get(userId) || {};
    onlineUsers.set(userId, { ...existing, userId, voipToken });
    console.log(`🍎 VoIP token registered: ${userId}`);
    res.json({ success: true });
});

// ── Get presence snapshot ─────────────────────────────────────────────────────
router.get('/presence', (_req, res) => {
    const presence = {};
    for (const [userId, user] of onlineUsers.entries()) {
        presence[userId] = { online: user.online || false, lastSeen: user.lastSeen || null };
    }
    res.json({ presence });
});

// ── Notify callee of incoming call ────────────────────────────────────────────
router.post('/notify-call', async (req, res) => {
    const { callerId, calleeId, roomId, callerName } = req.body;
    if (!callerId || !calleeId || !roomId) {
        return res.status(400).json({ error: 'callerId, calleeId and roomId required' });
    }

    const calleeUser = onlineUsers.get(calleeId);
    const results = { socket: false, fcm: false, oneSignal: false };

    // 1. Socket — instant if app is open
    if (calleeUser?.socketId) {
        _io?.to(calleeUser.socketId).emit('incoming-call', {
            callerId,
            callerName: callerName || callerId,
            roomId,
        });
        results.socket = true;
        console.log(`✅ Socket → ${calleeId}`);
    } else {
        console.log(`⚠️  ${calleeId} not on socket`);
    }

    // 2. FCM — wakes killed Android app
    if (calleeUser?.fcmToken) {
        const ok = await sendFcmV1(calleeUser.fcmToken, { callerId, callerName, roomId });
        results.fcm = ok;
        console.log(ok ? `✅ FCM v1 → ${calleeId}` : `❌ FCM v1 failed → ${calleeId}`);
    } else {
        console.log(`⚠️  No FCM token for ${calleeId}`);
    }

    // 3. OneSignal — iOS + Android fallback
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
                    data: { type: 'incoming_call', callerId, callerName, roomId },
                    android_channel_id: 'incoming_call_v3',
                    priority: 10,
                    android_visibility: 1,
                    android_background_data: true,
                    android_full_screen_intent: true,
                    content_available: true,
                    mutable_content: true,
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
router.post('/cancel-call', (req, res) => {
    const { calleeId, roomId } = req.body;
    if (!calleeId) return res.status(400).json({ error: 'calleeId required' });

    const calleeUser = onlineUsers.get(calleeId);
    if (calleeUser?.socketId) {
        _io?.to(calleeUser.socketId).emit('call-cancelled', { roomId });
    }
    res.json({ success: true });
});

// ── Health check ──────────────────────────────────────────────────────────────
router.get('/health', (_req, res) => {
    const { rooms } = require('./store');
    res.json({
        status: 'ok',
        rooms: rooms.size,
        users: onlineUsers.size,
        online: Array.from(onlineUsers.values()).filter(u => u.online).length,
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Export plain router (used by src/routes/index.js as app.use('/', router))
// Export init separately (used by express/index.js as init(io))
// ─────────────────────────────────────────────────────────────────────────────
module.exports = router;
module.exports.init = init;