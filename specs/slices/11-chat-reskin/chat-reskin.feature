Feature: Chat re-skin — session list & history reads
  As a member I browse my project's past conversations (newest first, titled by what I asked),
  reopen any of them with full history, and reach a deity directly from its agent tile.

  Background:
    Given the API base path is "/api/v1"
    And I am signed in as "owner@uruk.io"
    And I have a BDD project named "OmniPizza"

  @AC-CRS-01
  Scenario: An empty project lists no sessions
    When I list the chat sessions for the project
    Then the response status is 200
    And the session list has 0 sessions

  @AC-CRS-01
  Scenario: Sessions list newest-first with derived titles
    Given two chat sessions for the project
    And I send the chat message "how do we test checkout?" to the second session
    When I list the chat sessions for the project
    Then the response status is 200
    And the session list has 2 sessions
    And the first listed session is the second session created
    And the first listed session has title "how do we test checkout?"

  @AC-CRS-01
  Scenario: A session with no USER message has a null title
    Given a chat session for the project
    When I list the chat sessions for the project
    Then the first listed session has a null title

  @AC-CRS-01
  Scenario: A long first message is trimmed to 60 characters
    Given a chat session for the project
    And I send the chat message "this question about performance budgets is deliberately far longer than sixty characters"
    When I list the chat sessions for the project
    Then the first listed session title is the first 60 characters of "this question about performance budgets is deliberately far longer than sixty characters"

  @AC-CRS-02
  Scenario: Activity bumps a session to the top of the list
    Given two chat sessions for the project
    And I send the chat message "waking the older conversation" to the first session
    When I list the chat sessions for the project
    Then the first listed session is the first session created

  @AC-CRS-03
  Scenario: History returns the conversation in order
    Given a chat session for the project
    And I send the chat message "hello pantheon"
    When I fetch the chat history for the session
    Then the response status is 200
    And the chat history is a USER message "hello pantheon" followed by an AGENT answer

  @AC-CRS-04
  Scenario: Another tenant cannot list my project's sessions
    Given a chat session for the project
    And a second org "Nippur" with owner "owner@nippur.io" exists
    When "owner@nippur.io" lists the chat sessions for my project
    Then the response status is 404

  @AC-CRS-04
  Scenario: Another tenant cannot read my session's history
    Given a chat session for the project
    And a second org "Nippur" with owner "owner@nippur.io" exists
    When "owner@nippur.io" fetches the chat history for my session
    Then the response status is 404

  @AC-CRS-04
  Scenario: An unknown session's history is not found
    When I fetch the chat history for an unknown session
    Then the response status is 404

  @AC-CRS-05
  Scenario: A viewer cannot list sessions
    Given "viewer@uruk.io" is a viewer in my org
    When "viewer@uruk.io" lists the chat sessions for the project
    Then the response status is 403

  @AC-CRS-05
  Scenario: A viewer cannot read history
    Given a chat session for the project
    And "viewer@uruk.io" is a viewer in my org
    When "viewer@uruk.io" fetches the chat history for the session
    Then the response status is 403

  @AC-CRS-06
  Scenario: A tile-pinned session appears pinned in the list
    Given a chat session pinned to the "perf" agent
    When I list the chat sessions for the project
    Then the session list has 1 sessions
    And the first listed session is pinned to the "perf" agent
