# Slice 1 — Agent room (dashboard view)
# Maps 1:1 to spec.md §8 "Agent room" acceptance criteria (AC-ROOM-*).
# Names/enums/paths are verbatim from specs/_keystone/foundation-vocabulary.md.
# AgentRuntimeStatus is derived: IDLE if !enabled; BUSY if in a running RunNode (no runs in slice 1); else ACTIVE.
# Out of scope here: per-agent chat and voice.

Feature: Agent room
  As a member of an organization
  I want to see and control my 11 deity agents per project
  So that the room reflects who is on duty and which tool they use

  Background:
    Given I am signed in as "ishtar@uruk.io"
    And I own an Org with a freshly onboarded Project "OmniPizza"
    And the Project has 11 seeded ToolBinding rows with "enabled" true

  @AC-ROOM-01 @list
  Scenario: List the eleven agents
    When I GET "/projects/{id}/agents"
    Then the response status is 200
    And the body is a list of 11 "ProjectAgentView" items
    And each item carries its ToolBinding "enabled" and "tool" and a derived "AgentRuntimeStatus"

  @AC-ROOM-02 @status
  Scenario Outline: Runtime status derives from enabled
    Given the agent in slot "<slot>" has ToolBinding "enabled" = <enabled>
    When I GET "/projects/{id}/agents"
    Then that agent's "AgentRuntimeStatus" is "<status>"

    Examples:
      | slot | enabled | status |
      | web  | true    | ACTIVE |
      | web  | false   | IDLE   |

  @AC-ROOM-02 @status
  Scenario: BUSY never occurs in slice 1
    Given this slice runs no tests and there are no RunNode rows
    When I GET "/projects/{id}/agents"
    Then no agent has "AgentRuntimeStatus" "BUSY"

  @AC-ROOM-03 @seed
  Scenario: A freshly onboarded project shows all agents active
    When I GET "/projects/{id}/agents"
    Then all 11 agents have "AgentRuntimeStatus" "ACTIVE"

  @AC-ROOM-04 @sleep @persist
  Scenario: Sleep an agent
    When I PATCH "/projects/{id}/agents/web" with a "ToolBindingUpdate":
      | enabled |
      | false   |
    Then the response status is 200
    And the "web" ToolBinding "enabled" is false
    And the "web" agent "AgentRuntimeStatus" is "IDLE"
    And the change persists when I GET "/projects/{id}/agents" again
    And an AuditLog entry "agent.enabled.changed" is recorded

  @AC-ROOM-05 @wake @persist
  Scenario: Wake an agent
    Given the agent in slot "web" is asleep
    When I PATCH "/projects/{id}/agents/web" with a "ToolBindingUpdate":
      | enabled |
      | true    |
    Then the response status is 200
    And the "web" agent "AgentRuntimeStatus" is "ACTIVE"
    And the change persists across reload

  @AC-ROOM-06 @tool @strategy @persist
  Scenario: Change a multi-tool agent's tool
    When I PATCH "/projects/{id}/agents/web" with a "ToolBindingUpdate":
      | tool    |
      | Cypress |
    Then the response status is 200
    And the "web" ToolBinding "tool" is "Cypress"
    And an AuditLog entry "agent.tool.changed" is recorded

  @AC-ROOM-06 @tool @strategy @edge @validation
  Scenario: Reject a tool outside the role's options
    When I PATCH "/projects/{id}/agents/web" with tool "Selenium"
    Then the response status is 422
    And the "web" ToolBinding "tool" is unchanged

  @AC-ROOM-07 @tool @strategy @edge
  Scenario Outline: Single-tool agents are fixed
    When I PATCH "/projects/{id}/agents/<slot>" with tool "<otherTool>"
    Then the response status is 422
    And the "<slot>" ToolBinding "tool" remains "<fixedTool>"

    Examples:
      | slot   | fixedTool      | otherTool  |
      | lead   | Helix Core     | Strategy   |
      | arch   | Strategy       | Helix Core |
      | manual | Suites · Steps | Strategy   |

  @AC-ROOM-08 @wake-all
  Scenario: Awaken the whole team
    Given 4 of the 11 agents are asleep
    When I POST "/projects/{id}/agents/wake-all"
    Then the response status is 200
    And all 11 ToolBinding rows have "enabled" true
    And all 11 agents have "AgentRuntimeStatus" "ACTIVE"
    And an AuditLog entry "agent.wake_all" is recorded

  @AC-ROOM-09 @wake-all @idempotent @edge
  Scenario: Wake-all is idempotent
    Given all 11 agents are already awake
    When I POST "/projects/{id}/agents/wake-all"
    Then the response status is 200
    And the 11 ToolBinding rows are unchanged
    And no duplicate ToolBinding row is created for any agent
    And invoking "wake-all" a second time produces the same result

  @AC-ROOM-10 @kpi
  Scenario: KPIs reflect the roster and update after changes
    When I GET "/projects/{id}/agents"
    Then the KPIs show total agents 11
    And Active 11, Idle 0 and Busy 0
    And the per-family distribution is proceso 3, ui 4, backend 2, guardian 2
    When I sleep the agents in slots "web" and "api"
    Then the KPIs show Active 9 and Idle 2

  @AC-ROOM-11 @security @tenant-isolation @edge
  Scenario: Tenant isolation on agents
    Given a Project "Foreign" belongs to a different Org I am not a member of
    When I GET "/projects/Foreign/agents"
    Then the response status is 404
    And no agent or ToolBinding data from the other Org is returned

  @AC-ROOM-12 @security @rbac @edge
  Scenario: A viewer cannot mutate agents
    Given I am signed in as a "VIEWER" of the Org that owns "OmniPizza"
    When I GET "/projects/{id}/agents"
    Then the response status is 200
    When I PATCH "/projects/{id}/agents/web" with enabled "false"
    Then the response status is 403
    When I POST "/projects/{id}/agents/wake-all"
    Then the response status is 403

  @AC-ROOM-13 @edge @audit
  Scenario: Patching an unknown slot returns 404
    When I PATCH "/projects/{id}/agents/wizard" with enabled "false"
    Then the response status is 404
    And no AuditLog entry is recorded for a non-existent agent
