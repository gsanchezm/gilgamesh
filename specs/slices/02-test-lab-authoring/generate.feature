Feature: Test Lab — AI generate (stub brain)
  As a member I generate draft features/cases from a prompt for review.

  Background:
    Given the API base path is "/api/v1"
    And I am signed in as "owner@uruk.io"
    And I have a BDD project named "OmniPizza"

  @AC-GEN-01 @AC-GEN-02
  Scenario: Generate drafts without persisting anything
    When I generate drafts from "a checkout flow with card and cash"
    Then the response status is 200
    And the response has at least one draft
    And the project has 0 features in the database

  @AC-GEN-03
  Scenario: A viewer cannot generate
    Given "viewer@uruk.io" is a viewer in my org
    When I generate drafts from "anything"
    Then the response status is 403

  # AC-GEN-04 (generate is rate-limited): the path is in RateLimitGuard.LIMITED_PATHS and uses the
  # same guard proven by the auth rate-limit e2e; the BDD sweep disables the limit (AUTH_RATE_LIMIT
  # is raised), so the 429 path is verified outside this sweep, like AC-AUTH-13.
  @wip
  Scenario: Generate is rate-limited
    When I exceed the generate threshold
    Then the response status is 429
