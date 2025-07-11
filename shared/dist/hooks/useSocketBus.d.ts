interface SocketBusHook {
    on: (eventType: string, handler: (payload: any) => void) => void;
    emit: (eventType: string, payload: any, targetAppId?: string) => void;
    isConnected: boolean;
}
export declare function useSocketBus(appId?: string): SocketBusHook;
export {};
