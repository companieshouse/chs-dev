import { v4 as uuidV4 } from "uuid";

type ExecutionHistory = {
    complete: boolean;
    previousAttempts: {
        error: Error,
        time: Date
    }[]
}

export type PredicatedTask = {
    id: string;
    name?: string;
    execute(): Promise<any>
    predicate?: () => boolean;
    dependencies: string[];
}

type Logger = {
    debug: (msg: string) => void;
    error: (msg: string) => void;
}

export class TaskLoop {

    private timeoutId: ReturnType<typeof setTimeout> | number | undefined;
    private pollInterval: number | undefined;
    private logger: Logger | undefined;
    private running: boolean | undefined;

    private readonly activeTasks: Record<string, PredicatedTask & ExecutionHistory>;
    private readonly completeTasks: Record<string, PredicatedTask & ExecutionHistory>;
    
    constructor() {
        this.timeoutId = undefined;
        this.pollInterval = undefined;
        this.activeTasks = {}
        this.completeTasks = {}
        this.logger = undefined;
        this.running = undefined;
    }

    submit(...tasks: Partial<PredicatedTask>[]): void {
        for (const task of tasks) {
            if (typeof task.execute === "undefined") {
                throw new Error("task missing execute method")
            }

            // Checks for presence of execute formerly
            // @ts-expect-error
            const completedTask: PredicatedTask = typeof task.id === "undefined"
                ? {
                    ...task,
                    id: uuidV4()
                } : task;

            this.activeTasks[completedTask.id] = {
                ...completedTask,
                complete: false,
                previousAttempts: []
            };
        }
    }

    start(pollInterval: number, logger: Logger): void {
        this.pollInterval = pollInterval;
        this.logger = logger;

        this.running = true;

        this.timeoutId = setTimeout(() => this.run(), pollInterval)
    }

    stop(): void {
        if (typeof this.timeoutId === "undefined") {
            throw new Error("Task loop not started")
        }
        
        this.running = false;

        clearTimeout(this.timeoutId as ReturnType<typeof setTimeout>)
    }

    private async run() {
        this.logger?.debug("Running tasks on backlog");

        const tasksToRun = Object.entries(this.activeTasks)
            .filter(([_, task]) => !task.dependencies.some(dependency => {
                const dependentTask = this.completeTasks[dependency];

                return !(dependentTask && dependentTask.complete);
            }))

        for (const [taskId, task] of tasksToRun) {
            this.logger?.debug(`Running task: ${task.name} (${taskId})`);

            try {
                await task.execute().then(() => {
                    this.logger?.debug(`task: ${task.name} (${taskId}) complete`)
                })
                delete this.activeTasks[taskId]
                this.completeTasks[taskId] = {
                    ...task,
                    complete: true
                }
            } catch (error) {

            }
        }

        if (this.running) {
            this.timeoutId = setTimeout(
                () => this.run(),
                this.pollInterval
            );
        }
    }

}

export default new TaskLoop();
