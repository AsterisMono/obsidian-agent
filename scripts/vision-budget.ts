import { positiveSetting } from './vision-report.ts';

export class VisionBudget {
  readonly maxSteps: number;
  readonly maxRequests: number;
  readonly outputTokens: number;
  readonly maxTokens: number;
  readonly maxCost: number;
  steps = 0;
  calls = 0;
  requests = 0;
  reservedTokens = 0;
  reservedCost = 0;

  constructor(env: NodeJS.ProcessEnv) {
    this.maxSteps = positiveSetting(env, 'VISION_MAX_STEPS', 60, 200);
    this.maxRequests = positiveSetting(env, 'VISION_MAX_REQUESTS', this.maxSteps + 8, 208);
    this.outputTokens = positiveSetting(env, 'VISION_MAX_OUTPUT_TOKENS', 8192, 16384);
    this.maxTokens = positiveSetting(env, 'VISION_MAX_TOTAL_TOKENS', 2000000, 10000000);
    this.maxCost = positiveSetting(env, 'VISION_MAX_COST_USD', 1, 5);
    for (const value of [this.maxSteps, this.maxRequests, this.outputTokens, this.maxTokens])
      if (!Number.isInteger(value))
        throw new Error('Step, request, and token limits must be integers.');
  }

  tool(name: string): string | undefined {
    this.calls += 1;
    if (this.calls > this.maxSteps + 8) return 'Total tool-call limit reached.';
    if (name === 'report_finding' || name === 'finish') return;
    if (this.steps >= this.maxSteps)
      return 'Action budget exhausted. Only report_finding and finish remain available.';
    this.steps += 1;
    return;
  }

  reserve(inputTokens: number, inputRate: number, outputRate: number): void {
    const tokens = inputTokens + this.outputTokens;
    const cost = (inputTokens * inputRate + this.outputTokens * outputRate) / 1000000;
    if (this.requests >= this.maxRequests) throw new Error('Model request budget exhausted.');
    if (inputTokens > 128000)
      throw new Error('Model input exceeds the conservative 128K token limit.');
    if (this.reservedTokens + tokens > this.maxTokens)
      throw new Error('Run token budget exhausted.');
    if (this.reservedCost + cost > this.maxCost)
      throw new Error('Run estimated cost budget exhausted.');
    this.requests += 1;
    this.reservedTokens += tokens;
    this.reservedCost += cost;
  }

  description(): string {
    return `Actions remaining: ${String(Math.max(0, this.maxSteps - this.steps))}; requests remaining: ${String(this.maxRequests - this.requests)}. Report findings and finish before exhaustion.`;
  }
}
