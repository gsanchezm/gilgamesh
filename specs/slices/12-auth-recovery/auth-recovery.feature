# Slice 12 — Auth recovery (forgot / reset password + EmailPort stub)
# Maps 1:1 to spec.md §8 acceptance criteria (AC-AUTH-10/11/12/13 reused from slice 1 + AC-REC-*).
# Names/enums/paths are verbatim from specs/_keystone/foundation-vocabulary.md (v0.4).
# Supersedes the @wip recovery drafts in 01-auth-onboarding-agent-room/auth.feature.

Feature: Password recovery
  As a user who forgot my password
  I want to request a reset link and set a new password
  So that I regain access without revealing whether an email is registered

  Background:
    Given the API base path is "/api/v1"
    And authentication uses an httpOnly session cookie

  @AC-AUTH-10 @forgot-password @security
  Scenario: Request a reset for an existing account
    Given a User exists with email "ishtar@uruk.io"
    When I POST "/auth/forgot-password" for email "ishtar@uruk.io"
    Then the response status is 202
    And the response message is the generic "If an account exists for that email, a reset link is on its way."
    And a PasswordReset row exists for "ishtar@uruk.io" with a future expiry within 30 minutes and no usedAt
    And a reset mail is recorded via the EmailPort for "ishtar@uruk.io"
    And an AuditLog entry "auth.reset.requested" is recorded

  @AC-REC-03 @forgot-password @security
  Scenario: Only the token hash is stored
    Given a User exists with email "ishtar@uruk.io"
    When I POST "/auth/forgot-password" for email "ishtar@uruk.io"
    Then the recorded reset mail carries a raw token whose sha256 hash matches the stored "tokenHash"
    And the raw reset token is not persisted in the PasswordReset row
    And no AuditLog metadata contains the raw reset token

  @AC-AUTH-10 @AC-REC-01 @forgot-password @security @edge
  Scenario: Unknown email leaves no trace
    Given no User exists with email "nobody@nowhere.test"
    When I POST "/auth/forgot-password" for email "nobody@nowhere.test"
    Then the response status is 202
    And the response message is the generic "If an account exists for that email, a reset link is on its way."
    And no PasswordReset row exists
    And no reset mail is recorded

  @AC-AUTH-11 @reset-password @security
  Scenario: Complete a password reset
    Given a User exists with email "ishtar@uruk.io" and password "C0rrect-Horse!"
    And the User "ishtar@uruk.io" has two active Sessions
    And I hold a recorded reset token for "ishtar@uruk.io" noted as "TKN"
    When I POST "/auth/reset-password" with the noted token "TKN" and newPassword "N3w-Passphrase!!"
    Then the response status is 204
    And the stored "passwordHash" for "ishtar@uruk.io" is a new Argon2id hash
    And all Sessions of "ishtar@uruk.io" are revoked
    And the PasswordReset row for "ishtar@uruk.io" has "usedAt" set
    And an AuditLog entry "auth.reset.completed" is recorded
    And a subsequent "GET /auth/me" with the old cookie returns 401
    And signing in as "ishtar@uruk.io" with password "C0rrect-Horse!" returns 401
    And signing in as "ishtar@uruk.io" with password "N3w-Passphrase!!" returns 200

  @AC-REC-02 @reset-password @security @edge
  Scenario: A consumed token cannot be reused
    Given a User exists with email "ishtar@uruk.io" and password "C0rrect-Horse!"
    And I hold a recorded reset token for "ishtar@uruk.io" noted as "TKN"
    And I POST "/auth/reset-password" with the noted token "TKN" and newPassword "N3w-Passphrase!!"
    When I POST "/auth/reset-password" with the noted token "TKN" and newPassword "0ther-Passphrase!"
    Then the response status is 422
    And the response body is a "Problem" document
    And signing in as "ishtar@uruk.io" with password "N3w-Passphrase!!" returns 200

  @AC-AUTH-12 @reset-password @edge
  Scenario: An expired token is rejected
    Given a User exists with email "ishtar@uruk.io" and password "C0rrect-Horse!"
    And an expired PasswordReset row exists for "ishtar@uruk.io" with raw token "expired-raw-token"
    When I POST "/auth/reset-password" with token "expired-raw-token" and newPassword "N3w-Passphrase!!"
    Then the response status is 422
    And the response body is a "Problem" document
    And signing in as "ishtar@uruk.io" with password "C0rrect-Horse!" returns 200

  @AC-AUTH-12 @reset-password @edge
  Scenario: An unrecognized token is rejected
    Given a User exists with email "ishtar@uruk.io" and password "C0rrect-Horse!"
    When I POST "/auth/reset-password" with token "garbage-token" and newPassword "N3w-Passphrase!!"
    Then the response status is 422
    And the response body is a "Problem" document
    And signing in as "ishtar@uruk.io" with password "C0rrect-Horse!" returns 200

  @AC-REC-04 @reset-password @validation @edge
  Scenario: A weak new password is rejected without consuming the token
    Given a User exists with email "ishtar@uruk.io" and password "C0rrect-Horse!"
    And I hold a recorded reset token for "ishtar@uruk.io" noted as "TKN"
    When I POST "/auth/reset-password" with the noted token "TKN" and newPassword "short"
    Then the response status is 422
    And the PasswordReset row for "ishtar@uruk.io" has no "usedAt"
    And signing in as "ishtar@uruk.io" with password "C0rrect-Horse!" returns 200

  @wip @AC-AUTH-13 @security @rate-limit @edge
  Scenario Outline: Recovery endpoints are rate-limited
    When I exceed the request threshold for "<endpoint>" from one client
    Then the response status is 429

    Examples:
      | endpoint              |
      | /auth/forgot-password |
      | /auth/reset-password  |
