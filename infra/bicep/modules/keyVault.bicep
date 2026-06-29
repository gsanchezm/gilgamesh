// =============================================================================
// Gilgamesh — Key Vault module (DESIGN ONLY — never deployed by the agent)
// -----------------------------------------------------------------------------
// Backs:
//   - keystone §2 Integration.secretRef  (NEVER a raw token; always a KV ref)
//   - keystone §5 AgentBrainPort          (LLM provider API key — Claude default)
//   - DB / Service Bus / Storage connection secrets consumed by Container Apps
//
// Security posture (decisions-log "Security is primordial", OWASP ASVS L2):
//   - RBAC authorization model (enableRbacAuthorization=true) — NO access policies.
//   - Soft-delete + purge protection ON.
//   - Public network access parameterized; default OFF when private networking is on.
//   - Container Apps read secrets via *User-Assigned Managed Identity* (no keys in env).
//
// Cost: a Key Vault has no idle compute cost; billed per 10k operations (negligible
//       at QA scale). Safe to leave provisioned.
// =============================================================================

@description('Azure region. Defaults to the resource group location.')
param location string = resourceGroup().location

@description('Globally-unique Key Vault name (3-24 chars, alphanumeric + dashes).')
@minLength(3)
@maxLength(24)
param keyVaultName string

@description('Tags applied to every resource.')
param tags object = {}

@description('Principal (objectId) of the workload User-Assigned Managed Identity that reads secrets.')
param workloadIdentityPrincipalId string

@description('Allow public network access. Default false; set true only for the cost-min QA tier without private endpoints, gated by firewall.')
param allowPublicNetworkAccess bool = false

@description('Tenant ID for the Key Vault (defaults to the deploying tenant).')
param tenantId string = subscription().tenantId

// Built-in role: "Key Vault Secrets User" — read secret values only (least privilege).
var keyVaultSecretsUserRoleId = '4633458b-17de-408a-b874-0445c86b69e6'

resource keyVault 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: keyVaultName
  location: location
  tags: tags
  properties: {
    sku: {
      family: 'A'
      name: 'standard' // 'premium' only if HSM-backed keys are required (not for QA).
    }
    tenantId: tenantId
    // RBAC instead of legacy access policies — auditable, least-privilege, ASVS L2.
    enableRbacAuthorization: true
    enableSoftDelete: true
    softDeleteRetentionInDays: 90
    enablePurgeProtection: true
    publicNetworkAccess: allowPublicNetworkAccess ? 'Enabled' : 'Disabled'
    networkAcls: {
      bypass: 'AzureServices'
      // Default Deny; private endpoint (when enabled) or explicit firewall rules grant access.
      defaultAction: allowPublicNetworkAccess ? 'Allow' : 'Deny'
    }
  }
}

// Grant the workload identity read-only access to secrets (scoped to THIS vault).
resource secretsUserAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(keyVault.id, workloadIdentityPrincipalId, keyVaultSecretsUserRoleId)
  scope: keyVault
  properties: {
    principalId: workloadIdentityPrincipalId
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', keyVaultSecretsUserRoleId)
    principalType: 'ServicePrincipal'
  }
}

@description('Resource ID of the Key Vault.')
output keyVaultId string = keyVault.id
@description('Vault URI (https://<name>.vault.azure.net/) used to build Key Vault references.')
output keyVaultUri string = keyVault.properties.vaultUri
@description('Key Vault name (for Container Apps secret keyVaultUrl references).')
output keyVaultName string = keyVault.name
