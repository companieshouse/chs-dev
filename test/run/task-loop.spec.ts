import { expect, jest } from "@jest/globals";
import { PredicatedTask, TaskLoop } from "../../src/run/task-loop";

const setTimeoutMock = jest.fn();
const clearTimeoutMock = jest.fn();

// @ts-expect-error
global.setTimeout = setTimeoutMock;
global.clearTimeout = clearTimeoutMock;

describe("TaskLoop", () => {

    let taskLoop: TaskLoop;

    const mockTask = ({predicate, id, name, dependencies}: Partial<PredicatedTask>) => ({
        execute: jest.fn(),
        ...(predicate ? {predicate: jest.fn()} : {}),
        ...(typeof id !== "undefined" ? {id} : {}),
        ...(typeof name !== "undefined" ? {name} : {}),
        dependencies: dependencies || []
    })

    const pollIntervalMillis = 500;
    const loggerMock = {
        debug: jest.fn(),
        error: jest.fn()
    }

    beforeEach(() => {
        jest.resetAllMocks();

        taskLoop = new TaskLoop();
    });


    it("adds task to tasks list", () => {
        const task = mockTask({id: "123456789", name: "taskone"});

        taskLoop.submit(task as PredicatedTask);

        // @ts-expect-error
        expect(Object.keys(taskLoop.activeTasks)).toContain(task.id);
        // @ts-expect-error
        expect(taskLoop.activeTasks[task.id]).toEqual({...task, previousAttempts: [], complete: false});
    })


    it("adds multiple tasks to tasks list", () => {
        const taskOne = mockTask({id: "123456789", name: "taskone"});
        const taskTwo = mockTask({id: "223456789", name: "tasktwo"});

        taskLoop.submit(taskOne as PredicatedTask, taskTwo as PredicatedTask);

        // @ts-expect-error
        expect(Object.keys(taskLoop.activeTasks)).toContain(taskOne.id);
        // @ts-expect-error
        expect(taskLoop.activeTasks[taskOne.id]).toEqual({
            ...taskOne,
            previousAttempts: [],
            complete: false
        });

        // @ts-expect-error
        expect(Object.keys(taskLoop.activeTasks)).toContain(taskTwo.id);
        // @ts-expect-error
        expect(taskLoop.activeTasks[taskTwo.id]).toEqual({
            ...taskTwo,
            previousAttempts: [],
            complete: false
        });
    })

    it("creates id when not defined", () => {
        const task = mockTask({}) as Partial<PredicatedTask>;

        taskLoop.submit(task);

        // @ts-expect-error
        const persistedTask = Object.values(taskLoop.activeTasks)[0]

        expect(persistedTask).toBeDefined();

        expect(persistedTask).toEqual({
            id: expect.any(String),
            name: undefined,
            execute: task.execute,
            predicate: undefined,
            dependencies: [],
            complete: false,
            previousAttempts: []
        });
    })

    it("sets timeout with run function", () => {
        taskLoop.start(pollIntervalMillis, loggerMock);

        expect(setTimeoutMock).toHaveBeenCalledWith(expect.any(Function), pollIntervalMillis);
    })

    it("clears timeout when set", () => {
        setTimeoutMock.mockReturnValue(123467);

        taskLoop.start(pollIntervalMillis, loggerMock);

        taskLoop.stop();

        expect(clearTimeoutMock).toHaveBeenCalledWith(123467);
    })
    
    it("throws error when loop not started", () => {
        expect(() => taskLoop.stop()).toThrowError(new Error("Task loop not started"))
    })

    it("sets running correctly", () => {
        setTimeoutMock.mockReturnValue(123467);

        taskLoop.start(pollIntervalMillis, loggerMock);

        // @ts-expect-error
        expect(taskLoop.running).toBe(true);

        taskLoop.stop();

        // @ts-expect-error
        expect(taskLoop.running).toBe(false);
    })

    describe("run", () => {

        // @ts-expect-error
        const run = () => taskLoop.run()

        beforeEach(() => {
            jest.resetAllMocks();

            taskLoop = new TaskLoop();
        });

        it("runs tasks and only executes once", async () => {
            const task = mockTask({});
            task.execute.mockResolvedValue(undefined as never);

            taskLoop.submit(task as PredicatedTask);

            // @ts-expect-error
            await taskLoop.run();

            // @ts-expect-error
            await taskLoop.run();

            expect(task.execute).toHaveBeenCalledTimes(1)
        })

        it("recursively runs another setTimeout", async () => {
            const task = mockTask({});
            task.execute.mockResolvedValue(undefined as never);

            taskLoop.submit(task as PredicatedTask);

            // @ts-expect-error
            taskLoop.pollInterval = pollIntervalMillis;

            // @ts-expect-error
            taskLoop.running = true;

            // @ts-expect-error
            await taskLoop.run();

            expect(setTimeoutMock).toHaveBeenCalledWith(
                expect.any(Function), pollIntervalMillis
            )
        })

        it("does not execute task if its dependencies have not completed", async () => {
            const task = mockTask({
                dependencies: ["1234567"]
            });


            task.execute.mockResolvedValue(undefined as never);

            taskLoop.submit(task as PredicatedTask);

            // @ts-expect-error
            await taskLoop.run();

            expect(task.execute).not.toHaveBeenCalled();
        })

        it("it executes task if dependency has completed successfully", async () => {
            const task = mockTask({
                dependencies: ["1234567"]
            });

            const completedTask = mockTask({
                id: "1234567"
            })

            task.execute.mockResolvedValue(undefined as never);
            completedTask.execute.mockResolvedValue(undefined as never);

            taskLoop.submit(completedTask as PredicatedTask);

            // @ts-expect-error
            await taskLoop.run();
            
            taskLoop.submit(task as PredicatedTask);
            
            // @ts-expect-error
            await taskLoop.run();

            expect(task.execute).toHaveBeenCalled();
        })

        it("attempts task")
    })
});
