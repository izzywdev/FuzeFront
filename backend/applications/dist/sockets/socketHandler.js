"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.initializeSocketIO = initializeSocketIO;
const socket_io_1 = require("socket.io");
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
function initializeSocketIO(httpServer) {
    const io = new socket_io_1.Server(httpServer, {
        cors: {
            origin: process.env.FRONTEND_URL || 'http://localhost:5173',
            methods: ['GET', 'POST'],
        },
    });
    // Authentication middleware for socket connections
    io.use((socket, next) => {
        const token = socket.handshake.auth.token;
        const appId = socket.handshake.auth.appId;
        if (token) {
            try {
                const decoded = jsonwebtoken_1.default.verify(token, process.env.JWT_SECRET);
                socket.userId = decoded.userId;
                socket.appId = appId || 'container';
                next();
            }
            catch (err) {
                next(new Error('Authentication error'));
            }
        }
        else {
            // Allow unauthenticated connections for demo purposes
            socket.appId = appId || 'anonymous';
            next();
        }
    });
    io.on('connection', (socket) => {
        console.log(`Socket connected: ${socket.id} (app: ${socket.appId})`);
        // Join app-specific room
        if (socket.appId) {
            socket.join(socket.appId);
        }
        // Handle command events
        socket.on('command-event', (event) => {
            console.log('Command event received:', event);
            // Route message based on target
            if (event.appId) {
                // Send to specific app
                socket.to(event.appId).emit('command-event', {
                    ...event,
                    sourceAppId: socket.appId,
                });
            }
            else {
                // Broadcast to all connected clients
                socket.broadcast.emit('command-event', {
                    ...event,
                    sourceAppId: socket.appId,
                });
            }
        });
        // Handle app-to-app communication
        socket.on('app-message', (data) => {
            socket.to(data.targetAppId).emit('app-message', {
                ...data,
                sourceAppId: socket.appId,
            });
        });
        // Handle platform events
        socket.on('platform-event', (data) => {
            // Broadcast platform events to all clients
            io.emit('platform-event', {
                ...data,
                sourceAppId: socket.appId,
            });
        });
        socket.on('disconnect', () => {
            console.log(`Socket disconnected: ${socket.id}`);
        });
    });
    return io;
}
//# sourceMappingURL=socketHandler.js.map