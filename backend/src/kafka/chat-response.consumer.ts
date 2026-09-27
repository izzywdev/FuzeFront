import type { Server as SocketIOServer } from 'socket.io'
import {
  chatResponseChunkSchemaV1,
  createKafkaClient,
  TOPICS,
  TypedConsumer,
  type ChatResponseChunkPayloadV1,
  type FuzeEvent,
} from '@fuzefront/shared'

let consumer: TypedConsumer | undefined

export async function startChatResponseConsumer(io: SocketIOServer): Promise<void> {
  const brokers = (process.env.KAFKA_BROKERS || '').split(',').map(v => v.trim()).filter(Boolean)
  if (brokers.length === 0) {
    console.warn('[backend] Kafka disabled — chat response WebSocket bridge not started')
    return
  }
  const kafka = createKafkaClient({ clientId: 'fuzefront-chat-websocket-bridge', brokers })
  consumer = new TypedConsumer(kafka, 'fuzefront-chat-websocket-bridge-v1')
  await consumer.connect()
  await consumer.subscribe(TOPICS.CHAT_RESPONSE_CHUNK)
  await consumer.run<ChatResponseChunkPayloadV1>(async (event: FuzeEvent<ChatResponseChunkPayloadV1>) => {
    // userId comes from a schema-validated Kafka event created by chat-service.
    // Clients cannot choose this room; Socket.IO assigns it from the verified JWT.
    io.to(`user:${event.payload.userId}`).emit('chat:injection', event.payload)
  }, chatResponseChunkSchemaV1)
}

export async function stopChatResponseConsumer(): Promise<void> {
  await consumer?.disconnect()
  consumer = undefined
}
