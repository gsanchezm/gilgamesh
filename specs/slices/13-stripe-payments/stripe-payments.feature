Feature: Stripe payments — invoices and provider webhooks
  As an owner I see my organization's invoices in-app, fed by the payment provider's webhooks
  (Stripe) or deterministically by the mock provider, behind the frozen PaymentProvider port.

  Background:
    Given the API base path is "/api/v1"
    And I am signed in as "owner@uruk.io"
    And I have a BDD project named "OmniPizza"

  @AC-PAY-01
  Scenario: A fresh org has no invoices and members can list them
    When I GET the invoices
    Then the response status is 200
    And the invoice list has 0 entries

  @AC-PAY-01
  Scenario: Listing invoices requires authentication
    When an unauthenticated client GETs the invoices
    Then the response status is 401

  @AC-PAY-02
  Scenario: Confirming the mock checkout records a deterministic PAID invoice at the computed price
    When I change the plan to "GROWTH"
    And I start checkout
    And I confirm the checkout
    Then the response status is 200
    When I GET the invoices
    Then the invoice list has 1 entries
    And invoice 1 has status "PAID"
    And invoice 1 has amount 9900 cents
    And invoice 1 has a hosted invoice url
    When I confirm the checkout
    And I GET the invoices
    Then the invoice list has 1 entries

  @AC-PAY-03
  Scenario: A signed webhook upserts the invoice through its lifecycle in one row
    When the provider delivers a signed "invoice.finalized" webhook for invoice "in_bdd_1" of 4900 cents
    Then the response status is 200
    When the provider delivers a signed "invoice.paid" webhook for invoice "in_bdd_1" of 4900 cents
    Then the response status is 200
    When I GET the invoices
    Then the invoice list has 1 entries
    And invoice 1 has status "PAID"
    And invoice 1 has amount 4900 cents

  @AC-PAY-04
  Scenario: invoice.paid activates the subscription and invoice.payment_failed marks it past due
    When the provider delivers a signed "invoice.paid" webhook for invoice "in_bdd_2" of 2900 cents
    And I GET the subscription
    Then the subscription status is "ACTIVE"
    When the provider delivers a signed "invoice.payment_failed" webhook for invoice "in_bdd_2" of 2900 cents
    And I GET the subscription
    Then the subscription status is "PAST_DUE"

  @AC-PAY-05
  Scenario: The webhook needs no session but rejects an invalid signature and persists nothing
    When the provider delivers an unsigned "invoice.paid" webhook for invoice "in_bdd_3" of 999 cents
    Then the response status is 403
    And the response body is a "Problem" document
    When I GET the invoices
    Then the invoice list has 0 entries

  @AC-PAY-06
  Scenario: Webhooks for an unknown provider are rejected
    When the provider delivers a signed "invoice.paid" webhook to provider "paypal" for invoice "in_bdd_4" of 999 cents
    Then the response status is 404
    And the response body is a "Problem" document

  @AC-PAY-06
  Scenario: Another tenant cannot list my invoices
    Given I am signed in as "eve@uruk.io"
    When I GET the invoices
    Then the response status is 404
    And the response body is a "Problem" document
