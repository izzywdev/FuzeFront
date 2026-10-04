import { z } from 'zod';
export declare const chatResponseChunkSchemaV1: z.ZodObject<{
    userId: z.ZodString;
    conversationId: z.ZodString;
    messageId: z.ZodString;
    sequence: z.ZodNumber;
    type: z.ZodEnum<["start", "delta", "done", "error"]>;
    delta: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    type: "error" | "start" | "delta" | "done";
    userId: string;
    conversationId: string;
    messageId: string;
    sequence: number;
    delta?: string | undefined;
}, {
    type: "error" | "start" | "delta" | "done";
    userId: string;
    conversationId: string;
    messageId: string;
    sequence: number;
    delta?: string | undefined;
}>;
export type ChatResponseChunkPayloadV1 = z.infer<typeof chatResponseChunkSchemaV1>;
