Feature: Test Lab — shared knowledge base (RAG)
  As a member I search a shared QA knowledge base and have my generation grounded in it,
  so authored tests follow established methodology (ISTQB + BDD).

  Background:
    Given the API base path is "/api/v1"
    And I am signed in as "owner@uruk.io"
    And the knowledge base has QA reference material

  @AC-KB-08
  Scenario: Searching the shared knowledge base requires authentication
    When I GET "/knowledge/search?q=example" without a session cookie
    Then the response status is 401

  @AC-KB-04 @AC-KB-09
  Scenario: Search returns lexically-relevant results with source citations
    When I search the knowledge base for "example mapping discovery cards"
    Then the response status is 200
    And the search returns at least 1 result
    And the top result cites "bddbooks-discovery"

  @AC-KB-05 @AC-KB-06
  Scenario: A different query ranks a different source first
    When I search the knowledge base for "boundary value analysis edges partitions"
    Then the response status is 200
    And the top result cites "CTFL"

  @AC-KB-07
  Scenario: Generation is grounded in the knowledge base and carries citations
    Given I have a BDD project named "OmniPizza"
    When I generate drafts from "boundary value analysis for the checkout total"
    Then the response status is 200
    And the generated drafts carry at least 1 citation
