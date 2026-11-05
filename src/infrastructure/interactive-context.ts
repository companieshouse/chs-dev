import { AsyncLocalStorage } from 'node:async_hooks';
import type { InteractiveCommand } from '../application/interactions.js';
import type { OperationResult } from '../domain/runtime-strategy.js';

type Runner = (request: InteractiveCommand) => Promise<OperationResult>;
const runners = new AsyncLocalStorage<Runner>();
export const interactiveRunner = () => runners.getStore();
export const withInteractiveRunner = <T>(
    runner: Runner,
    work: () => Promise<T>,
) => runners.run(runner, work);
