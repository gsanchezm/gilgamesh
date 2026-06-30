Feature: Test Lab — traditional test-case authoring
  As a member I author manual test cases with steps, data, expectations and a priority.

  Background:
    Given the API base path is "/api/v1"
    And I am signed in as "owner@uruk.io"
    And I have a TRADITIONAL project named "OmniPizza"

  @AC-TC-01
  Scenario: Create a test case with an auto key
    When I create a test case "Pay with card" with priority "HIGH"
    Then the response status is 201
    And the test case key matches "^TC_PRJ_\d{3}$"
    And the response field "status" equals "NOTRUN"

  @AC-TC-02
  Scenario: List test cases
    When I create a test case "A" with priority "LOW"
    When I list the test cases
    Then the response status is 200

  @AC-TC-04
  Scenario: A bad priority is rejected
    When I create a test case "X" with priority "URGENT"
    Then the response status is 422
    And the response body is a "Problem" document

  @AC-TC-05
  Scenario: Assign a roster agent and reject an unknown one
    When I create a test case "Assigned" with priority "MEDIUM" assigned to a roster agent
    Then the response status is 201
    When I create a test case "Bad" with priority "LOW" assigned to "00000000-0000-0000-0000-000000000000"
    Then the response status is 422

  @AC-TC-06
  Scenario: Test cases of another tenant's project are hidden
    Given another user "eve@uruk.io" has a TRADITIONAL project named "Foreign"
    When I GET "/projects/Foreign/test-cases"
    Then the response status is 404

  @AC-TC-07
  Scenario: A viewer cannot author test cases
    Given "viewer@uruk.io" is a viewer in my org
    When I create a test case "Viewer case" with priority "LOW"
    Then the response status is 403
