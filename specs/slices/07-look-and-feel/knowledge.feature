@ui
Feature: Knowledge base (upload + indexed documents + shared search)
  The re-skinned Knowledge base (capture 09): upload per-org documents to ground the agents (private
  RAG), see them listed under "Indexed documents", and still search the GLOBAL shared corpus. Uploaded
  per-org chunks are tenant-scoped and never surface in the shared search (no cross-org leak).

  Background:
    Given I am a signed-in, onboarded user on the Knowledge base

  Scenario: The empty state invites an upload
    Then I see the "Knowledge base" heading
    And I see "No documents uploaded yet."

  Scenario: Ingesting the demo sample indexes a per-org document
    When I click "+ demo"
    Then a document "demo-istqb.md" appears under Indexed documents with a chunk count

  Scenario: The shared search still returns cited results
    When I search the knowledge base for "boundary value analysis partitions"
    Then I see ranked results, each with a source citation
    And the search never surfaces my uploaded "demo-istqb.md" (tenant isolation)
