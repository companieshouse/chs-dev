export interface StreamEvent {
    type: string;
    data: unknown;
    id?: string;
}

export type EventHandler = (type: string, data: any, id?: string) => void;

/** Decode one SSE block; comments and blocks without data do not emit events. */
export function parseEventBlock(block: string): StreamEvent | undefined {
    let type = 'message';
    let id: string | undefined;
    const data: string[] = [];
    for (const line of block.split('\n')) {
        if (line.startsWith('event: ')) type = line.slice(7);
        else if (line.startsWith('data: ')) data.push(line.slice(6));
        else if (line.startsWith('id: ')) id = line.slice(4);
    }
    if (!data.length) return undefined;
    return { type, data: JSON.parse(data.join('\n')), id };
}

/** Retain partial frames across chunks and bound buffered input. */
export class EventDecoder {
    private buffer = '';
    constructor(
        private readonly onEvent: EventHandler,
        private readonly limit = 32 * 1024 * 1024,
    ) {}
    push(chunk: string) {
        this.buffer += chunk;
        if (this.buffer.length > this.limit)
            throw new Error('Daemon event is too large.');
        let boundary: number;
        while ((boundary = this.buffer.indexOf('\n\n')) >= 0) {
            const block = this.buffer.slice(0, boundary);
            this.buffer = this.buffer.slice(boundary + 2);
            const event = parseEventBlock(block);
            if (event) this.onEvent(event.type, event.data, event.id);
        }
    }
}
