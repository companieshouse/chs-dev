import { Command } from "@oclif/core";
import TaskLoop from "../run/task-loop.js";


const delay = ms => new Promise(resolve => setTimeout(resolve, ms))

export default class TestTaskLoop extends Command {
    async run(): Promise<any> {

        TaskLoop.start(5000, {
            debug: (msg: string) => this.debug(msg)
        });

        await delay(2000)

        for (let i = 0; i < 10; i++) {
            const execute = async () => {
                await delay(300)
                this.log(`Task ${i} run :D`)
                await delay(800)
                this.log(`Task ${i} run again :D`)
            }
    
            TaskLoop.submit({
                execute
            })
        }

        await delay(7500)

        TaskLoop.stop();
    }

}
