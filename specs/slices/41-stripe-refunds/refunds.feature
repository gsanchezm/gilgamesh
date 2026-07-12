Feature: Stripe refunds — partial (amount-level) + always_invoice + refund preview
  As an owner I refund an arbitrary amount of a paid invoice (goodwill / dispute / partial credit),
  preview the exact amount before I commit, and optionally invoice a plan-change proration immediately
  (always_invoice) — behind the frozen PaymentProvider port (mock offline, Stripe in auto). A partial
  refund is recorded as a negative-amount VOID credit invoice for exactly the requested amount.

  Background:
    Given the API base path is "/api/v1"
    And I am signed in as "owner@uruk.io"
    And I have a BDD project named "OmniPizza"

  @AC-REFUND-01
  Scenario: A partial refund of a paid invoice credits exactly the requested amount
    When I change the plan to "GROWTH"
    And I start checkout
    And I confirm the checkout
    And I refund 5000 cents of the subscription
    Then the response status is 200
    And the refund amount is 5000 cents
    And an AuditLog entry "subscription.refunded" is recorded

  @AC-REFUND-02
  Scenario: The refund preview equals the amount the refund then charges
    When I change the plan to "GROWTH"
    And I start checkout
    And I confirm the checkout
    And I preview a refund of 4200 cents
    Then the response status is 200
    And the preview refundable amount is 9900 cents
    And the preview refund amount is 4200 cents
    When I refund 4200 cents of the subscription
    Then the response status is 200
    And the refund amount is 4200 cents

  @AC-REFUND-03
  Scenario: A refund beyond the refundable ceiling is rejected
    When I change the plan to "GROWTH"
    And I start checkout
    And I confirm the checkout
    And I refund 20000 cents of the subscription
    Then the response status is 422

  @AC-REFUND-04
  Scenario: A plan change with always_invoice is accepted and prorated
    When I change the plan to "GROWTH"
    And I start checkout
    And I confirm the checkout
    And I change the plan to "SCALE" invoicing the proration immediately
    Then the response status is 200
    And the subscription plan is "SCALE"

  @AC-REFUND-05
  Scenario: A refund on an org with no billing account is rejected
    When I refund 5000 cents of the subscription
    Then the response status is 422

  @AC-REFUND-05
  Scenario: A viewer cannot refund
    Given "viewer@uruk.io" is a viewer in my org
    When I refund 5000 cents of the subscription
    Then the response status is 403

  @AC-REFUND-05
  Scenario: A non-member cannot refund
    Given I am signed in as "eve@uruk.io"
    When I refund 5000 cents of the subscription
    Then the response status is 404

  @AC-REFUND-05
  Scenario: A non-member cannot preview a refund
    Given I am signed in as "eve@uruk.io"
    When I preview a refund of 5000 cents
    Then the response status is 404
