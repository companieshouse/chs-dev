import { PassThrough } from 'node:stream';
import { setTimeout as delay } from 'node:timers/promises';
import { createElement } from 'react';
import { Box, render } from 'ink';
import { stripVTControlCharacters } from 'node:util';

export function terminal(
    element: ReturnType<typeof createElement>,
    { columns = 100, rows = 32 }: { columns?: number; rows?: number } = {},
) {
    const stdout = Object.assign(new PassThrough(), {
        columns,
        rows,
        isTTY: true,
    });
    const stdin = Object.assign(new PassThrough(), {
        isTTY: true,
        setRawMode: () => {},
        ref: () => {},
        unref: () => {},
    });
    let output = '';
    let lastFrame = '';
    stdout.on('data', (chunk) => {
        lastFrame = chunk.toString();
        output += lastFrame;
    });
    let currentElement = element;
    const frame = (next: ReturnType<typeof createElement>) =>
        createElement(
            Box,
            { width: stdout.columns, height: stdout.rows },
            next,
        );
    const app = render(frame(element), {
        stdout: stdout as any,
        stdin: stdin as any,
        stderr: stdout as any,
        debug: true,
        patchConsole: false,
        exitOnCtrlC: false,
        interactive: true,
    });
    return {
        app,
        rerender: (next: ReturnType<typeof createElement>) => {
            currentElement = next;
            app.rerender(frame(next));
        },
        resize: (columns: number, rows: number) => {
            stdout.columns = columns;
            stdout.rows = rows;
            stdout.emit('resize');
            app.rerender(frame(currentElement));
        },
        frame: () => stripVTControlCharacters(lastFrame),
        output: () => stripVTControlCharacters(output),
        clear: () => {
            output = '';
        },
        waitFor: async (pattern: RegExp, timeoutMs = 3000) => {
            const deadline = Date.now() + timeoutMs;
            while (Date.now() < deadline) {
                if (pattern.test(stripVTControlCharacters(lastFrame))) return;
                await delay(20);
            }
            throw new Error(
                `Timed out waiting for ${pattern.source.slice(0, 80)}. Last frame:\n${stripVTControlCharacters(lastFrame)}`,
            );
        },
        key: async (key: string) => {
            await app.waitUntilRenderFlush();
            stdin.write(key);
            await delay(100);
        },
    };
}
