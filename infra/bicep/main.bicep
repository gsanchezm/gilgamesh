// =============================================================================
// Gilgamesh — Azure environment (v2 — STAGING DEPLOYABLE)
// -----------------------------------------------------------------------------
// First deployed environment for the platform, per owner decisions SD-1..4
// (2026-07-06, specs/infra/staging-deploy.md). SD-4 relaxes the foundation
// "agent never deploys" contract for this objective: the owner runs `az login`
// in-session and the agent executes the az commands UNDER OWNER SUPERVISION.
// The spec §8 runbook stays authoritative for manual re-runs. The original QA
// design notes (decisions-log #11, specs/infra/azure-environments.md) remain
// valid for env=qa.
//
// What this provisions (each in its own module, see ./modules):
//   - User-Assigned Managed Identity      (ACR pull + KV references + KV data plane for
//                                          the S20 runtime SecretVault)
//   - Log Analytics workspace             (Container Apps logs)
//   - Azure Container Registry            (images; AcrPull via identity)
//   - Key Vault                           (deploy-seeded secrets + S20 `vault://` secrets)
//   - Postgres Flexible Server + pgvector (all entities + KnowledgeChunk embeddings)
//   - Container Apps env + ONE app        (API + built SPA)      — gated by deployApp
//   - [gated OFF] Blob Storage            (deployBlob)           — Artifacts; unused yet
//   - [gated OFF] Service Bus             (deployServiceBus)     — run queue; TOM runners
//                                          are keystone §7 BLOCKED-UNTIL-DELIVERED
//
// TWO-PHASE FIRST DEPLOY (spec §8): the Container App references an image that must
// already exist in ACR, so the first rollout is:
//   az group create -n rg-gilgamesh-staging -l eastus2
//   # Phase 1 — platform resources only (identity, LAW, ACR, KV, Postgres); no app:
//   az deployment group create -g rg-gilgamesh-staging -f infra/bicep/main.bicep \
//     -p env=staging -p deployApp=false \
//     -p postgresAdminPassword=<gen> -p sessionSecret=<gen>
//   # Phase 2 — build the image in the cloud (no local docker needed):
//   az acr build -r <acr> -t gilgamesh-app:<gitsha> -f Dockerfile .
//   # Phase 3 — same template, now with the app on the freshly pushed image:
//   az deployment group create -g rg-gilgamesh-staging -f infra/bicep/main.bicep \
//     -p env=staging -p deployApp=true \
//     -p appImage=<acr>.azurecr.io/gilgamesh-app:<gitsha> \
//     -p postgresAdminPassword=<gen> -p sessionSecret=<gen> [-p anthropicApiKey=...]
//
// Cost: see specs/infra/azure-environments.md. Scale-to-zero Container Apps keep idle
// compute ~$0; the dominant idle cost is Postgres (stop it when not in use).
// =============================================================================

targetScope = 'resourceGroup'

// ----------------------------- Parameters ------------------------------------
@description('Azure region for all resources.')
param location string = resourceGroup().location

@description('Workload name prefix used to compose resource names.')
@minLength(3)
@maxLength(12)
param namePrefix string = 'gilgamesh'

@description('Environment short code.')
@allowed([ 'qa', 'staging' ])
param env string = 'staging'

@description('Deploy the Container Apps environment + app. false = phase 1 (platform resources only, spec §8); true = phase 3, requires appImage pushed to ACR.')
param deployApp bool = false

@description('Full image reference for the single app (API+SPA), e.g. <acr>.azurecr.io/gilgamesh-app:<gitsha>. ALWAYS pass it with deployApp=true: the empty-value fallback is :latest, which only exists when the runbook az acr build multi-tags (-t :<gitsha> -t :latest) — an absent tag = failed first revision (review C D3).')
param appImage string = ''

@description('Provision Service Bus (run queue + RunEvent topic). OFF until the TOM runners land (keystone §7 BLOCKED-UNTIL-DELIVERED).')
param deployServiceBus bool = false

@description('Provision Blob Storage (Artifacts + Knowledge docs). OFF until anything consumes it.')
param deployBlob bool = false

@description('Postgres administrator password. Supplied securely at deploy; copied into Key Vault.')
@secure()
param postgresAdminPassword string

@description('Session signing secret (slice-1 auth). Stored in Key Vault.')
@secure()
param sessionSecret string

@description('Anthropic API key for the real ClaudeBrain (S9). Empty = the anthropic-api-key secret is NOT created and the env var is NOT bound, so the deterministic stub answers (spec §5 caveat: a placeholder value would select the REAL brain).')
@secure()
param anthropicApiKey string = ''

@description('KEEP false. Setting true locks Key Vault + Postgres behind Deny-default networking, but the Container Apps env is NOT VNet-wired in this template (infrastructureSubnetId is never passed), so the app could reach neither KV references nor the DB, and the ARM secret seeding below would also fail. Full private networking is a documented follow-on (review C D6).')
param enablePrivateNetworking bool = false

@description('Service Bus SKU (only used when deployServiceBus=true). Standard required for the RunEvent topic (EventBus).')
@allowed([ 'Basic', 'Standard' ])
param serviceBusSku string = 'Standard'

@description('Common tags.')
param tags object = {
  app: 'gilgamesh'
  env: env
  managedBy: 'bicep'
  costCenter: 'gilgamesh-${env}'
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
// One user-assigned identity used by the app for ACR pull, Key Vault references AND
// the S20 runtime SecretVault (DefaultAzureCredential via AZURE_CLIENT_ID).
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
      dailyQuotaGb: 1 // cap ingestion to bound log cost
    }
    features: { enableLogAccessUsingOnlyResourcePermissions: true }
  }
}

// ----------------------- Container Registry ----------------------------------
resource acr 'Microsoft.ContainerRegistry/registries@2023-11-01-preview' = {
  name: acrName
  location: location
  tags: tags
  sku: { name: 'Basic' } // Basic is cheapest; no geo-replication.
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

// ---- Key Vault (deploy-seeded secrets + the S20 runtime SecretVault) ----
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

// ---- Blob Storage (Artifacts + Knowledge docs) — GATED OFF until consumed ----
module blob './modules/blob.bicep' = if (deployBlob) {
  name: 'blob'
  params: {
    location: location
    tags: tags
    storageAccountName: storageName
    workloadIdentityPrincipalId: workloadIdentity.properties.principalId
    allowPublicNetworkAccess: allowPublic
  }
}

// ---- Service Bus (run queue + RunEvent topic) — GATED OFF until TOM lands ----
module serviceBus './modules/serviceBus.bicep' = if (deployServiceBus) {
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

// ---- Container Apps (ONE app: API + built SPA) — gated by deployApp (spec §8) ----
// Explicitly depends on the seeded KV secrets: the app revision resolves
// `db-connection-string` / `session-secret` (and, when supplied, `anthropic-api-key`)
// as Key Vault references at provision time, so those secrets MUST exist first.
// (A dependsOn entry whose condition is false is dropped by ARM automatically.)
// NOTE: the TOM runner fleet lives behind `deployRunners` INSIDE the module (default
// off); re-enabling it later also means passing the SB/Blob wiring params back in.
module containerApps './modules/containerApps.bicep' = if (deployApp) {
  name: 'containerApps'
  // acrPull: a single-shot deployApp=true on a fresh RG could otherwise provision the app before
  // the AcrPull role assignment is effective -> UNAUTHORIZED image pull (review C D5).
  dependsOn: [ dbConnSecret, sessionSecretKv, anthropicKeySecret, acrPull ]
  params: {
    location: location
    tags: tags
    environmentName: caeName
    logAnalyticsCustomerId: law.properties.customerId
    logAnalyticsSharedKey: law.listKeys().primarySharedKey
    workloadIdentityId: workloadIdentity.id
    workloadIdentityClientId: workloadIdentity.properties.clientId
    registryServer: acr.properties.loginServer
    appImage: empty(appImage) ? '${acr.properties.loginServer}/gilgamesh-app:latest' : appImage
    keyVaultUri: keyVault.outputs.keyVaultUri
    hasAnthropicKey: !empty(anthropicApiKey)
  }
}

// ---- Seed deploy-time secrets into Key Vault (the app references them) ----
// Control-plane writes at deploy time; the deploying principal needs Key Vault
// Secrets Officer + network reachability to the vault.
resource kvRef 'Microsoft.KeyVault/vaults@2023-07-01' existing = {
  name: kvName
}

resource dbConnSecret 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: kvRef
  name: 'db-connection-string'
  properties: {
    // uriComponent(): a CSPRNG password with URL-reserved chars (@ / : ? # % &) would otherwise
    // produce a DSN Prisma can't parse -> migrate deploy fails -> first revision crash-loops (review C D1).
    value: 'postgresql://${postgres.outputs.administratorLogin}:${uriComponent(postgresAdminPassword)}@${postgres.outputs.fqdn}:5432/${postgres.outputs.databaseName}?sslmode=require'
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

// Created ONLY when a real key is supplied (spec §5 caveat): the S9 selector treats ANY
// non-empty ANTHROPIC_API_KEY as "select the real ClaudeBrain", so a placeholder value
// would silently break the stub-degradation contract. No key ⇒ no secret ⇒ the env var
// is not bound (hasAnthropicKey=false in the containerApps module) ⇒ the stub answers.
// Activate later without a redeploy: `az keyvault secret set --name anthropic-api-key`
// + re-run phase 3 with -p anthropicApiKey=... (binds the env var), per spec §8.
resource anthropicKeySecret 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = if (!empty(anthropicApiKey)) {
  parent: kvRef
  name: 'anthropic-api-key'
  properties: {
    value: anthropicApiKey
  }
  dependsOn: [ keyVault ]
}

// ----------------------------- Outputs ---------------------------------------
// Outputs referencing gated modules use `condition ? … : ''` — ARM's if() only
// evaluates the taken branch, so phase-1 deploys (deployApp=false) never dereference
// the absent module.
@description('Public app URL (empty until deployApp=true).')
output appUrl string = deployApp ? 'https://${containerApps.outputs.appFqdn}' : ''
@description('Container Apps environment resource ID (empty until deployApp=true).')
output containerAppsEnvironmentId string = deployApp ? containerApps.outputs.environmentId : ''
@description('Key Vault URI (AZURE_KEY_VAULT_URL for the S20 runtime vault).')
output keyVaultUri string = keyVault.outputs.keyVaultUri
@description('Postgres FQDN.')
output postgresFqdn string = postgres.outputs.fqdn
@description('Blob endpoint (empty unless deployBlob=true).')
output blobEndpoint string = deployBlob ? blob.outputs.blobEndpoint : ''
@description('Service Bus namespace host (empty unless deployServiceBus=true).')
output serviceBusNamespaceFqdn string = deployServiceBus ? serviceBus.outputs.namespaceFqdn : ''
@description('ACR login server (phase 2 target: az acr build -r <this> -t gilgamesh-app:<gitsha>).')
output acrLoginServer string = acr.properties.loginServer
@description('Workload identity client ID (AZURE_CLIENT_ID for DefaultAzureCredential).')
output workloadIdentityClientId string = workloadIdentity.properties.clientId
