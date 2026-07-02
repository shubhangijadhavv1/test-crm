"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.initSocket = initSocket;
exports.emitToUser = emitToUser;
exports.emitScoped = emitScoped;
exports.emitAll = emitAll;
const socket_io_1 = require("socket.io");
const jwt_1 = require("../utils/jwt");
const env_1 = require("../config/env");
let io = null;
/** Initialise Socket.IO. Clients authenticate with the access token and join
 *  per-user and per-branch rooms (Blueprint A7 / D2.5). */
function initSocket(server) {
    io = new socket_io_1.Server(server, { cors: { origin: env_1.env.clientOrigin, credentials: true } });
    io.use((socket, next) => {
        const token = socket.handshake.auth?.token;
        if (!token)
            return next(); // allow anonymous connect; rooms gated below
        try {
            const payload = (0, jwt_1.verifyAccess)(token);
            socket.data.userId = payload.sub;
            socket.data.branchId = payload.branchId;
            socket.data.role = payload.role;
        }
        catch {
            /* ignore invalid token; connection stays unauthenticated */
        }
        next();
    });
    io.on('connection', (socket) => {
        if (socket.data.userId)
            socket.join(`user:${socket.data.userId}`);
        if (socket.data.branchId)
            socket.join(`branch:${socket.data.branchId}`);
        // superadmins have no branch room — give them an org-wide room so they still get scoped events
        if (socket.data.role === 'superadmin')
            socket.join('role:superadmin');
    });
    return io;
}
/** Emit to a specific user's room. */
function emitToUser(userId, event, payload) {
    io?.to(`user:${userId}`).emit(event, payload);
}
/**
 * Scoped task/board event: reaches the task's branch, the assignee, and all superadmins
 * (who aren't in any branch room) — instead of flooding every connected client.
 */
function emitScoped(event, payload, opts = {}) {
    if (!io)
        return;
    let chan = io.to('role:superadmin');
    if (opts.branchId)
        chan = chan.to(`branch:${opts.branchId}`);
    if (opts.userId)
        chan = chan.to(`user:${opts.userId}`);
    chan.emit(event, payload);
}
/** Broadcast to everyone (used for org-wide events such as announcements). */
function emitAll(event, payload) {
    io?.emit(event, payload);
}
//# sourceMappingURL=socket.js.map