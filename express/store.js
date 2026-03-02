'use strict';

// ─── Shared in-memory stores ──────────────────────────────────────────────────
// Exported so both socketHandler.js and routes can access the same data

const rooms = new Map(); // roomId → Set<socketId>
const onlineUsers = new Map(); // userId → { userId, name, socketId, online, lastSeen, fcmToken, playerId }

module.exports = { rooms, onlineUsers };