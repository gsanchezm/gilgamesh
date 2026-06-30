Feature: Test Lab — feature (BDD) authoring
  As a member I author Gherkin features and the system parses their scenarios.

  Background:
    Given the API base path is "/api/v1"
    And I am signed in as "owner@uruk.io"
    And I have a BDD project named "OmniPizza"

  @AC-FEAT-01 @AC-FEAT-03
  Scenario: Author a feature and parse its scenarios
    When I create a feature "checkout.feature" with content:
      """
      Feature: Checkout
        Scenario: Pay with card
          When I pay
        Scenario: Pay with cash
          When I pay cash
      """
    Then the response status is 201
    And the feature scenarios are "Pay with card, Pay with cash"
    When I read that feature
    Then the response status is 200
    And the feature scenarios are "Pay with card, Pay with cash"

  @AC-FEAT-02
  Scenario: List features
    When I create a feature "a.feature" with content:
      """
      Feature: A
        Scenario: One
          Then ok
      """
    When I GET "/projects/{id}/features"
    Then the response status is 200

  @AC-FEAT-04
  Scenario: Editing the content re-parses the scenarios
    When I create a feature "a.feature" with content:
      """
      Feature: A
        Scenario: One
          Then ok
      """
    When I replace that feature's content with:
      """
      Feature: A
        Scenario: Two
          Then ok
        Scenario: Three
          Then ok
      """
    Then the response status is 200
    And the feature scenarios are "Two, Three"

  @AC-FEAT-05
  Scenario: Invalid gherkin is rejected
    When I create a feature "bad.feature" with content:
      """
      Background:
        Given a precondition
      """
    Then the response status is 422
    And the response body is a "Problem" document

  @AC-FEAT-06
  Scenario: Deleting a feature removes its scenarios
    When I create a feature "a.feature" with content:
      """
      Feature: A
        Scenario: One
          Then ok
      """
    When I delete that feature
    Then the response status is 204
    And that feature has no scenarios in the database

  @AC-FEAT-08
  Scenario: Features of another tenant's project are hidden
    Given another user "eve@uruk.io" has a BDD project named "Foreign"
    When I GET "/projects/Foreign/features"
    Then the response status is 404
