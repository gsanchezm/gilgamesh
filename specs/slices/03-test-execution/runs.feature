Feature: Test Lab — test execution (deterministic stub kernel)
  As a member I run authored features/cases behind the TestKernel port and see results in-app.

  Background:
    Given the API base path is "/api/v1"
    And I am signed in as "owner@uruk.io"
    And I have a BDD project named "OmniPizza"

  @AC-RUN-01 @AC-RUN-03 @AC-RUN-04 @AC-RUN-05 @AC-RUN-07
  Scenario: Run a feature and read its aggregated results
    Given a feature "checkout.feature" with scenarios that pass, fail and skip
    When I trigger a run of that feature
    Then the response status is 201
    And the run status is "FAILED"
    And the run totals are 1 passed, 1 failed, 1 skipped
    And an AuditLog entry "run.created" is recorded
    When I read that run
    Then the response status is 200
    And the run has 3 results

  @AC-RUN-02
  Scenario: Run a single test case
    Given a test case "Login works"
    When I trigger a run of that test case
    Then the response status is 201
    And the run status is "DONE"

  @AC-RUN-06 @AC-RUN-08
  Scenario: Re-running keeps history; runs are listed newest-first
    Given a feature "a.feature" with scenarios that pass, fail and skip
    When I trigger a run of that feature
    And I trigger a run of that feature
    And I list the runs
    Then the response status is 200
    And the runs list has 2 runs

  @AC-SUB-07
  Scenario: A run charges run minutes against the quota
    Given a feature "charge.feature" with scenarios that pass, fail and skip
    When I trigger a run of that feature
    Then the response status is 201
    And the org has used at least 3 run minutes

  @AC-SUB-07
  Scenario: A run is blocked when the run-minute quota is exhausted (402)
    Given a feature "blocked.feature" with scenarios that pass, fail and skip
    And the org has exhausted its run minutes
    When I trigger a run of that feature
    Then the response status is 402
    And the response body is a "Problem" document

  @AC-RUN-12
  Scenario: Triggering a run for a missing target is rejected
    When I trigger a run of feature "00000000-0000-0000-0000-000000000000"
    Then the response status is 404
    And the response body is a "Problem" document

  @AC-RUN-10
  Scenario: Runs of another tenant's project are hidden
    Given another user "eve@uruk.io" has a BDD project named "Foreign"
    When I GET "/projects/Foreign/runs"
    Then the response status is 404

  @AC-RUN-11
  Scenario: A viewer cannot trigger a run
    Given a feature "v.feature" with scenarios that pass, fail and skip
    And "viewer@uruk.io" is a viewer in my org
    When I trigger a run of that feature
    Then the response status is 403
