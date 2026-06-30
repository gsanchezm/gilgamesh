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
 *
 * Keyword detection is done with linear string operations on the trimmed line (NOT regexes with `\s*`
 * over user input — those are polynomial-ReDoS prone, flagged by SAST: `Feature.content` is up to 256 KB
 * of untrusted text).
 */
const SCENARIO_PREFIXES = ['Scenario Outline:', 'Scenario Template:', 'Scenario:'] as const;

/** Returns the scenario name if the trimmed line opens a scenario, else null. */
function scenarioName(trimmed: string): string | null {
  for (const prefix of SCENARIO_PREFIXES) {
    if (trimmed.startsWith(prefix)) return trimmed.slice(prefix.length).trim();
  }
  return null;
}

export function parseFeature(content: string): ParsedFeature {
  let name: string | null = null;
  const scenarios: ParsedScenario[] = [];
  let inDocString = false;

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    // Doc-string fences (""" or ```) delimit step arguments; a "Scenario:" inside one is data,
    // not a real scenario, so toggle on the fence and skip everything between fences.
    if (trimmed === '"""' || trimmed === '```') {
      inDocString = !inDocString;
      continue;
    }
    if (inDocString) continue;
    if (trimmed === '' || trimmed.startsWith('#')) continue;

    if (name === null) {
      if (trimmed.startsWith('Feature:')) {
        name = trimmed.slice('Feature:'.length).trim();
        continue;
      }
      // Only tags may precede the Feature: declaration; anything else is malformed.
      if (trimmed.startsWith('@')) continue;
      throw new DomainError('Gherkin must start with a "Feature:" declaration.');
    }

    const sn = scenarioName(trimmed);
    if (sn !== null) scenarios.push({ name: sn, order: scenarios.length });
  }

  if (name === null) throw new DomainError('Gherkin must start with a "Feature:" declaration.');
  if (scenarios.length === 0) throw new DomainError('A feature must contain at least one scenario.');
  return { name, scenarios };
}
