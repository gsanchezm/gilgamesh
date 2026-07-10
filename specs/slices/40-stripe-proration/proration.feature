Feature: Stripe proration + refunds (programmatic)
  As an owner I preview and apply prorated plan changes and, on cancel, opt into a prorated refund of
  the unused period — behind the frozen PaymentProvider port (mock offline, Stripe in auto). The
  proration delta rides to the next invoice; the refund is a prorated credit of the unused portion.

  Background:
    Given the API base path is "/api/v1"
    And I am signed in as "owner@uruk.io"
    And I have a BDD project named "OmniPizza"

  @AC-PRORATE-03
  Scenario: A plan change with no billing account applies no proration (regression-safe)
    When I change the plan to "GROWTH"
    Then the response status is 200
    And the subscription plan is "GROWTH"
    And the proration amount is zero

  @AC-PRORATE-04
  Scenario: Previewing a plan change without a billing account is a zero read-only estimate
    When I preview a change to "GROWTH"
    Then the response status is 200
    And the proration amount is zero

  @AC-PRORATE-01
  Scenario: Upgrading an active subscription previews and applies a positive proration
    When I change the plan to "STARTER"
    And I start checkout
    And I confirm the checkout
    And I preview a change to "GROWTH"
    Then the response status is 200
    And the proration amount is positive
    When I change the plan to "GROWTH"
    Then the response status is 200
    And the subscription plan is "GROWTH"
    And the proration amount is positive
    And an AuditLog entry "subscription.plan_prorated" is recorded

  @AC-PRORATE-02
  Scenario: Downgrading an active subscription applies a negative proration (credit)
    When I change the plan to "GROWTH"
    And I start checkout
    And I confirm the checkout
    And I change the plan to "STARTER"
    Then the response status is 200
    And the subscription plan is "STARTER"
    And the proration amount is negative

  @AC-PRORATE-05
  Scenario: Cancelling with a refund credits the unused period and audits it
    When I change the plan to "GROWTH"
    And I start checkout
    And I confirm the checkout
    And I cancel the subscription with a refund
    Then the response status is 200
    And the subscription status is "CANCELED"
    And the refund amount is positive
    And an AuditLog entry "subscription.refunded" is recorded

  @AC-PRORATE-06
  Scenario: Cancelling without a refund never refunds (default behavior)
    When I change the plan to "GROWTH"
    And I start checkout
    And I confirm the checkout
    And I cancel the subscription
    Then the response status is 200
    And the subscription status is "CANCELED"
    And no refund amount is returned

  @AC-PRORATE-04
  Scenario: A viewer cannot preview a plan change
    Given "viewer@uruk.io" is a viewer in my org
    When I preview a change to "GROWTH"
    Then the response status is 403

  @AC-PRORATE-04
  Scenario: A non-member cannot preview a plan change
    Given I am signed in as "eve@uruk.io"
    When I preview a change to "GROWTH"
    Then the response status is 404
