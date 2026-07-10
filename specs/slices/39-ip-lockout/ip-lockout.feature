# Slice 39 — Per-IP backoff / lockout (security)
#
# Two additive protections on the auth surface, BOTH keyed on client IP (never on the account
# alone, so an attacker can never lock a victim out — they only ever lock their own IP):
#   A1 · per-IP request ceiling across auth mutation routes (org-farming / spray defense)
#   A2 · exponential-backoff lockout after N consecutive failed credential attempts (stuffing)
#
# @wip like AC-AUTH-13: the BDD sweep raises the limiter sky-high so scenarios never trip it, so
# the EXECUTABLE proof lives in apps/api/test/ip-lockout.e2e.test.ts (+ the unit/store tests).
# This feature documents intent and the acceptance criteria (AC-IPLOCK-01..07).

@wip @security @rate-limit @ip-lockout
Feature: Per-IP backoff and lockout on the auth surface
  As the platform
  I want repeated failed credential attempts and per-IP spray to be throttled
  So that credential-stuffing and org-farming are defended without letting an attacker lock a victim

  @AC-IPLOCK-01
  Scenario: A run of failed logins from one IP locks that IP
    Given the lockout threshold is N failures
    When I submit N failed logins from one IP
    Then the next login attempt from that IP returns 429 with a Retry-After header
    And it is rejected even when the credentials are correct

  @AC-IPLOCK-02
  Scenario: A successful login clears the failure counter
    Given I have submitted fewer than N failed logins from one IP
    When I then log in successfully
    Then my failure counter is cleared
    And subsequent failed logins start counting again from zero

  @AC-IPLOCK-03
  Scenario: The lock window grows exponentially across repeated lock cycles
    Given an IP is locked and the lock expires
    When it fails again past the threshold
    Then each successive lock window is longer, capped at the configured maximum

  @AC-IPLOCK-04
  Scenario: A second IP is unaffected while the first is locked
    Given one IP is locked out
    When a different IP submits a login
    Then that login is not throttled by the first IP's lock

  @AC-IPLOCK-05
  Scenario: Per-IP ceiling catches spray across many accounts
    Given one IP exceeds the per-IP request ceiling across different accounts
    Then further auth requests from that IP return 429
    And the per-account window alone would not have tripped

  @AC-IPLOCK-06
  Scenario: The lockout store failing open never takes down auth
    Given the lockout/ceiling store is unreachable
    When a login is attempted
    Then the request is allowed (fail-open), not 500

  @AC-IPLOCK-07
  Scenario: Reset-password failures feed the same per-IP lockout
    Given I submit N failed reset-password attempts (invalid tokens) from one IP
    Then the next auth attempt from that IP is locked
    And a valid reset clears the counter
