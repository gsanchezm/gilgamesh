Feature: Subscription & billing (mock provider)
  As an owner I manage my org's plan, seats and billing behind a mock payment provider.

  Background:
    Given the API base path is "/api/v1"
    And I am signed in as "owner@uruk.io"
    And I have a BDD project named "OmniPizza"

  @AC-SUB-01
  Scenario: View the seeded subscription
    When I GET the subscription
    Then the response status is 200
    And the subscription plan is "TEAM"
    And the subscription status is "TRIALING"
    And the subscription quota is 1000

  @AC-SUB-02
  Scenario: Changing the plan remaps the run-minute quota
    When I change the plan to "PRO"
    Then the response status is 200
    And the subscription plan is "PRO"
    And the subscription quota is 10000
    And an AuditLog entry "subscription.plan_changed" is recorded

  @AC-SUB-02
  Scenario: A viewer cannot change the plan
    Given "viewer@uruk.io" is a viewer in my org
    When I change the plan to "PRO"
    Then the response status is 403

  @AC-SUB-04
  Scenario: Seats over the plan limit are rejected
    When I update seats to 6
    Then the response status is 422
    And the response body is a "Problem" document

  @AC-SUB-05 @AC-SUB-11
  Scenario: Mock checkout returns a url and activates on confirm
    When I start checkout
    Then the response status is 200
    And a mock checkout url is returned
    When I confirm the checkout
    Then the response status is 200
    And the subscription status is "ACTIVE"

  @AC-SUB-06
  Scenario: Cancel the subscription
    When I cancel the subscription
    Then the response status is 200
    And the subscription status is "CANCELED"

  @AC-SUB-09
  Scenario: A non-member cannot see the org subscription
    Given I am signed in as "eve@uruk.io"
    When I GET the subscription
    Then the response status is 404
