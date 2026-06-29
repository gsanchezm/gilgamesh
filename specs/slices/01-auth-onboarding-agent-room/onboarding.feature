# Slice 1 — Onboarding (3 steps -> tenant bootstrap)
# Maps 1:1 to spec.md §8 "Onboarding" acceptance criteria (AC-ONB-*).
# Names/enums/paths are verbatim from specs/_keystone/foundation-vocabulary.md.
# Visible steps match the prototype (project name -> format -> repo); the Org is created
# implicitly on Finish (Org.name derived, slug auto-generated). Repo = metadata only in slice 1.

Feature: Onboarding and tenant bootstrap
  As a newly-registered user with no workspace
  I want a 3-step wizard that creates my organization and first project
  So that I land in a ready-to-use workspace with my 11 agents

  Background:
    Given I am signed in as "ishtar@uruk.io"
    And I have no Membership yet

  @AC-ONB-01 @step1 @validation @edge
  Scenario: Empty project name is rejected
    Given I am on step 1 of onboarding
    When I leave the project name empty or whitespace
    Then the "Next" action is disabled
    And forcing a "POST /projects" with an empty name returns 422 with a "Problem" body

  @AC-ONB-02 @step2
  Scenario Outline: Choose the project format
    Given I have entered a project name on step 1
    When I select the "<choice>" format on step 2
    Then the project will be created with format "<format>"

    Examples:
      | choice            | format      |
      | BDD / Gherkin     | BDD         |
      | Traditional cases | TRADITIONAL |

  @AC-ONB-03 @step3 @edge
  Scenario: Skip the optional repo connection
    Given I have entered a project name and chosen a format
    When I skip the repo connection on step 3 and finish onboarding
    Then the created Project has "repoProvider", "repoFullName" and "repoBranch" all null

  @AC-ONB-03 @step3
  Scenario Outline: Attach a repo as metadata
    Given I have entered a project name and chosen a format
    When I connect "<providerLabel>" with repo "<fullName>" on branch "<branch>" and finish
    Then the created Project has repoProvider "<repoProvider>", repoFullName "<fullName>", repoBranch "<branch>"
    And no repository OAuth token is stored and no sync is performed in this slice

    Examples:
      | providerLabel | repoProvider | fullName                  | branch  |
      | GitHub        | github       | gsanchezm/omnipizza-web   | main    |
      | Bitbucket     | bitbucket    | voyager/mobile            | develop |
      | Azure DevOps  | ado          | fintrust/checkout-app     | develop |

  @AC-ONB-04 @bootstrap
  Scenario: Finishing onboarding bootstraps the tenant
    Given I have completed steps 1 to 3 with project name "OmniPizza" and format "BDD"
    When I finish onboarding
    Then a "POST /orgs" creates one Org
    And a Membership is created linking me to that Org with role "OWNER"
    And exactly 11 Agent rows are seeded into the Org catalog
    And exactly one Subscription is created for the Org
    And a "POST /projects" creates the Project "OmniPizza" with format "BDD"

  @AC-ONB-05 @bootstrap @roster
  Scenario: Seeded agents match the canonical roster
    Given I finish onboarding so the Org agent catalog is seeded
    When I GET "/orgs/{orgId}/agents"
    Then the 11 Agent rows equal the keystone roster:
      | slot    | deityName     | family    | glyph | culture      | defaultTool   |
      | lead    | Zeus          | proceso   | ZE    | Grecia       | Helix Core    |
      | arch    | Athena        | proceso   | AT    | Grecia       | Strategy      |
      | manual  | Anubis        | proceso   | AN    | Egipto       | Suites · Steps|
      | web     | Quetzalcóatl  | ui        | QC    | Azteca       | Playwright    |
      | api     | Iris          | backend   | IR    | Grecia       | Postman       |
      | android | Freya         | ui        | FR    | Escandinavia | Appium        |
      | ios     | Isis          | ui        | IS    | Egipto       | Appium        |
      | perf    | Thor          | backend   | TH    | Escandinavia | k6            |
      | visual  | Xochiquetzal  | ui        | XO    | Azteca       | Pixelmatch    |
      | sec     | Odin          | guardian  | OD    | Escandinavia | OWASP ZAP     |
      | a11y    | Ra            | guardian  | RA    | Egipto       | axe-core      |
    And each Agent is unique by (orgId, slot)

  @AC-ONB-06 @bootstrap @subscription
  Scenario: Seeded subscription is a TEAM trial
    Given I finish onboarding
    When I GET "/orgs/{orgId}/subscription"
    Then the "SubscriptionView" has plan "TEAM" and status "TRIALING"
    And it has billingCycle "MONTHLY", seats 5, runMinutesQuota 1000 and runMinutesUsed 0

  @AC-ONB-07 @bootstrap @toolbinding
  Scenario: Project creation seeds the tool bindings
    Given I finish onboarding creating the project "OmniPizza"
    When I GET "/projects/{id}/agents"
    Then exactly 11 ToolBinding rows exist, one per Agent, unique by (projectId, agentId)
    And each ToolBinding has "enabled" true and "tool" equal to its Agent "defaultTool"

  @AC-ONB-08 @slug @edge
  Scenario: Org slug collision is auto-suffixed
    Given an Org already exists whose slug would collide with my derived slug
    When I finish onboarding
    Then my Org is created with a unique auto-suffixed slug
    And the request does not error

  @AC-ONB-09 @slug @edge
  Scenario: Project slug collision within the same org is auto-suffixed
    Given I already have a Membership in an Org
    And that Org already has a Project named "OmniPizza"
    When I onboard a second Project also named "OmniPizza"
    Then the new Project is created with a unique auto-suffixed slug
    And Unique(orgId, slug) still holds
    And the request does not error

  @AC-ONB-10 @bootstrap @edge
  Scenario: A second onboarding reuses the existing org
    Given I already have a Membership in Org "ORG1" with role "OWNER"
    When I onboard a new Project "Voyager"
    Then no new Org is created and "ORG1" is reused
    And no additional Agent rows are seeded
    And no additional Subscription is created
    And only a new Project "Voyager" with its 11 ToolBinding rows is created

  @AC-ONB-11 @security @edge
  Scenario: Onboarding requires authentication
    When an unauthenticated client POSTs "/projects"
    Then the response status is 401

  @AC-ONB-11 @security @rbac @edge
  Scenario: Creating a project requires an elevated role
    Given I am signed in as a "VIEWER" of an existing Org
    When I POST "/projects" in that Org
    Then the response status is 403

  @AC-ONB-12 @bootstrap @reliability @edge
  Scenario: Bootstrap is all-or-nothing
    Given finishing onboarding will fail partway through seeding
    When I finish onboarding
    Then the whole transaction rolls back
    And no Org, Membership, Agent, Subscription or Project is left persisted

  @AC-ONB-13 @bootstrap @audit
  Scenario: Finishing redirects to the agent room and audits the creation
    Given I finish onboarding creating the project "OmniPizza"
    Then I am redirected to the agent room of the new project
    And an AuditLog entry "org.created" is recorded
    And an AuditLog entry "project.created" is recorded
