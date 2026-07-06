Feature: Billing — AI Brain token allowances (per-plan quota + blocking)
  As a workspace owner my org has a monthly AI token allowance derived from its plan; every
  org-attributed brain call (CHAT / ROUTER / GENERATE / EMBED) charges billable tokens
  (input + output, cache excluded) against it atomically, and an exhausted allowance blocks
  AI work — 402 on API surfaces, narrated in-chat — until the plan is upgraded.

  Background:
    Given the API base path is "/api/v1"
    And I am signed in as "owner@uruk.io"
    And I have a BDD project named "OmniPizza"

  @AC-TOKB-01
  Scenario: A new org seeds the FREE allowance and plan changes remap the quota preserving usage
    When I GET the subscription
    Then the response status is 200
    And the subscription AI token quota is 100000
    And the subscription AI tokens used is 0
    Given a chat session for the project
    When I send the chat message "How should we test the checkout flow?"
    Then the response status is 201
    And the org has used at least 1 AI token
    Given I note the org's AI tokens used
    When I change the plan to "STARTER"
    Then the response status is 200
    And the subscription AI token quota is 2000000
    And the org's AI tokens used is unchanged
    When I change the plan to "GROWTH"
    Then the response status is 200
    And the subscription AI token quota is 10000000
    And the org's AI tokens used is unchanged

  @AC-TOKB-02
  Scenario: A chat send charges the org's counter exactly its billable usage-row tokens
    Given a chat session for the project
    When I send the chat message "What is the riskiest area of this API?"
    Then the response status is 201
    And my org has a BrainUsage row with surface "CHAT" and tier "SONNET"
    And my org has a BrainUsage row with surface "ROUTER" and tier "HAIKU"
    And the org's AI tokens used equals the billable sum of its BrainUsage rows

  @AC-TOKB-03
  Scenario: A generate call charges its GENERATE (and grounding EMBED) rows the same way
    When I generate drafts from "checkout happy path"
    Then the response status is 200
    And my org has a BrainUsage row with surface "GENERATE" and tier "SONNET"
    And the org's AI tokens used equals the billable sum of its BrainUsage rows

  @AC-TOKB-04
  Scenario: An exhausted allowance blocks generate with 402 and no brain call is made
    Given my org's subscription has no AI tokens remaining
    And I note the org's BrainUsage row count
    When I generate drafts from "checkout happy path"
    Then the response status is 402
    And the response body is a "Problem" document
    And the org's BrainUsage row count is unchanged

  @AC-TOKB-04
  Scenario: An exhausted allowance blocks the org-attributed knowledge search with 402
    Given the knowledge base has QA reference material
    And my org's subscription has no AI tokens remaining
    When I search the knowledge base for "boundary value analysis"
    Then the response status is 402
    And the response body is a "Problem" document

  @AC-TOKB-04
  Scenario: An exhausted allowance blocks the knowledge document upload with 402
    Given my org's subscription has no AI tokens remaining
    When I upload a knowledge document named "notes.md" with QA content
    Then the response status is 402
    And the response body is a "Problem" document

  @AC-TOKB-05
  Scenario: An exhausted allowance never breaks chat — the block is narrated, nothing is charged
    Given a chat session for the project
    And my org's subscription has no AI tokens remaining
    And I note the org's BrainUsage row count
    When I send the chat message "hello pantheon"
    Then the response status is 201
    And the session has a USER message "hello pantheon" persisted
    And the chat narrates an AI token allowance outcome
    And the org's BrainUsage row count is unchanged

  @AC-TOKB-06
  Scenario: SCALE is unlimited — never blocked, but usage keeps being metered and charged
    When I change the plan to "SCALE"
    Then the response status is 200
    Given a chat session for the project
    And my org's subscription has no AI tokens remaining
    When I send the chat message "hello unlimited"
    Then the response status is 201
    And the chat does not narrate an AI token allowance outcome
    And my org has a BrainUsage row with surface "CHAT" and tier "SONNET"
    When I generate drafts from "checkout happy path"
    Then the response status is 200

  @AC-TOKB-07
  Scenario: Checkout confirmation preserves the counters (the executions-consistent no-reset rule)
    Given a chat session for the project
    When I send the chat message "How should we test the checkout flow?"
    Then the response status is 201
    And the org has used at least 1 AI token
    Given I note the org's AI tokens used
    When I start checkout
    Then the response status is 200
    When I confirm the checkout
    Then the response status is 200
    And the org's AI tokens used is unchanged
