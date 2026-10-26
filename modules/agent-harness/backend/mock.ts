import { emptyUsage, type Executor, type Observation, type Outcome, type Task } from "./core.ts";

export const syntheticOutcome = (task: Task): Outcome => ({
  output: { summary: "A synthetic product update is ready for editorial review.", source_binding: task.source_binding },
  usage: emptyUsage(), estimated_cost: null,
});

// A scriptable fake executor. It does not launch OpenCode, tools, a model, or any background worker.
export class MockExecutor implements Executor {
  readonly submitted: string[] = [];
  readonly queried: string[] = [];
  readonly cancellations: string[] = [];
  next: Observation | null = null;
  reply: (task: Task) => Promise<Observation>;
  constructor(reply: (task: Task) => Promise<Observation> = async task => ({ state: "succeeded", outcome: syntheticOutcome(task) })) { this.reply = reply; }
  async submit(task: Task, context: Parameters<Executor["submit"]>[1]): Promise<Observation> {
    this.submitted.push(task.task_id);
    context.bind(`mock:${task.project}:${task.task_id}`);
    return this.reply(task);
  }
  async status(upstream_ref: string): Promise<Observation> { this.queried.push(upstream_ref); return this.next ?? { state: "unknown" }; }
  async cancel(upstream_ref: string): Promise<"requested"> { this.cancellations.push(upstream_ref); return "requested"; }
}
