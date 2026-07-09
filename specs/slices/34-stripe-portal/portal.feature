Feature: Stripe billing portal (portal-only)
  As an owner I open Stripe's hosted billing portal to self-serve plan change / payment method /
  cancel, behind the frozen PaymentProvider port (mock offline, Stripe in auto). Portal-only:
  no programmatic refund/proration APIs.

  Background:
    Given the API base path is "/api/v1"
    And I am signed in as "owner@uruk.io"
    And I have a BDD project named "OmniPizza"

  @AC-PORTAL-01
  Scenario: An owner with a billing account opens the portal
    When I start checkout
    And I confirm the checkout
    And I open the billing portal
    Then the response status is 200
    And a mock portal url is returned
    And an AuditLog entry "subscription.portal_opened" is recorded

  @AC-PORTAL-04
  Scenario: An owner with no billing account cannot open the portal
    When I open the billing portal
    Then the response status is 422
    And the response body is a "Problem" document

  @AC-PORTAL-02
  Scenario: A viewer cannot open the billing portal
    Given "viewer@uruk.io" is a viewer in my org
    When I open the billing portal
    Then the response status is 403
    And the response body is a "Problem" document

  @AC-PORTAL-03
  Scenario: A non-member cannot open the org billing portal
    Given I am signed in as "eve@uruk.io"
    When I open the billing portal
    Then the response status is 404
    And the response body is a "Problem" document

  @AC-PORTAL-05
  Scenario: Opening the portal requires authentication
    When an unauthenticated client opens the billing portal
    Then the response status is 401

  @AC-PORTAL-05
  Scenario: Opening the portal requires the CSRF double-submit
    When I open the billing portal without the CSRF token
    Then the response status is 403
