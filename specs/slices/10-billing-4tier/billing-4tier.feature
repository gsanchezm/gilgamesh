Feature: Billing — 4-tier workspace pricing (PLAN_CATALOG migration)
  As an owner I manage the four self-serve tiers (Free / Starter / Growth / Scale) billed per
  active workspace/month, with the computed price and limits derived from the canonical catalog.

  Background:
    Given the API base path is "/api/v1"
    And I am signed in as "owner@uruk.io"
    And I have a BDD project named "OmniPizza"

  @AC-B4T-01
  Scenario: Changing the plan remaps the execution quota and per-workspace limits per the catalog
    When I change the plan to "STARTER"
    Then the response status is 200
    And the subscription plan is "STARTER"
    And the subscription quota is 5000
    And the subscription allows 5 services per workspace
    And the subscription price is 2900 cents
    When I change the plan to "GROWTH"
    Then the response status is 200
    And the subscription quota is 25000
    And the subscription allows 15 services per workspace
    And the subscription price is 9900 cents

  @AC-B4T-02
  Scenario: The Free workspace cap is enforced and a downgrade below current workspaces is rejected
    When I update seats to 2
    Then the response status is 422
    And the response body is a "Problem" document
    When I change the plan to "STARTER"
    Then the response status is 200
    When I update seats to 4
    Then the response status is 200
    And the subscription has 4 active workspaces
    When I change the plan to "FREE"
    Then the response status is 422
    And the response body is a "Problem" document

  @AC-B4T-03
  Scenario: Scale prices $499 base including 10 workspaces plus $99 per extra workspace
    When I change the plan to "SCALE"
    Then the response status is 200
    And the subscription executions are unlimited
    And the subscription price is 49900 cents
    When I update seats to 10
    Then the response status is 200
    And the subscription price is 49900 cents
    When I update seats to 12
    Then the response status is 200
    And the subscription price is 69700 cents

  @AC-B4T-04
  Scenario: Annual billing charges 10 months (2 months free) in the computed price
    When I change the plan to "GROWTH" on the "ANNUAL" cycle
    Then the response status is 200
    And the subscription price is 8250 cents
    When I change the plan to "STARTER" on the "ANNUAL" cycle
    Then the response status is 200
    And the subscription price is 2417 cents

  @AC-B4T-05
  Scenario: The execution quota still blocks runs on a metered plan (regression)
    Given a feature "blocked.feature" with scenarios that pass, fail and skip
    And the org has exhausted its run minutes
    When I trigger a run of that feature
    Then the response status is 402
    And the response body is a "Problem" document

  @AC-B4T-05
  Scenario: Scale executions are unlimited — runs are never quota-blocked
    Given a feature "scale.feature" with scenarios that pass, fail and skip
    When I change the plan to "SCALE"
    And the org has exhausted its run minutes
    And I trigger a run of that feature
    Then the response status is 201

  @AC-B4T-06
  Scenario: RBAC and tenant isolation are unchanged by the migration
    Given "member@uruk.io" is a member in my org
    When I change the plan to "STARTER"
    Then the response status is 403
    Given I am signed in as "eve@uruk.io"
    When I GET the subscription
    Then the response status is 404
