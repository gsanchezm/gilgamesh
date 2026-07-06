Feature: Secret vault — real Azure Key Vault behind the frozen SecretVault port
  Slice 20 closes the slice-6 deferral: the SecretVault port gets a real Azure Key Vault
  adapter selected by env (vaultFromEnv), with the S15 security INVERSION — the in-memory
  stub needs an EXPLICIT VAULT_MODE=offline (refused under NODE_ENV=production) and missing
  config is a boot error, never a silent stub. The secretRef contract is unchanged:
  put(scope) returns vault://<scope>; the Key Vault secret NAME is the deterministic
  injective encoding of the scope (alnum verbatim, every other byte -> "-hh" hex).
  The default sweep runs pinned VAULT_MODE=offline, so the executable scenario below proves
  the factory-bound stub keeps the slice-6/9 contract; boot-selector behavior is @wip
  (unit-tested — a boot refusal cannot answer an HTTP request) and the live Azure round-trip
  is @manual (needs credentials + network).

  Background:
    Given the API base path is "/api/v1"
    And I am signed in as "owner@uruk.io"
    And I have a BDD project named "OmniPizza"

  @AC-VAULT-01
  Scenario: Rotating a BYOK key by re-connecting keeps the secretRef contract and leaks neither key
    When I connect the "anthropic" integration with key "sk-ant-vault-old"
    Then the response status is 200
    When I connect the "anthropic" integration with key "sk-ant-vault-new"
    Then the response status is 200
    And the "anthropic" integration is connected with a secretRef
    And the raw key "sk-ant-vault-old" appears nowhere in the database or audit trail
    And the raw key "sk-ant-vault-new" appears nowhere in the database or audit trail

  @wip @AC-VAULT-02
  Scenario: AZURE_KEY_VAULT_URL selects the real Azure Key Vault adapter
    Given the API boots with AZURE_KEY_VAULT_URL set and no VAULT_MODE pin
    Then the SecretVault port is served by the Azure Key Vault adapter
    And the client targets the trimmed vault URL with DefaultAzureCredential

  @wip @AC-VAULT-03
  Scenario: Missing vault config is a boot error, never a silent stub
    Given the API boots without AZURE_KEY_VAULT_URL and without VAULT_MODE=offline
    Then the boot fails with an error naming AZURE_KEY_VAULT_URL and VAULT_MODE

  @wip @AC-VAULT-03
  Scenario: The offline stub refuses to run in production
    Given the API boots with VAULT_MODE=offline under NODE_ENV=production
    Then the boot fails with an error refusing the offline vault stub

  @manual @AC-VAULT-04 @AC-VAULT-05
  Scenario: Live round-trip against a real Azure Key Vault (manual smoke)
    Given a reachable Azure Key Vault and a signed-in OWNER
    When I connect the "anthropic" integration with a real key
    Then the vault holds a secret named by the deterministic scope encoding
    And the integration row stores only the "vault://" reference
    And a chat message routes through the org's own key
    And no log, error, row, or view ever contains the raw key
