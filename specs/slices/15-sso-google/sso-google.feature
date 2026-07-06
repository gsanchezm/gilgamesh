# Slice 15 — SSO / Google login (AC-AUTH-15)
# Maps 1:1 to README.md §8 acceptance criteria (AC-SSO-01..10).
# Names/enums/paths are verbatim from specs/_keystone/foundation-vocabulary.md (v0.5).
# Offline: the harness pins SSO_MODE=offline, so the deterministic StubIdentityProvider answers —
# same state store, same single-use/TTL semantics, no network. The PKCE challenge itself is a
# real-adapter concern proven by the GoogleIdentityProvider unit tests (README §11).

Feature: Sign in with Google (SSO)
  As a visitor or registered user
  I want to sign in with my Google account
  So that I enter Gilgamesh without inventing a password

  Background:
    Given the API base path is "/api/v1"
    And authentication uses an httpOnly session cookie

  @AC-SSO-01 @sso @security
  Scenario: Start redirects to the IdP with server-held state and nonce
    When I GET "/auth/sso/google/start"
    Then the response status is 302
    And the redirect Location carries "state" and "nonce" parameters
    And no session cookie is set

  @AC-SSO-02 @sso
  Scenario: Callback signs in an existing user
    Given a User exists with email "sso.stub@gilgamesh.test"
    And I started an SSO login and hold its state
    When I GET the SSO callback with the stub code and the held state
    Then the response status is 302
    And the redirect Location is "/"
    And the response sets an httpOnly session cookie
    And no second User is created for "sso.stub@gilgamesh.test"
    And an AuditLog entry "auth.sso.login" is recorded
    And no AuditLog metadata contains the SSO code or state

  @AC-SSO-03 @sso
  Scenario: Callback registers a new user with an unusable password
    Given no User exists with email "sso.stub@gilgamesh.test"
    And I started an SSO login and hold its state
    When I GET the SSO callback with the stub code and the held state
    Then the response status is 302
    And the redirect Location is "/onboarding"
    And the response sets an httpOnly session cookie
    And a User is created with email "sso.stub@gilgamesh.test" and status "ACTIVE"
    And the stored passwordHash for "sso.stub@gilgamesh.test" is an Argon2id hash
    And an AuditLog entry "auth.sso.register" is recorded
    And a subsequent "GET /auth/me" with the old cookie returns 200

  @AC-SSO-04 @sso @security @edge
  Scenario: A forged state is rejected
    When I GET the SSO callback with the stub code and state "forged-state"
    Then the response status is 302
    And the redirect Location is "/login?sso=failed"
    And no session cookie is set
    And no User row exists for email "sso.stub@gilgamesh.test"

  @AC-SSO-04 @sso @security @edge
  Scenario: A state cannot be replayed
    Given a User exists with email "sso.stub@gilgamesh.test"
    And I started an SSO login and hold its state
    And I GET the SSO callback with the stub code and the held state
    When I GET the SSO callback with the stub code and the held state
    Then the response status is 302
    And the redirect Location is "/login?sso=failed"
    And no session cookie is set

  @AC-SSO-05 @sso @security @edge
  Scenario: An unverified email is rejected
    Given I started an SSO login and hold its state
    When I GET the SSO callback with the unverified stub code and the held state
    Then the response status is 302
    And the redirect Location is "/login?sso=failed"
    And no session cookie is set
    And no User row exists for email "sso.unverified@gilgamesh.test"

  @AC-SSO-06 @sso @edge
  Scenario: An unknown provider is a 404 Problem
    When I GET "/auth/sso/okta/start"
    Then the response status is 404
    And the response body is a "Problem" document

  @AC-SSO-09 @sso @security @edge
  Scenario: A disabled account cannot re-enter via SSO
    Given a User exists with email "sso.stub@gilgamesh.test" and status "DISABLED"
    And I started an SSO login and hold its state
    When I GET the SSO callback with the stub code and the held state
    Then the response status is 302
    And the redirect Location is "/login?sso=failed"
    And no session cookie is set

  # The BDD app is booted once with SSO_MODE=offline (the stub answers), so the unconfigured
  # behavior can't be toggled per scenario; proven by the Docker-free e2e (sso.e2e.test.ts).
  @wip @AC-SSO-07 @sso @edge
  Scenario: An unconfigured provider degrades gracefully
    When I GET "/auth/sso/google/start" on a server without Google credentials
    Then the response status is 302
    And the redirect Location is "/login?sso=unavailable"

  # Proven by the dedicated Docker-free rate-limit e2e (the slice-1/12 precedent — the sweep
  # raises AUTH_RATE_LIMIT sky-high, so a 429 can't be observed here).
  @wip @AC-SSO-08 @sso @security @rate-limit @edge
  Scenario Outline: SSO endpoints are rate-limited
    When I exceed the request threshold for "<endpoint>" from one client
    Then the response status is 429

    Examples:
      | endpoint                  |
      | /auth/sso/google/start    |
      | /auth/sso/google/callback |
