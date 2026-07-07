Feature: Billing — usage-counter rollover (S14-6)
  At a billing-period boundary an operator runs the rollover, which resets an org's two usage
  counters — execution minutes (runMinutesUsed) AND AI tokens (brainTokensUsed) — to zero together
  in one atomic operation, so the next period's quota gates start from a clean tally. It touches only
  those two counters; plan, quotas and every other subscription field are untouched. There is no HTTP
  route — the operator script drives the ResetBillingUsage use case directly.

  Background:
    Given the API base path is "/api/v1"
    And I am signed in as "owner@uruk.io"
    And I have a BDD project named "OmniPizza"

  @AC-ROLL-01 @AC-ROLL-02
  Scenario: The rollover zeroes BOTH counters together and leaves every other field untouched
    Given my org's usage counters are 250 execution minutes and 73000 AI tokens
    And I note the org's subscription plan and quotas
    When the billing rollover runs for my org
    Then the rollover reset 1 subscription
    And the org's execution minutes counter is 0
    And the org's AI token counter is 0
    And the org's subscription plan and quotas are unchanged

  @AC-ROLL-04
  Scenario: The rollover is idempotent — resetting an org already at zero keeps it at zero
    Given my org's usage counters are 0 execution minutes and 0 AI tokens
    When the billing rollover runs for my org
    Then the rollover reset 1 subscription
    And the org's execution minutes counter is 0
    And the org's AI token counter is 0
    When the billing rollover runs for my org
    Then the rollover reset 1 subscription
    And the org's execution minutes counter is 0
    And the org's AI token counter is 0

  @AC-ROLL-03
  Scenario: Resetting all orgs zeroes every org's counters
    Given my org's usage counters are 480 execution minutes and 9000000 AI tokens
    And another org has usage counters of 120 execution minutes and 5000 AI tokens
    When the billing rollover runs for all orgs
    Then the rollover reset 2 subscriptions
    And the org's execution minutes counter is 0
    And the org's AI token counter is 0
    And the other org's usage counters are both zero

  @AC-ROLL-06
  Scenario: A charge committed before the rollover is cleared; a charge after counts against the new period
    Given my org's usage counters are 100 execution minutes and 40000 AI tokens
    When the billing rollover runs for my org
    Then the org's execution minutes counter is 0
    And the org's AI token counter is 0
    Given my org is charged 5 execution minutes and 1200 AI tokens
    Then the org's execution minutes counter is 5
    And the org's AI token counter is 1200
