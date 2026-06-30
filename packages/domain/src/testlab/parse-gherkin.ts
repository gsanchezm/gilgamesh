import { DomainError } from '../errors';

export interface ParsedScenario {
  name: string;
  order: number;
}

export interface ParsedFeature {
  name: string;
  scenarios: ParsedScenario[];
}

/**
 * Parses the slice-2 Gherkin subset (`Feature:`, `Scenario:`/`Scenario Outline:`, `Background:`, tags,
 * comments) into the feature name and its ordered scenarios. Background is not a scenario. Throws
 * {@link DomainError} when there is no `Feature:` declaration or no scenarios. Pure — no framework imports.
 */
const FEATURE_RE = /^\s*Feature:\s*(.*)$/;
const SCENARIO_RE = /^\s*Scenario(?: Outline| Template)?:\s*(.*)$/;

export function parseFeature(content: string): ParsedFeature {
  let name: string | null = null;
  const scenarios: ParsedScenario[] = [];

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;

    if (name === null) {
      const fm = FEATURE_RE.exec(line);
      if (fm) {
        name = fm[1]!.trim();
        continue;
      }
      // Only tags may precede the Feature: declaration; anything else is malformed.
      if (trimmed.startsWith('@')) continue;
      throw new DomainError('Gherkin must start with a "Feature:" declaration.');
    }

    const sm = SCENARIO_RE.exec(line);
    if (sm) scenarios.push({ name: sm[1]!.trim(), order: scenarios.length });
  }

  if (name === null) throw new DomainError('Gherkin must start with a "Feature:" declaration.');
  if (scenarios.length === 0) throw new DomainError('A feature must contain at least one scenario.');
  return { name, scenarios };
}
