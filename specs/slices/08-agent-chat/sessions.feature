Feature: Agent Chat — sessions & messages
  As a member I chat with the pantheon and my sessions/messages persist in my org only.

  Background:
    Given the API base path is "/api/v1"
    And I am signed in as "owner@uruk.io"
    And I have a BDD project named "OmniPizza"

  @AC-CHAT-01
  Scenario: Create a chat session
    When I create a chat session for the project
    Then the response status is 201
    And the session belongs to my org and the project
    And the session has no pinned agent

  @AC-CHAT-01
  Scenario: Create a session pinned from an agent tile
    When I create a chat session pinned to the "perf" agent
    Then the response status is 201
    And the session is pinned to the "perf" agent

  @AC-CHAT-02
  Scenario: A message and its answer persist in order
    Given a chat session for the project
    When I send the chat message "hello pantheon"
    Then the response status is 201
    And the session has a USER message "hello pantheon" followed by an AGENT answer in the database

  @AC-CHAT-05
  Scenario: Pinning an unknown agent is rejected
    When I create a chat session pinned to an agent that is not in my org catalog
    Then the response status is 422

  @AC-CHAT-03
  Scenario: Another tenant cannot reach my session
    Given a chat session for the project
    And a second org "Nippur" with owner "owner@nippur.io" exists
    When "owner@nippur.io" sends a chat message to my session
    Then the response status is 404
    And the org "Nippur" has 0 chat messages in the database

  @AC-CHAT-04
  Scenario: A viewer cannot chat
    Given "viewer@uruk.io" is a viewer in my org
    When "viewer@uruk.io" creates a chat session for the project
    Then the response status is 403

  # AC-CHAT-06 (send is rate-limited): the path joins RateLimitGuard.LIMITED_PATHS and uses the same
  # guard proven by the auth rate-limit e2e; the BDD sweep raises the limit (AUTH_RATE_LIMIT), so the
  # 429 path is verified outside this sweep, like AC-AUTH-13 / AC-GEN-04.
  @wip
  Scenario: Sending is rate-limited
    When I exceed the chat message threshold
    Then the response status is 429
