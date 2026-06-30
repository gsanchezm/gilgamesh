import { describe, expect, it } from 'vitest';
import { DomainError } from '../errors';
import { parseFeature } from './parse-gherkin';

const FEATURE = `
@checkout
Feature: Checkout flow
  As a shopper I want to pay

  Background:
    Given a cart with items

  Scenario: Pay with card
    When I pay
    Then I see a receipt

  @wip
  Scenario Outline: Pay with <method>
    When I pay with <method>
    Examples:
      | method |
      | paypal |
`;

describe('parseFeature (gherkin)', () => {
  it('extracts the feature name and its scenarios in order', () => {
    const f = parseFeature(FEATURE);
    expect(f.name).toBe('Checkout flow');
    expect(f.scenarios).toEqual([
      { name: 'Pay with card', order: 0 },
      { name: 'Pay with <method>', order: 1 },
    ]);
  });

  it('ignores Background, tags, comments and blank lines', () => {
    const f = parseFeature('# a comment\nFeature: F\n  Background:\n    Given x\n  Scenario: Only one\n    Then y\n');
    expect(f.scenarios).toEqual([{ name: 'Only one', order: 0 }]);
  });

  it('throws when there is no Feature: line', () => {
    expect(() => parseFeature('Scenario: x\n  Then y')).toThrow(DomainError);
  });

  it('throws when the feature has no scenarios', () => {
    expect(() => parseFeature('Feature: Empty\n  Background:\n    Given x')).toThrow(DomainError);
  });

  it('trims surrounding whitespace from the feature and scenario names', () => {
    const f = parseFeature('Feature:   Spaced   \n  Scenario:   Trimmed   \n    Then y');
    expect(f.name).toBe('Spaced');
    expect(f.scenarios[0]?.name).toBe('Trimmed');
  });

  it('does not count "Scenario:" lines inside a doc string', () => {
    const f = parseFeature(
      'Feature: F\n  Scenario: Real\n    Given a payload\n      """\n      Scenario: not a real one\n      """\n    Then ok\n',
    );
    expect(f.scenarios.map((s) => s.name)).toEqual(['Real']);
  });
});
