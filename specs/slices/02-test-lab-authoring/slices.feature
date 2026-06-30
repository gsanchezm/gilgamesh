Feature: Test Lab — slice authoring
  As a member I organize my project's testing into vertical slices.

  Background:
    Given the API base path is "/api/v1"
    And I am signed in as "owner@uruk.io"
    And I have a BDD project named "OmniPizza"

  @AC-SLICE-01 @AC-SLICE-02
  Scenario: Create and list slices
    When I create a slice with key "regression" named "Regression"
    Then the response status is 201
    When I list the slices
    Then the response status is 200
    And the slice list includes key "regression"

  @AC-SLICE-03
  Scenario: Duplicate slice key conflicts
    When I create a slice with key "smoke" named "Smoke"
    Then the response status is 201
    When I create a slice with key "smoke" named "Duplicate"
    Then the response status is 409
    And the response body is a "Problem" document

  @AC-SLICE-04
  Scenario: Rename a slice
    When I create a slice with key "regression" named "Regression"
    And I rename that slice to "Regression v2"
    Then the response status is 200
    And the response field "name" equals "Regression v2"

  @AC-SLICE-05
  Scenario: Delete a slice
    When I create a slice with key "regression" named "Regression"
    And I delete that slice
    Then the response status is 204
    When I list the slices
    Then the slice list excludes key "regression"

  @AC-SLICE-06
  Scenario: Slices of another tenant's project are hidden
    Given another user "eve@uruk.io" has a BDD project named "Foreign"
    When I GET "/projects/Foreign/slices"
    Then the response status is 404

  @AC-SLICE-07
  Scenario: A viewer cannot author slices
    Given "viewer@uruk.io" is a viewer in my org
    When I create a slice with key "v" named "Viewer slice"
    Then the response status is 403
