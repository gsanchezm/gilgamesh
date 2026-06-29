// =============================================================================
// Gilgamesh — Container Apps module (DESIGN ONLY — never deployed)
// -----------------------------------------------------------------------------
// Hosts the keystone §4 runtime as Azure Container Apps on the Consumption plan:
//   - api          (apps/api, NestJS)        — external HTTPS ingress, HTTP scaler
//   - workers      (apps/workers)            — no ingress, KEDA Service Bus scaler
//   - chaos-proxy  (kernel runner :50051)    — internal gRPC, owner-delivered image
//   - playwright   (kernel plugin)           — internal gRPC, owner-delivered image
//   - omnipizza    (sample SUT)              — internal HTTP, owner-delivered image
//
// SCALE-TO-ZERO (decision #11 / cost): every app has minReplicas = 0. Idle cost on
// the Consumption plan is ~$0 (billed per vCPU-second / GiB-second only while active).
// Workers + runners are woken by KEDA on the Service Bus 'runs' queue depth; the api
// is woken by inbound HTTP. chaos-proxy / playwright / omnipizza are owner-delivered
// (keystone §7 BLOCKED-UNTIL-DELIVERED) — their images default to placeholders and the
// apps stay at zero replicas until real images + the run queue make them scale up.
//
// AUTH: every app runs under one *user-assigned Managed Identity* (passed in) used for
// ACR pull, Key Vault references, Postgres (Entra), Blob (User-Delegation SAS) and
// Service Bus. No connection strings or keys live in plaintext env vars.
// =============================================================================

@description('Azure region.')
param location string = resourceGroup().location

@description('Tags applied to every resource.')
param tags object = {}

@description('Container Apps managed environment name.')
param environmentName string

@description('Log Analytics workspace customer (workspace) ID for the environment.')
param logAnalyticsCustomerId string

@description('Log Analytics shared key. @secure — sourced from the workspace at deploy.')
@secure()
param logAnalyticsSharedKey string

@description('Resource ID of the workload user-assigned Managed Identity.')
param workloadIdentityId string

@description('Client ID of the workload identity (AZURE_CLIENT_ID for DefaultAzureCredential).')
param workloadIdentityClientId string

@description('Container registry login server (e.g. gilgameshqa.azurecr.io). ACR pull via identity.')
param registryServer string

// ---- Container images (owner-supplied at deploy; placeholders keep apps at zero) ----
@description('API image reference.')
param apiImage string = '${registryServer}/gilgamesh-api:latest'
@description('Workers image reference.')
param workersImage string = '${registryServer}/gilgamesh-workers:latest'
@description('chaos-proxy (kernel) image — OWNER-DELIVERED (keystone §7). Placeholder until provided.')
param chaosProxyImage string = '${registryServer}/chaos-proxy:latest'
@description('Playwright plugin image — OWNER-DELIVERED (keystone §7). Placeholder until provided.')
param playwrightPluginImage string = '${registryServer}/plugin-playwright:latest'
@description('OmniPizza sample SUT image — OWNER-DELIVERED (keystone §7). Placeholder until provided.')
param omnipizzaImage string = '${registryServer}/omnipizza:latest'

// ---- Wiring (non-secret config) ----
@description('Key Vault URI used to build Key Vault references for secrets.')
param keyVaultUri string
@description('Primary blob endpoint (ArtifactStorage backend).')
param blobEndpoint string
@description('Artifacts container name.')
param artifactsContainerName string
@description('Knowledge container name.')
param knowledgeContainerName string
@description('Service Bus namespace name (KEDA scaler + SDK).')
param serviceBusNamespaceName string
@description('Service Bus fully-qualified namespace host.')
param serviceBusNamespaceFqdn string
@description('Run-queue name (worker/runner KEDA trigger).')
param runQueueName string
@description('RunEvent topic name.')
param runEventsTopicName string
@description('Postgres FQDN.')
param postgresFqdn string
@description('Application database name.')
param postgresDatabaseName string

// ---- Network / ingress ----
@description('Optional infrastructure subnet resource ID for VNet-integrated environment. Empty = managed network.')
param infrastructureSubnetId string = ''
@description('Make the api ingress internal-only (true) or external/public (false). QA default external.')
param apiInternalOnly bool = false
@description('HTTP port the api container listens on.')
param apiPort int = 3000
@description('gRPC port chaos-proxy listens on (keystone §7 :50051).')
param chaosProxyPort int = 50051
@description('HTTP port the OmniPizza SUT listens on.')
param omnipizzaPort int = 8080

// ---- Scale bounds (min always 0 = scale-to-zero) ----
@description('Max api replicas.')
param apiMaxReplicas int = 3
@description('Max worker replicas.')
param workersMaxReplicas int = 4
@description('Max runner replicas (chaos-proxy / plugins).')
param runnerMaxReplicas int = 2
@description('Service Bus queue depth that triggers one worker/runner replica.')
param queueMessagesPerReplica int = 5

var useVnet = !empty(infrastructureSubnetId)

// Common identity block — one user-assigned identity for every app.
var identityBlock = {
  type: 'UserAssigned'
  userAssignedIdentities: {
    '${workloadIdentityId}': {}
  }
}

// ACR pull + Key Vault references both authenticate with the user-assigned identity.
var registries = [
  {
    server: registryServer
    identity: workloadIdentityId
  }
]

// Key Vault references (secret name in KV must be seeded by the deploy script).
//   db-connection-string : Postgres DSN (or omit when using Entra-only DB auth)
//   llm-api-key          : AgentBrainPort provider key (Claude default — keystone §5)
//   session-secret       : httpOnly session signing key (keystone §0 slice-1 auth)
var apiSecrets = [
  {
    name: 'db-connection-string'
    keyVaultUrl: '${keyVaultUri}secrets/db-connection-string'
    identity: workloadIdentityId
  }
  {
    name: 'llm-api-key'
    keyVaultUrl: '${keyVaultUri}secrets/llm-api-key'
    identity: workloadIdentityId
  }
  {
    name: 'session-secret'
    keyVaultUrl: '${keyVaultUri}secrets/session-secret'
    identity: workloadIdentityId
  }
]

// Non-secret env shared by api + workers (managed-identity clients read these).
var commonEnv = [
  { name: 'NODE_ENV', value: 'production' }
  { name: 'AZURE_CLIENT_ID', value: workloadIdentityClientId } // DefaultAzureCredential → this UAMI
  { name: 'KEY_VAULT_URI', value: keyVaultUri }
  { name: 'BLOB_ENDPOINT', value: blobEndpoint }
  { name: 'ARTIFACTS_CONTAINER', value: artifactsContainerName }
  { name: 'KNOWLEDGE_CONTAINER', value: knowledgeContainerName }
  { name: 'SERVICE_BUS_NAMESPACE', value: serviceBusNamespaceFqdn }
  { name: 'RUN_QUEUE', value: runQueueName }
  { name: 'RUN_EVENTS_TOPIC', value: runEventsTopicName }
  { name: 'POSTGRES_FQDN', value: postgresFqdn }
  { name: 'POSTGRES_DB', value: postgresDatabaseName }
  { name: 'CHAOS_PROXY_HOST', value: 'chaos-proxy' }       // internal env DNS
  { name: 'CHAOS_PROXY_PORT', value: string(chaosProxyPort) }
]

// KEDA Service Bus queue scaler (managed-identity auth) for workers + runners.
// ASSUMPTION (validate on first `bicep build` / portal): managed-identity auth for the
// azure-servicebus scaler is expressed as `rules[].custom.identity` = the UAMI resource
// ID, with `namespace` + `queueName` in metadata (Entra auth, no connection string). If a
// build rejects this, move `identity` to the rule level (`rules[].identity`). Tracked as an
// open question in specs/infra/azure-environments.md §13.
var serviceBusScaleRule = {
  name: 'run-queue-depth'
  custom: {
    type: 'azure-servicebus'
    metadata: {
      namespace: serviceBusNamespaceName
      queueName: runQueueName
      messageCount: string(queueMessagesPerReplica)
    }
    identity: workloadIdentityId
  }
}

// -----------------------------------------------------------------------------
// Container Apps managed environment (Consumption). VNet-integrated when a subnet
// is supplied; otherwise Azure-managed networking (cheapest QA default).
// -----------------------------------------------------------------------------
resource managedEnv 'Microsoft.App/managedEnvironments@2024-03-01' = {
  name: environmentName
  location: location
  tags: tags
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: logAnalyticsCustomerId
        sharedKey: logAnalyticsSharedKey
      }
    }
    zoneRedundant: false // QA: single zone (cost).
    vnetConfiguration: useVnet ? {
      infrastructureSubnetId: infrastructureSubnetId
      internal: true // private environment — no public env endpoint
    } : null
  }
}

// -----------------------------------------------------------------------------
// api — external HTTPS ingress (managed cert), HTTP concurrency scaler, scale-to-zero.
// -----------------------------------------------------------------------------
resource apiApp 'Microsoft.App/containerApps@2024-03-01' = {
  name: 'api'
  location: location
  tags: tags
  identity: identityBlock
  properties: {
    managedEnvironmentId: managedEnv.id
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: {
        external: !apiInternalOnly
        targetPort: apiPort
        transport: 'auto'
        allowInsecure: false
        traffic: [ { latestRevision: true, weight: 100 } ]
      }
      registries: registries
      secrets: apiSecrets
    }
    template: {
      containers: [
        {
          name: 'api'
          image: apiImage
          resources: { cpu: json('0.5'), memory: '1Gi' }
          env: concat(commonEnv, [
            { name: 'PORT', value: string(apiPort) }
            { name: 'DATABASE_URL', secretRef: 'db-connection-string' }
            { name: 'LLM_API_KEY', secretRef: 'llm-api-key' }
            { name: 'SESSION_SECRET', secretRef: 'session-secret' }
          ])
        }
      ]
      scale: {
        minReplicas: 0 // scale-to-zero
        maxReplicas: apiMaxReplicas
        rules: [
          {
            name: 'http-concurrency'
            http: { metadata: { concurrentRequests: '50' } }
          }
        ]
      }
    }
  }
}

// -----------------------------------------------------------------------------
// workers — no ingress; KEDA scales on the 'runs' Service Bus queue (scale-to-zero).
// Invokes @gilgamesh/kernel → chaos-proxy over internal gRPC.
// -----------------------------------------------------------------------------
resource workersApp 'Microsoft.App/containerApps@2024-03-01' = {
  name: 'workers'
  location: location
  tags: tags
  identity: identityBlock
  properties: {
    managedEnvironmentId: managedEnv.id
    configuration: {
      activeRevisionsMode: 'Single'
      registries: registries
      secrets: apiSecrets
    }
    template: {
      containers: [
        {
          name: 'workers'
          image: workersImage
          resources: { cpu: json('0.5'), memory: '1Gi' }
          env: concat(commonEnv, [
            { name: 'DATABASE_URL', secretRef: 'db-connection-string' }
            { name: 'LLM_API_KEY', secretRef: 'llm-api-key' }
          ])
        }
      ]
      scale: {
        minReplicas: 0
        maxReplicas: workersMaxReplicas
        rules: [ serviceBusScaleRule ]
      }
    }
  }
}

// -----------------------------------------------------------------------------
// chaos-proxy — internal gRPC ingress on :50051 (keystone §7). OWNER-DELIVERED image.
// Scales on the run queue so it is present while a Run is active, zero when idle.
// -----------------------------------------------------------------------------
resource chaosProxyApp 'Microsoft.App/containerApps@2024-03-01' = {
  name: 'chaos-proxy'
  location: location
  tags: tags
  identity: identityBlock
  properties: {
    managedEnvironmentId: managedEnv.id
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: {
        external: false // internal only — reachable by workers via env DNS
        targetPort: chaosProxyPort
        transport: 'http2' // gRPC
        allowInsecure: false
        traffic: [ { latestRevision: true, weight: 100 } ]
      }
      registries: registries
    }
    template: {
      containers: [
        {
          name: 'chaos-proxy'
          image: chaosProxyImage
          resources: { cpu: json('0.5'), memory: '1Gi' }
          env: [
            { name: 'AZURE_CLIENT_ID', value: workloadIdentityClientId }
            { name: 'PLAYWRIGHT_PLUGIN_HOST', value: 'plugin-playwright' }
          ]
        }
      ]
      scale: {
        minReplicas: 0
        maxReplicas: runnerMaxReplicas
        rules: [ serviceBusScaleRule ]
      }
    }
  }
}

// -----------------------------------------------------------------------------
// plugin-playwright — internal gRPC plugin server (keystone §7). OWNER-DELIVERED.
// -----------------------------------------------------------------------------
resource playwrightApp 'Microsoft.App/containerApps@2024-03-01' = {
  name: 'plugin-playwright'
  location: location
  tags: tags
  identity: identityBlock
  properties: {
    managedEnvironmentId: managedEnv.id
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: {
        external: false
        targetPort: 50050
        transport: 'http2'
        allowInsecure: false
        traffic: [ { latestRevision: true, weight: 100 } ]
      }
      registries: registries
    }
    template: {
      containers: [
        {
          name: 'plugin-playwright'
          image: playwrightPluginImage
          // Browser engines need more memory than the API.
          resources: { cpu: json('1.0'), memory: '2Gi' }
          env: [
            { name: 'OMNIPIZZA_BASE_URL', value: 'http://omnipizza' }
          ]
        }
      ]
      scale: {
        minReplicas: 0
        maxReplicas: runnerMaxReplicas
        rules: [ serviceBusScaleRule ]
      }
    }
  }
}

// -----------------------------------------------------------------------------
// omnipizza — sample System-Under-Test (keystone §7). OWNER-DELIVERED. Internal HTTP.
// -----------------------------------------------------------------------------
resource omnipizzaApp 'Microsoft.App/containerApps@2024-03-01' = {
  name: 'omnipizza'
  location: location
  tags: tags
  identity: identityBlock
  properties: {
    managedEnvironmentId: managedEnv.id
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: {
        external: false
        targetPort: omnipizzaPort
        transport: 'auto'
        allowInsecure: false
        traffic: [ { latestRevision: true, weight: 100 } ]
      }
      registries: registries
    }
    template: {
      containers: [
        {
          name: 'omnipizza'
          image: omnipizzaImage
          resources: { cpu: json('0.25'), memory: '0.5Gi' }
        }
      ]
      scale: {
        minReplicas: 0
        maxReplicas: 1
        rules: [ serviceBusScaleRule ]
      }
    }
  }
}

@description('Container Apps environment resource ID.')
output environmentId string = managedEnv.id
@description('Default domain of the managed environment.')
output environmentDefaultDomain string = managedEnv.properties.defaultDomain
@description('Public FQDN of the api app (empty when internal-only).')
output apiFqdn string = apiInternalOnly ? '' : apiApp.properties.configuration.ingress.fqdn
