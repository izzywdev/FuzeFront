"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.useSocketBus = useSocketBus;
const react_1 = require("react");
const socket_io_client_1 = require("socket.io-client");
function useSocketBus(appId) {
    var _a;
    const socketRef = (0, react_1.useRef)(null);
    const handlersRef = (0, react_1.useRef)(new Map());
    (0, react_1.useEffect)(() => {
        // Initialize socket connection
        const socket = (0, socket_io_client_1.io)(process.env.REACT_APP_WS_URL || 'ws://localhost:3001', {
            auth: {
                appId: appId || 'container',
            },
        });
        socketRef.current = socket;
        // Set up message routing
        socket.on('command-event', (event) => {
            const handler = handlersRef.current.get(event.type);
            if (handler) {
                handler(event.payload);
            }
        });
        return () => {
            socket.disconnect();
            socketRef.current = null;
        };
    }, [appId]);
    const on = (0, react_1.useCallback)((eventType, handler) => {
        handlersRef.current.set(eventType, handler);
    }, []);
    const emit = (0, react_1.useCallback)((eventType, payload, targetAppId) => {
        if (socketRef.current) {
            const event = {
                type: eventType,
                payload,
                appId: targetAppId,
            };
            socketRef.current.emit('command-event', event);
        }
    }, []);
    return {
        on,
        emit,
        isConnected: ((_a = socketRef.current) === null || _a === void 0 ? void 0 : _a.connected) || false,
    };
}
