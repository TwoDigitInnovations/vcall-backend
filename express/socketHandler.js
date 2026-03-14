'use strict';

const { rooms, onlineUsers } = require('./store');

// ─────────────────────────────────────────────────────────────────────────────
// In-memory stores for mesh rooms & active video rooms
// (add these to your store.js if you prefer, or keep them here)
// ─────────────────────────────────────────────────────────────────────────────
const meshRooms = new Map(); // roomId → Map<socketId, { userId, username }>
const activeRooms = new Map(); // roomId → { name, createdBy, createdAt }

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
    console.log(`[${roomId}] ${socket.id} left (1-on-1)`);
}

function leaveMeshRoom(io, socket, roomId) {
    if (!roomId) return;
    socket.leave(roomId);

    const room = meshRooms.get(roomId);
    if (room) {
        room.delete(socket.id);
        socket.to(roomId).emit('mesh-peer-left', { socketId: socket.id });

        if (room.size === 0) {
            meshRooms.delete(roomId);
            activeRooms.delete(roomId);
            io.emit('room-closed', { roomId });
        } else {
            broadcastRoomUpdate(io, roomId);
        }
    }
    socket.data.meshRoomId = null;
    console.log(`[${roomId}] ${socket.id} left (mesh)`);
}

function broadcastRoomUpdate(io, roomId) {
    const room = meshRooms.get(roomId);
    const info = activeRooms.get(roomId);
    if (!info) return;
    const update = {
        roomId,
        name: info.name,
        createdBy: info.createdBy,
        createdAt: info.createdAt,
        participants: room ? room.size : 0,
    };
    io.emit('room-updated', update);
}

// Helper: find a user's current socket id
function getUserSocketId(userId) {
    const user = onlineUsers.get(userId);
    return user?.online ? user.socketId : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main handler
// ─────────────────────────────────────────────────────────────────────────────

function registerSocketHandlers(io) {
    io.on('connection', (socket) => {
        console.log('Client connected:', socket.id);

        // ── User comes online ───────────────────────────────────────────────
        socket.on('user-online', ({ userId, username, name }) => {
            if (!userId) return;
            const displayName = username || name || userId;
            socket.data.userId = userId;
            socket.data.username = displayName;

            const existing = onlineUsers.get(userId) || {};
            onlineUsers.set(userId, {
                ...existing,
                userId,
                name: displayName,
                online: true,
                socketId: socket.id,
            });

            // Tell everyone this user is online
            io.emit('presence-update', { userId, name: displayName, online: true });
            console.log(`🟢 ${displayName} (${userId}) online — socket: ${socket.id}`);

            // Send full roster back so the joining client sees who's online
            const roster = {};
            for (const [uid, user] of onlineUsers.entries()) {
                roster[uid] = {
                    online: user.online || false,
                    lastSeen: user.lastSeen || null,
                    name: user.name || uid,
                };
            }
            socket.emit('presence-roster', roster);
        });

        // ── 1-on-1 call: caller notifies callee ────────────────────────────
        socket.on('call-user', ({ calleeId, callerId, callerName, roomId, groupName }) => {
            const calleeSocketId = getUserSocketId(calleeId);
            if (!calleeSocketId) {
                socket.emit('callee-unavailable', { calleeId });
                return;
            }
            io.to(calleeSocketId).emit('incoming-call', {
                callerName: callerName || callerId,
                callerId,
                roomId,
                groupName: groupName || null, // set for group calls
            });
            console.log(`📞 call-user: ${callerId} → ${calleeId} (room: ${roomId})`);
        });

        // ── Callee declines ─────────────────────────────────────────────────
        // ── Call ended: caller or callee hung up ───────────────────────────
        // Target by BOTH roomId (if joined) AND direct userId (reliable fallback)
        socket.on('call-ended', ({ roomId, toUserId }) => {
            console.log(`📵 call-ended — room: ${roomId}, toUserId: ${toUserId}`);
            // Broadcast to the signaling room (works once both sides have joined)
            if (roomId) socket.to(roomId).emit('call-ended');
            // Also send directly to the other user's socket (works even if they
            // haven't emitted 'join' yet, e.g. still on the incoming-call screen)
            if (toUserId) {
                const targetSocketId = getUserSocketId(toUserId);
                if (targetSocketId && targetSocketId !== socket.id) {
                    io.to(targetSocketId).emit('call-ended');
                }
            }
        });

        socket.on('call-declined', ({ roomId, toUserId }) => {
            if (roomId) socket.to(roomId).emit('call-declined');
            if (toUserId) {
                const targetSocketId = getUserSocketId(toUserId);
                if (targetSocketId) io.to(targetSocketId).emit('call-declined');
            }
            console.log(`❌ call-declined — room: ${roomId}`);
        });

        // ── Caller cancels before answer ────────────────────────────────────
        socket.on('call-cancelled', ({ roomId, toUserId }) => {
            if (roomId) socket.to(roomId).emit('call-cancelled');
            if (toUserId) {
                const targetSocketId = getUserSocketId(toUserId);
                if (targetSocketId) io.to(targetSocketId).emit('call-cancelled');
            }
        });

        // ═══════════════════════════════════════════════════════════════════
        // 1-ON-1 WEBRTC SIGNALING  (used by /call page)
        // ═══════════════════════════════════════════════════════════════════

        socket.on('join', ({ roomId, userId }) => {
            if (!roomId) return;
            socket.data.roomId = roomId;
            socket.data.userId = userId || socket.data.userId;

            if (!rooms.has(roomId)) rooms.set(roomId, new Set());
            const room = rooms.get(roomId);
            const isInitiator = room.size === 0;

            room.add(socket.id);
            socket.join(roomId);

            console.log(`[${roomId}] ${socket.id} joined 1-on-1 (initiator: ${isInitiator})`);
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

        socket.on('leave', ({ roomId }) => {
            socket.data.roomId = null;
            handleLeave(socket, roomId);
        });

        // ═══════════════════════════════════════════════════════════════════
        // MESH GROUP VIDEO CALL SIGNALING  (used by /room/[roomId] page)
        // ═══════════════════════════════════════════════════════════════════

        // Get active rooms list
        socket.on('get-rooms', () => {
            const list = [];
            for (const [roomId, info] of activeRooms.entries()) {
                const peers = meshRooms.get(roomId);
                list.push({
                    roomId,
                    name: info.name,
                    createdBy: info.createdBy,
                    createdAt: info.createdAt,
                    participants: peers ? peers.size : 0,
                });
            }
            socket.emit('rooms-list', list);
        });

        // Join mesh room
        socket.on('mesh-join', ({ roomId, userId, username }) => {
            if (!roomId || !userId) return;

            const displayName = username || socket.data.username || userId;
            socket.data.meshRoomId = roomId;
            socket.data.userId = userId;
            socket.data.username = displayName;
            socket.join(roomId);

            // Init room data stores if first joiner
            if (!meshRooms.has(roomId)) meshRooms.set(roomId, new Map());
            if (!activeRooms.has(roomId)) {
                activeRooms.set(roomId, {
                    name: `${displayName}'s Room`,
                    createdBy: displayName,
                    createdAt: Date.now(),
                });
            }

            const room = meshRooms.get(roomId);

            // Tell the new joiner about existing peers
            const peers = [];
            for (const [sid, peer] of room.entries()) {
                peers.push({ socketId: sid, userId: peer.userId, username: peer.username });
            }
            socket.emit('mesh-room-joined', { roomId, peers });

            // Tell existing peers about the new joiner
            socket.to(roomId).emit('mesh-peer-joined', {
                socketId: socket.id, userId, username: displayName,
            });

            room.set(socket.id, { userId, username: displayName });
            broadcastRoomUpdate(io, roomId);
            console.log(`[mesh] ${displayName} joined ${roomId} (${room.size} participants)`);
        });

        // Mesh WebRTC signaling (peer-to-peer, addressed by socketId)
        socket.on('mesh-offer', ({ to, offer, fromUserId, fromUsername }) => {
            io.to(to).emit('mesh-offer', {
                from: socket.id, fromUserId, fromUsername, offer,
            });
        });

        socket.on('mesh-answer', ({ to, answer }) => {
            io.to(to).emit('mesh-answer', { from: socket.id, answer });
        });

        socket.on('mesh-ice', ({ to, candidate }) => {
            io.to(to).emit('mesh-ice', { from: socket.id, candidate });
        });

        // Mic/cam state broadcast
        socket.on('mesh-media-state', ({ roomId, micOn, camOn }) => {
            socket.to(roomId).emit('mesh-media-state', {
                socketId: socket.id, micOn, camOn,
            });
        });

        // In-room chat message
        socket.on('mesh-chat', ({ roomId, id, userId, username, text, ts }) => {
            socket.to(roomId).emit('mesh-chat', { id, userId, username, text, ts });
        });

        // Leave mesh room explicitly
        socket.on('mesh-leave', ({ roomId }) => {
            leaveMeshRoom(io, socket, roomId);
        });

        // Room name update (optional)
        socket.on('mesh-room-name', ({ roomId, name }) => {
            const info = activeRooms.get(roomId);
            if (info) {
                activeRooms.set(roomId, { ...info, name });
                broadcastRoomUpdate(io, roomId);
            }
        });

        // ═══════════════════════════════════════════════════════════════════
        // PRIVATE 1-ON-1 CHAT  (used by /chat page)
        // ═══════════════════════════════════════════════════════════════════

        // Send a private message to another user
        socket.on('private-message', ({ toUserId, message, fromName }) => {
            const fromUserId = socket.data.userId;
            if (!toUserId || !message) return;

            const targetSocketId = getUserSocketId(toUserId);
            if (targetSocketId) {
                io.to(targetSocketId).emit('private-message', {
                    fromUserId,
                    fromName: fromName || socket.data.username || fromUserId,
                    message,
                    ts: Date.now(),
                });
            }
            console.log(`💬 private: ${fromUserId} → ${toUserId}`);
        });

        // ═══════════════════════════════════════════════════════════════════
        // GROUP CHAT  (used by /groups/[groupId] page)
        // ═══════════════════════════════════════════════════════════════════

        // Join a group's socket room to receive real-time messages
        socket.on('join-group', ({ groupId }) => {
            if (!groupId) return;
            socket.join(`group_${groupId}`);
            console.log(`👥 ${socket.data.userId} joined group room: group_${groupId}`);
        });

        // Leave a group's socket room
        socket.on('leave-group', ({ groupId }) => {
            if (!groupId) return;
            socket.leave(`group_${groupId}`);
        });

        // Broadcast a group chat message to all members in the group room
        socket.on('group-message', ({ groupId, message, fromName }) => {
            const fromUserId = socket.data.userId;
            if (!groupId || !message) return;

            // Broadcast to everyone else in the group room
            socket.to(`group_${groupId}`).emit('group-message', {
                groupId,
                fromUserId,
                fromName: fromName || socket.data.username || fromUserId,
                message,
                ts: Date.now(),
            });
            console.log(`👥 group-message: ${fromUserId} → group ${groupId}`);
        });

        // ═══════════════════════════════════════════════════════════════════
        // DISCONNECT / CLEANUP
        // ═══════════════════════════════════════════════════════════════════

        socket.on('disconnecting', () => {
            // Clean up 1-on-1 call room
            const roomId = socket.data.roomId;
            if (roomId) handleLeave(socket, roomId);

            // Clean up mesh room
            const meshRoomId = socket.data.meshRoomId;
            if (meshRoomId) leaveMeshRoom(io, socket, meshRoomId);
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
                console.log(`🔴 ${userId} offline (lastSeen: ${lastSeen})`);
            } else {
                console.log(`ℹ️  ${userId} still has another active socket`);
            }
        });
    });
}

module.exports = { registerSocketHandlers };