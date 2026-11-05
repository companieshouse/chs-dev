/** Independent schedules prevent slow status or authentication work from starving probes. */
export class Supervisor {
    private jobs: {
        abort: AbortController;
        timer?: ReturnType<typeof setTimeout>;
        pending?: Promise<void>;
    }[] = [];
    every(
        interval: number,
        work: (signal: AbortSignal) => Promise<void>,
        failure: (error: unknown) => void = () => {},
    ) {
        const job: (typeof this.jobs)[number] = {
            abort: new AbortController(),
        };
        const run = async () => {
            try {
                await work(job.abort.signal);
            } catch (error) {
                if (!job.abort.signal.aborted) failure(error);
            }
            if (!job.abort.signal.aborted)
                job.timer = setTimeout(() => {
                    job.pending = run();
                }, interval);
        };
        this.jobs.push(job);
        job.pending = run();
    }
    async close() {
        for (const job of this.jobs) {
            job.abort.abort();
            clearTimeout(job.timer);
        }
        await Promise.all(this.jobs.map((j) => j.pending));
        this.jobs = [];
    }
}
