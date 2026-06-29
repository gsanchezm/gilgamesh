// =============================================================================
// Gilgamesh — Azure QA environment (DESIGN ONLY — NEVER deployed by the agent)
// -----------------------------------------------------------------------------
// Single small QA environment for the Gilgamesh multi-tenant QA platform. NO prod.
// The product owner performs `az login` + subscription auth and decides WHEN to
// deploy; cloud cost begins only on deploy (decisions-log #11). This template is a
// declarative CONTRACT — the agent does not run `az`/`bicep` and does not apply it.
//
// What this provisions (each in its own module, see ./modules):
//   - User-Assigned Managed Identity      (one workload identity for every app)
//   - Log Analytics workspace             (Container Apps logs)
//   - Azure Container Registry            (images; AcrPull via identity)
//   - Container Apps env + apps           (api, workers, chaos-proxy, plugin, SUT)
//   - Postgres Flexible Server + pgvector (all entities + KnowledgeChunk embeddings)
//   - Blob Storage                        (Artifacts via signed expiring URLs)
//   - Service Bus                         (run queue + RunEvent topic; EventBus port)
//   - Key Vault                           (secrets / integration tokens / LLM key)
//
// Cost: see specs/infra/azure-environments.md. Scale-to-zero Container Apps keep idle
// compute ~$0; the dominant idle cost is Postgres (stop it when not in use).
//
// Deploy (OWNER runs this — NOT the agent):
//   az group create -n rg-gilgamesh-qa -l eastus2
//   az deployment group create -g rg-gilgamesh-qa -f infra/bicep/main.bicep \
//     -p postgresAdminPassword='...' -p sessionSecret='...' [-p llmApiKey='...']
//   (or wrap those secure params in an owner-authored .bicepparam file). Full runbook:
//   specs/infra/azure-environments.md §12.
// =============================================================================

targetScope = 'resourceGroup'

// ----------------------------- Parameters ------------------------------------
@description('Azure region for all resources.')
param location string = resourceGroup().location

@description('Workload name prefix used to compose resource names.')
@minLength(3)
@maxLength(12)
param namePrefix string = 'gilgamesh'

@description('Environment short code. QA only — there is no prod env in this template.')
@allowed([ 'qa' ])
param env string = 'qa'

@description('Postgres administrator password. Supplied securely at deploy; copied into Key Vault.')
@secure()
param postgresAdminPassword string

@description('Session signing secret (httpOnly session cookie, slice-1 auth). Stored in Key Vault.')
@secure()
param sessionSecret string

@description('LLM provider API key for AgentBrainPort (Claude default). Stored in Key Vault.')
@secure()
param llmApiKey string = ''

@description('Enable private networking (VNet integration + private Postgres). Default false to keep QA idle cost ~0 (no private-endpoint hourly charges).')
param enablePrivateNetworking bool = false

@description('Service Bus SKU. Standard required for the RunEvent topic (EventBus).')
@allowed([ 'Basic', 'Standard' ])
param serviceBusSku string = 'Standard'

@description('Owner-delivered image references (keystone §7). Default placeholders keep runner apps at zero until images exist.')
param chaosProxyImage string = ''
param playwrightPluginImage string = ''
param omnipizzaImage string = ''

@description('Common tags.')
param tags object = {
  app: 'gilgamesh'
  env: 'qa'
  managedBy: 'bicep'
  costCenter: 'qa-foundation'
}

// ----------------------------- Naming ----------------------------------------
var suffix = take(uniqueString(resourceGroup().id), 6)
var alnumPrefix = toLower(replace(namePrefix, '-', ''))

var identityName = '${namePrefix}-${env}-id'
var lawName = '${namePrefix}-${env}-law'
var acrName = take('${alnumPrefix}${env}acr${suffix}', 50)
var kvName = take('${alnumPrefix}${env}kv${suffix}', 24)
var storageName = take('${alnumPrefix}${env}st${suffix}', 24)
var serviceBusName = take('${alnumPrefix}-${env}-sb-${suffix}', 50)
var postgresName = take('${namePrefix}-${env}-pg-${suffix}', 63)
var caeName = '${namePrefix}-${env}-cae'

// AcrPull built-in role.
var acrPullRoleId = '7f951dda-4ed3-4680-a7ca-43fe172d538d'

// Public network access for PaaS data services: ON (firewall-gated) unless private networking is enabled.
var allowPublic = !enablePrivateNetworking

// ----------------------- Workload Managed Identity ---------------------------
// One user-assigned identity used by every Container App for ACR pull, Key Vault
// references, Postgres (Entra-capable), Blob (User-Delegation SAS) and Service Bus.
resource workloadIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: identityName
  location: location
  tags: tags
}

// ----------------------- Log Analytics workspace -----------------------------
resource law 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: lawName
  location: location
  tags: tags
  properties: {
    sku: { name: 'PerGB2018' }
    retentionInDays: 30
    workspaceCapping: {
      dailyQuotaGb: 1 // cap ingestion to bound QA log cost
    }
    features: { enableLogAccessUsingOnlyResourcePermissions: true }
  }
}

// ----------------------- Container Registry ----------------------------------
resource acr 'Microsoft.ContainerRegistry/registries@2023-11-01-preview' = {
  name: acrName
  location: location
  tags: tags
  sku: { name: 'Basic' } // QA: Basic is cheapest; no geo-replication.
  properties: {
    adminUserEnabled: false // identity-based pull only (no admin creds).
  }
}

// Let the workload identity pull images from ACR.
resource acrPull 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(acr.id, workloadIdentity.id, acrPullRoleId)
  scope: acr
  properties: {
    principalId: workloadIdentity.properties.principalId
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', acrPullRoleId)
    principalType: 'ServicePrincipal'
  }
}

// =============================== Modules ======================================

// ---- Key Vault (secrets / integration tokens / LLM key) ----
module keyVault './modules/keyVault.bicep' = {
  name: 'keyVault'
  params: {
    location: location
    tags: tags
    keyVaultName: kvName
    workloadIdentityPrincipalId: workloadIdentity.properties.principalId
    allowPublicNetworkAccess: allowPublic
  }
}

// ---- Postgres Flexible Server + pgvector ----
module postgres './modules/postgres.bicep' = {
  name: 'postgres'
  params: {
    location: location
    tags: tags
    serverName: postgresName
    administratorLoginPassword: postgresAdminPassword
    allowPublicNetworkAccess: allowPublic
    // Private-networking subnet/DNS wiring is a documented hardening follow-on
    // (see azure-environments.md). Left empty here = public/firewall mode.
    delegatedSubnetId: ''
    privateDnsZoneId: ''
  }
}

// ---- Blob Storage (Artifacts + Knowledge docs) ----
module blob './modules/blob.bicep' = {
  name: 'blob'
  params: {
    location: location
    tags: tags
    storageAccountName: storageName
    workloadIdentityPrincipalId: workloadIdentity.properties.principalId
    allowPublicNetworkAccess: allowPublic
  }
}

// ---- Service Bus (run queue + RunEvent topic) ----
module serviceBus './modules/serviceBus.bicep' = {
  name: 'serviceBus'
  params: {
    location: location
    tags: tags
    namespaceName: serviceBusName
    skuName: serviceBusSku
    workloadIdentityPrincipalId: workloadIdentity.properties.principalId
    allowPublicNetworkAccess: allowPublic
  }
}

// ---- Container Apps (api, workers, chaos-proxy, plugin, omnipizza) ----
// Explicitly depends on the seeded KV secrets (declared below): the app revisions
// resolve `db-connection-string` / `session-secret` / `llm-api-key` Key Vault
// references at provision time, so those secrets MUST exist first (no race).
module containerApps './modules/containerApps.bicep' = {
  name: 'containerApps'
  dependsOn: [ dbConnSecret, sessionSecretKv, llmKeySecret ]
  params: {
    location: location
    tags: tags
    environmentName: caeName
    logAnalyticsCustomerId: law.properties.customerId
    logAnalyticsSharedKey: law.listKeys().primarySharedKey
    workloadIdentityId: workloadIdentity.id
    workloadIdentityClientId: workloadIdentity.properties.clientId
    registryServer: acr.properties.loginServer
    // Owner-delivered images (keystone §7); placeholders keep these apps at zero.
    chaosProxyImage: empty(chaosProxyImage) ? '${acr.properties.loginServer}/chaos-proxy:latest' : chaosProxyImage
    playwrightPluginImage: empty(playwrightPluginImage) ? '${acr.properties.loginServer}/plugin-playwright:latest' : playwrightPluginImage
    omnipizzaImage: empty(omnipizzaImage) ? '${acr.properties.loginServer}/omnipizza:latest' : omnipizzaImage
    keyVaultUri: keyVault.outputs.keyVaultUri
    blobEndpoint: blob.outputs.blobEndpoint
    artifactsContainerName: blob.outputs.artifactsContainerName
    knowledgeContainerName: blob.outputs.knowledgeContainerName
    serviceBusNamespaceName: serviceBus.outputs.namespaceName
    serviceBusNamespaceFqdn: serviceBus.outputs.namespaceFqdn
    runQueueName: serviceBus.outputs.runQueueName
    runEventsTopicName: serviceBus.outputs.runEventsTopicName
    postgresFqdn: postgres.outputs.fqdn
    postgresDatabaseName: postgres.outputs.databaseName
  }
}

// ---- Seed the DB connection string into Key Vault (Container Apps reference it) ----
// llm-api-key and session-secret are also stored so the api/workers can read them as
// Key Vault references. These are control-plane writes at deploy time; the deploying
// principal needs Key Vault Secrets Officer + network reachability to the vault.
resource kvRef 'Microsoft.KeyVault/vaults@2023-07-01' existing = {
  name: kvName
}

resource dbConnSecret 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: kvRef
  name: 'db-connection-string'
  properties: {
    value: 'postgresql://${postgres.outputs.administratorLogin}:${postgresAdminPassword}@${postgres.outputs.fqdn}:5432/${postgres.outputs.databaseName}?sslmode=require'
  }
  dependsOn: [ keyVault ]
}

resource sessionSecretKv 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: kvRef
  name: 'session-secret'
  properties: {
    value: sessionSecret
  }
  dependsOn: [ keyVault ]
}

// ALWAYS seed llm-api-key so the unconditional Key Vault reference in containerApps
// (api + workers bind `secretRef: llm-api-key`) resolves on the very first deploy.
// When no key is supplied at deploy, a placeholder is written; the owner sets the real
// value later (`az keyvault secret set`) without redeploying. AgentBrainPort (keystone §5).
resource llmKeySecret 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: kvRef
  name: 'llm-api-key'
  properties: {
    value: empty(llmApiKey) ? 'PLACEHOLDER_SET_BY_OWNER' : llmApiKey
  }
  dependsOn: [ keyVault ]
}

// ----------------------------- Outputs ---------------------------------------
@description('Public api URL (empty if api ingress is internal-only).')
output apiUrl string = empty(containerApps.outputs.apiFqdn) ? '' : 'https://${containerApps.outputs.apiFqdn}'
@description('Container Apps environment resource ID.')
output containerAppsEnvironmentId string = containerApps.outputs.environmentId
@description('Key Vault URI.')
output keyVaultUri string = keyVault.outputs.keyVaultUri
@description('Postgres FQDN.')
output postgresFqdn string = postgres.outputs.fqdn
@description('Blob endpoint.')
output blobEndpoint string = blob.outputs.blobEndpoint
@description('Service Bus namespace host.')
output serviceBusNamespaceFqdn string = serviceBus.outputs.namespaceFqdn
@description('ACR login server (push images here before scaling runner apps up).')
output acrLoginServer string = acr.properties.loginServer
@description('Workload identity client ID (AZURE_CLIENT_ID for app SDK clients).')
output workloadIdentityClientId string = workloadIdentity.properties.clientId
