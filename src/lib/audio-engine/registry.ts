/**
 * Strategy registry: picks how to compare a sound with a reference.
 *
 * Strategies are tried in registration order and the first whose
 * appliesTo(reference) is true wins, so specific strategies (pitch, for
 * instrument notes) are registered before general ones (timbre, which
 * applies to everything). Adding a strategy = registering it; no other code
 * changes.
 */
import { pitchStrategy } from "./strategies/pitch";
import { timbreStrategy } from "./strategies/timbre";
import type { ComparisonStrategy, ReferenceMeta } from "./types";

// Strategies are stored with their feature type erased; each one validates
// its own features with parseFeatures() before comparing.
type AnyStrategy = ComparisonStrategy<never> | ComparisonStrategy<unknown>;

export class StrategyRegistry {
  private readonly strategies: ComparisonStrategy<unknown>[] = [];

  constructor(strategies: AnyStrategy[] = []) {
    for (const strategy of strategies) this.register(strategy);
  }

  register(strategy: AnyStrategy): void {
    if (this.strategies.some((s) => s.id === strategy.id)) throw new Error(`Strategy "${strategy.id}" is already registered`);
    this.strategies.push(strategy as ComparisonStrategy<unknown>);
  }

  list(): readonly ComparisonStrategy<unknown>[] {
    return this.strategies;
  }

  get(id: string): ComparisonStrategy<unknown> | undefined {
    return this.strategies.find((s) => s.id === id);
  }

  /** The strategy to use for this reference. Throws if none applies (register a fallback). */
  pickFor(reference: ReferenceMeta): ComparisonStrategy<unknown> {
    const strategy = this.strategies.find((s) => s.appliesTo(reference));
    if (!strategy) throw new Error("No comparison strategy applies to this reference");
    return strategy;
  }

  /** True if results/features with this id + version come from a current strategy. */
  isCurrent(id: string, version: string): boolean {
    return this.get(id)?.version === version;
  }
}

/** The app's registry: pitch for instrument notes, timbre for everything else. */
export const defaultRegistry = new StrategyRegistry([pitchStrategy, timbreStrategy]);
