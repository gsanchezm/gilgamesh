@ui
Feature: Create account (registration screen)
  The web signup screen (capture 02-registro) — twin of Login: the shared animated hero on the
  left, the "Create account" form on the right. Registration hits the real POST /auth/register,
  which creates a User and auto-signs-in; the Org is bootstrapped later at onboarding.

  Background:
    Given I open the register screen

  Scenario: The register screen mirrors the login hero and copy
    Then I see the "Create account" heading
    And I see the subtitle "Start your workspace with your corporate email."
    And I see the shared GILGAMESH brand hero

  Scenario: Client-side validation blocks a password shorter than 12 characters
    When I fill the form but use a 5-character password
    And I submit the form
    Then I see a validation error mentioning 12 characters
    And I stay on the register screen

  Scenario: Registering a new account signs me in and continues into onboarding
    When I fill the form with a unique corporate email and a valid password
    And I submit the form
    Then a session cookie is set
    And I land on the onboarding wizard

  Scenario: I can return to the sign-in screen
    When I follow the "Sign in" link
    Then I am back on the login screen
