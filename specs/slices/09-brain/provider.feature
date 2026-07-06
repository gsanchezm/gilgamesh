Feature: Brain — provider selection & offline determinism
  The real Claude adapter drops in behind the frozen AgentBrainPort; every offline path
  stays on the deterministic stub. The sweep runs with BRAIN_MODE=offline (harness).

  Background:
    Given the API base path is "/api/v1"
    And I am signed in as "owner@uruk.io"
    And I have a BDD project named "OmniPizza"

  @AC-BRAIN-01
  Scenario: Without a key, brain-backed features are deterministic and offline
    Given a chat session for the project
    When I send the chat message "our checkout p95 latency explodes under load"
    Then the answering agent slot is "perf"
    And no network call left the process

  @AC-BRAIN-01
  Scenario: Identical inputs yield identical outputs on the stub
    Given two chat sessions for the project
    When I send the chat message "load test the api endpoints" to both sessions
    Then both AGENT answers are identical

  # AC-BRAIN-02 (resolution order BYOK -> platform key -> stub) is verified at unit level with fakes:
  # exercising a real key selection in BDD would require network. The offline forcing is what this
  # sweep proves end to end.
  @AC-BRAIN-03
  Scenario: A brain failure narrates instead of failing the send
    Given the brain is wired to fail on the next answer
    And a chat session for the project
    When I send the chat message "hello pantheon"
    Then the response status is 201
    And the chat narrates a brain-unavailable outcome
    And the session has a USER message "hello pantheon" persisted
