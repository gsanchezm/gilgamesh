# Slice 1 — Auth (local email/password + sessions)
# Maps 1:1 to spec.md §8 "Auth" acceptance criteria (AC-AUTH-*).
# Names/enums/paths are verbatim from specs/_keystone/foundation-vocabulary.md.
# Out of scope here: SSO/SAML/Google (disabled), per-agent chat, voice.

Feature: Local authentication
  As a visitor and registered user
  I want to create an account, sign in and out, and recover my password
  So that I can securely reach my Gilgamesh workspace

  Background:
    Given the API base path is "/api/v1"
    And authentication uses an httpOnly session cookie

  @AC-AUTH-01 @register
  Scenario: Register a new account
    Given no User exists with email "ishtar@uruk.io"
    When I POST "/auth/register" with a "UserCreate" body:
      | firstName | lastName | email           | password        |
      | Ishtar    | Uruk     | ishtar@uruk.io  | C0rrect-Horse!  |
    Then the response status is 201
    And a User is created with email "ishtar@uruk.io" and status "ACTIVE"
    And the stored "passwordHash" is an Argon2id hash and not the plaintext password
    And the response sets a session cookie
    And an AuditLog entry "auth.register" is recorded for that User
    And because the User has no Membership the client routes to onboarding

  @AC-AUTH-02 @register @edge
  Scenario: Register with a duplicate email
    Given a User already exists with email "ishtar@uruk.io"
    When I POST "/auth/register" with a "UserCreate" body for email "ishtar@uruk.io"
    Then the response status is 409
    And the response body is a "Problem" document
    And no second User is created for "ishtar@uruk.io"
    And the attempt is audited

  @AC-AUTH-03 @register @edge @validation
  Scenario Outline: Register with invalid input
    When I POST "/auth/register" with a "UserCreate" body that has <defect>
    Then the response status is 422
    And the response body is a "Problem" document
    And no User is created

    Examples:
      | defect                       |
      | a malformed email            |
      | a missing firstName          |
      | a missing lastName           |
      | a password below the policy  |

  @AC-AUTH-04 @login
  Scenario: Sign in with valid credentials
    Given a User exists with email "ishtar@uruk.io" and password "C0rrect-Horse!"
    And I hold a pre-login session token "PRE"
    When I POST "/auth/login" with a "LoginRequest" body:
      | email          | password       | remember |
      | ishtar@uruk.io | C0rrect-Horse! | false    |
    Then the response status is 200
    And a new Session is created whose token differs from "PRE"
    And the response sets an httpOnly session cookie
    And an AuditLog entry "auth.login.succeeded" is recorded
    And the client routes by membership: onboarding when none, otherwise the agent room

  @AC-AUTH-05 @login @edge @security
  Scenario Outline: Sign in with invalid credentials
    When I POST "/auth/login" with <case>
    Then the response status is 401
    And the response message is the generic "Invalid email or password."
    And an AuditLog entry "auth.login.failed" is recorded without the attempted password
    And no session cookie is set

    Examples:
      | case                                              |
      | a known email and a wrong password               |
      | an unknown email and any password                |

  @AC-AUTH-06 @login @edge @security
  Scenario: Sign in as a disabled user
    Given a User exists with email "banned@uruk.io" and status "DISABLED"
    When I POST "/auth/login" with the correct password for "banned@uruk.io"
    Then the response status is 403
    And no Session is created

  @AC-AUTH-07 @login @session
  Scenario: Remember me extends the session lifetime
    Given a User exists with email "ishtar@uruk.io"
    When I sign in with rememberMe "false" and note the Session "expiresAt" as "SHORT"
    And I sign in again with rememberMe "true" and note the Session "expiresAt" as "LONG"
    Then "LONG" is later than "SHORT"

  @wip @AC-AUTH-08 @logout @session @security
  Scenario: Sign out revokes the session
    Given I am signed in with an active Session
    When I POST "/auth/logout"
    Then the response status is 204
    And that Session has "revokedAt" set
    And the session cookie is cleared
    And an AuditLog entry "auth.logout" is recorded
    And a subsequent "GET /auth/me" with the old cookie returns 401

  @wip @AC-AUTH-09 @me @session
  Scenario: Who am I
    Given I am signed in as "ishtar@uruk.io"
    When I GET "/auth/me"
    Then the response status is 200
    And the response body is a "MeView" with the embedded memberships array and "activeOrgId"
    When I GET "/auth/me" without a session cookie
    Then the response status is 401

  @wip @AC-AUTH-10 @forgot-password @security @edge
  Scenario Outline: Request a password reset without leaking which emails exist
    When I POST "/auth/forgot-password" with a "ForgotPasswordRequest" for email <email>
    Then the response status is 202
    And the response is the generic "If an account exists for that email, a reset link is on its way."

    Examples:
      | email                |
      | ishtar@uruk.io       |
      | nobody@nowhere.test  |

  @wip @AC-AUTH-10 @forgot-password @security
  Scenario: Reset token is created only for a real account
    Given a User exists with email "ishtar@uruk.io"
    When I POST "/auth/forgot-password" for "ishtar@uruk.io"
    Then a single-use reset token is generated with a future expiry
    And only the hash of the reset token is stored
    And the reset link is dispatched via the EmailPort
    And an AuditLog entry "auth.password.reset_requested" is recorded

  @wip @AC-AUTH-11 @reset-password @security
  Scenario: Complete a password reset
    Given a valid unexpired unconsumed reset token "TKN" for "ishtar@uruk.io"
    And the User has two active Sessions
    When I POST "/auth/reset-password" with a "ResetPasswordRequest":
      | token | newPassword       |
      | TKN   | N3w-Passphrase!!  |
    Then the response status is 204
    And the stored "passwordHash" is a new Argon2id hash
    And all of the User's Sessions are revoked
    And the token "TKN" is consumed and cannot be reused
    And an AuditLog entry "auth.password.reset" is recorded

  @wip @AC-AUTH-12 @reset-password @edge
  Scenario Outline: Reset with an invalid token
    When I POST "/auth/reset-password" with a token that is <state>
    Then the response status is 400
    And the User's "passwordHash" is unchanged

    Examples:
      | state            |
      | expired          |
      | already consumed |
      | unrecognized     |

  @wip @AC-AUTH-13 @security @rate-limit @edge
  Scenario Outline: Auth endpoints are rate-limited
    When I exceed the request threshold for "<endpoint>" from one client
    Then the response status is 429

    Examples:
      | endpoint              |
      | /auth/login           |
      | /auth/register        |
      | /auth/forgot-password |

  @wip @AC-AUTH-14 @security @session
  Scenario: Session cookie is hardened
    Given I have just signed in
    Then the session cookie is "httpOnly"
    And the session cookie is "Secure"
    And the session cookie has a "SameSite" attribute
    And the session cookie name carries the "__Host-" prefix
    And only the token hash is persisted in the Session row
    And state-changing requests require a valid CSRF token

  @AC-AUTH-15 @login @out-of-scope
  Scenario: Third-party sign-in is visible but disabled
    When I open the login screen
    Then the "Continue with Google" control is rendered disabled
    And the "SSO / SAML" control is rendered disabled
    And neither control exposes a functional sign-in path in this slice
