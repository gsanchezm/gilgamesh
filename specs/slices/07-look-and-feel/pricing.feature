@ui
Feature: Pricing (public marketing page)
  The public pricing page (capture 03-pricing) presenting the four self-serve tiers billed PER ACTIVE
  WORKSPACE / month — Free, Starter, Growth, Scale (owner's 2026-07-01 model). Reachable pre-auth from
  "View plans" on Login/Register. Always dark.

  Background:
    Given I open the pricing page

  Scenario: The pricing page shows the four tiers and monthly prices
    Then I see the "Summon the pantheon that fits your team" hero
    And I see the tiers Free, Starter, Growth and Scale
    And Growth is marked "Most popular"
    And I see the monthly prices $0, $29, $99 and $499

  Scenario: Switching to annual shows the per-month-equivalent billed annually
    When I switch to annual billing
    Then the Starter price becomes $24 billed annually

  Scenario: Starting a plan enters the signup funnel
    When I choose "Get started"
    Then I land on the register screen

  Scenario: Sign in from pricing goes to login
    When I follow "Sign in"
    Then I land on the login screen
