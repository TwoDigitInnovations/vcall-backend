'use strict';

const { rooms, onlineUsers } = require('./store');

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
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

// ─────────────────────────────────────────────────────────────────────────────
// Main handler — call this with the Socket.IO server instance
// ─────────────────────────────────────────────────────────────────────────────

function registerSocketHandlers(io) {
    io.on('connection', (socket) => {
        console.log('Client connected:', socket.id);

        // ── User comes online ───────────────────────────────────────────────────
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

            // Tell everyone this user is online
            io.emit('presence-update', { userId, online: true });
            console.log(`🟢 ${userId} online (socket: ${socket.id})`);

            // Send full roster back to this socket so they see who's already online
            const roster = {};
            for (const [uid, user] of onlineUsers.entries()) {
                roster[uid] = { online: user.online || false, lastSeen: user.lastSeen || null };
            }
            socket.emit('presence-roster', roster);
        });

        // ── Join call room ──────────────────────────────────────────────────────
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

        // ── WebRTC signaling ────────────────────────────────────────────────────
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

        // ── Leave / disconnect ──────────────────────────────────────────────────
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
            if (!userId) return;

            const user = onlineUsers.get(userId);
            if (user && user.socketId === socket.id) {
                const lastSeen = new Date().toISOString();
                onlineUsers.set(userId, { ...user, online: false, lastSeen, socketId: null });
                io.emit('presence-update', { userId, online: false, lastSeen });
                console.log(`🔴 ${userId} offline`);
            } else {
                console.log(`ℹ️  ${userId} still online via another socket`);
            }
        });
    });
}

module.exports = { registerSocketHandlers };