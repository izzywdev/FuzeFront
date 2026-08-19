import { useEffect, useRef, useCallback } from 'react';
import { io } from 'socket.io-client';
export function useSocketBus(appId) {
    var _a;
    const socketRef = useRef(null);
    const handlersRef = useRef(new Map());
    useEffect(() => {
        // Initialize socket connection
        const socket = io(process.env.REACT_APP_WS_URL || 'ws://localhost:3001', {
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
    const on = useCallback((eventType, handler) => {
        handlersRef.current.set(eventType, handler);
    }, []);
    const emit = useCallback((eventType, payload, targetAppId) => {
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
