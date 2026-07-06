Feature: Brain — per-org token metering
  Every brain call writes a BrainUsage row (tier, surface, tokens) and the org
  can see its aggregate. The sweep runs with BRAIN_METER_STUB=1 so metering is
  observable offline (prod never meters the stub).

  Background:
    Given the API base path is "/api/v1"
    And I am signed in as "owner@uruk.io"
    And I have a BDD project named "OmniPizza"

  @AC-METER-01
  Scenario: A routed chat send meters the router and the answer
    Given a chat session for the project
    When I send the chat message "our checkout p95 latency explodes under load"
    Then my org has a BrainUsage row with surface "ROUTER" and tier "HAIKU"
    And my org has a BrainUsage row with surface "CHAT" and tier "SONNET"

  @AC-METER-01
  Scenario: A pinned send skips the router row
    Given a chat session pinned to the "sec" agent
    When I send the chat message "how should we test this"
    Then my org has no BrainUsage row with surface "ROUTER"
    And my org has a BrainUsage row with surface "CHAT" and tier "SONNET"

  @AC-METER-02
  Scenario: Draft generation meters GENERATE
    When I generate drafts from "a checkout flow with card and cash"
    Then my org has a BrainUsage row with surface "GENERATE" and tier "SONNET"

  @AC-METER-03
  Scenario: The usage view aggregates per tier and surface
    Given a chat session for the project
    And I send the chat message "our checkout p95 latency explodes under load"
    When I GET "/orgs/{orgId}/brain/usage"
    Then the response status is 200
    And the usage view totals at least 1 call for surface "CHAT"
    And the usage view carries input and output token totals

  @AC-METER-03
  Scenario: A viewer may read the org usage
    Given "viewer@uruk.io" is a viewer in my org
    When "viewer@uruk.io" GETs "/orgs/{orgId}/brain/usage"
    Then the response status is 200

  @AC-METER-04
  Scenario: Usage is tenant-isolated
    Given a second org "Nippur" with owner "owner@nippur.io" exists
    When "owner@nippur.io" GETs my org brain usage
    Then the response status is 404
