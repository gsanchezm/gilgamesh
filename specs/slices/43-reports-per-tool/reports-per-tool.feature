@ui
Feature: Reports per-tool "Tools" breakdown
  As an owner viewing the Reports screen I see a per-tool "Tools" card that groups every run's
  per-scenario results by the executing tool (keystone v0.7 tool/discipline, stub-emitted by the
  DeterministicKernel until the real TOM kernel lands) into pass/fail/skip counts and a 1-decimal
  pass-rate, faithful to capture 08.

  This feature is verified Docker-free by the pure `summarizeByTool` domain fold + the ReportsScreen
  web component tests (the breakdown is a domain-fold + UI-render concern), so it is tagged @ui and
  excluded from the API BDD sweep — the same posture as every other UI-only behavior.

  Background:
    Given I am signed in as "owner@uruk.io"
    And I have a project named "OmniPizza"

  @AC-REPORT-TOOL-01
  Scenario: Per-scenario results group by tool with counts and a 1-decimal pass-rate
    Given a feature "checkout.feature" with scenarios that pass, fail and skip
    And I have triggered a run of that feature
    When I open the Reports screen
    Then the "Tools" card groups the results by executing tool
    And each tool row shows its passed, failed and skipped counts
    And each tool row shows a 1-decimal pass-rate

  @AC-REPORT-TOOL-02
  Scenario: A run whose scenarios exercise different tools splits across the buckets
    Given a feature whose scenarios exercise "playwright", "k6" and "zap"
    And I have triggered a run of that feature
    When I open the Reports screen
    Then the "Tools" card has one row per distinct tool
    And the rows are ordered most-executed first with the tool name as the tiebreak
    And a result with no tool falls into the "unknown" bucket

  @AC-REPORT-TOOL-03
  Scenario: A project with no runs shows a period-less empty state instead of a Tools card
    Given the project has no runs
    When I open the Reports screen
    Then a period-less empty state is shown
    And no "Tools" card is rendered

  @AC-REPORT-TOOL-04
  Scenario: A non-member reading the project's runs is not found (tenant isolation)
    Given a user who is not a member of the project's org
    When that user reads a run of the project
    Then the response status is 404
