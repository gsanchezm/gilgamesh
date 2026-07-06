Feature: Agent Chat — tool-called runs and authoring
  A chat-triggered run is a first-class Run: quota, RBAC and audit all apply.

  Background:
    Given the API base path is "/api/v1"
    And I am signed in as "owner@uruk.io"
    And I have a BDD project named "OmniPizza"
    And the project has a feature "Checkout" with 2 scenarios
    And a chat session for the project

  @AC-CRUN-01
  Scenario: Asking for a run enqueues a real Run and links the message
    When I send the chat message "run the Checkout feature"
    Then a Run exists for the project created via the standard trigger path
    And the triggering chat message has its runId set
    And the run trigger is audited

  @AC-CRUN-02
  Scenario: A chat-triggered run respects the quota
    Given my org's subscription has no executions remaining
    When I send the chat message "run the Checkout feature"
    Then no Run is persisted for the project
    And the chat narrates a QUOTA_EXCEEDED outcome

  @AC-CRUN-03
  Scenario: Run progress narrates back into the chat
    When I send the chat message "run the Checkout feature"
    Then the chat event stream narrates the run's events
    And the run summary persists as a SYSTEM message linked to the run

  @AC-CRUN-04
  Scenario: The agent authors only through existing use cases
    When I send the chat message "create a test case for cash payments"
    Then a TestCase exists in the project created via the standard authoring path
    And the test case creation is audited
