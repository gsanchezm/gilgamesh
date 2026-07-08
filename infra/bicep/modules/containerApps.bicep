// =============================================================================
// Gilgamesh — Container Apps module (v2 — STAGING DEPLOYABLE, spec staging-deploy §2/§5)
// -----------------------------------------------------------------------------
// Hosts the platform on the Consumption plan:
//   - app          (apps/api serving API + built SPA)  — external HTTPS ingress.
//     ONE container, ONE origin (owner decision SD-3): `__Host-` cookies + the CSRF
//     double-submit behave exactly as in the Playwright harness. The image sets
//     WEB_DIST_DIR; probes hit /api/v1/health (prod global prefix, no exclusions).
//
// GATED OFF behind `deployRunners` (default false — TOM will return, keystone §7
// BLOCKED-UNTIL-DELIVERED; the resources are kept, not deleted):
//   - workers      (apps/workers)            — no ingress, KEDA Service Bus scaler
//   - chaos-proxy  (kernel runner :50051)    — internal gRPC, owner-delivered image
//   - playwright   (kernel plugin)           — internal gRPC, owner-delivered image
//   - omnipizza    (sample SUT)              — internal HTTP, owner-delivered image
//   The Service Bus KEDA scale rule + the legacy env names (BLOB_*/SERVICE_BUS_*/
//   POSTGRES_*/LLM_API_KEY/…) live ONLY on this gated path; their wiring params
//   default to '' so the ungated (app-only) deploy needs none of them. Re-enabling
//   runners also requires re-seeding the `llm-api-key` KV secret (main.bicep now
//   seeds `anthropic-api-key` conditionally instead) and passing the SB/Blob params.
//
// SCALE: the app runs minReplicas 0 / maxReplicas 1 — see the inline invariant note.
// AUTH: everything runs under one *user-assigned Managed Identity* (passed in) used
// for ACR pull, Key Vault secret references and the S20 runtime SecretVault
// (DefaultAzureCredential via AZURE_CLIENT_ID). No plaintext secrets in env vars.
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

@description('Container registry login server (e.g. gilgameshstagingacr.azurecr.io). ACR pull via identity.')
param registryServer string

@description('Key Vault URI: builds the Key Vault secret references AND is handed to the app as AZURE_KEY_VAULT_URL (S20 runtime SecretVault).')
param keyVaultUri string

// ---- The single product app (API + built SPA) ----
@description('Full image reference for the app (built by `az acr build`, spec §8 phase 2).')
param appImage string

@description('Port the API listens on (loadConfig API_PORT; ingress targetPort + probes must match).')
param appPort int = 3001

@description('Bind ANTHROPIC_API_KEY from the anthropic-api-key KV secret. ONLY true when the secret exists (main.bicep passes !empty(anthropicApiKey)) — referencing a missing secret fails the revision, and a placeholder value would select the REAL brain (S9 selector).')
param hasAnthropicKey bool = false

// ---- Gated runner fleet (TOM — keystone §7 BLOCKED-UNTIL-DELIVERED) ----
@description('Deploy the workers/chaos-proxy/plugin-playwright/omnipizza fleet. Default OFF until the TOM kernel lands; the ungated path needs none of the params below.')
param deployRunners bool = false

@description('Workers image reference (runners path only).')
param workersImage string = '${registryServer}/gilgamesh-workers:latest'
@description('chaos-proxy (kernel) image — OWNER-DELIVERED (keystone §7). Placeholder until provided.')
param chaosProxyImage string = '${registryServer}/chaos-proxy:latest'
@description('Playwright plugin image — OWNER-DELIVERED (keystone §7). Placeholder until provided.')
param playwrightPluginImage string = '${registryServer}/plugin-playwright:latest'
@description('OmniPizza sample SUT image — OWNER-DELIVERED (keystone §7). Placeholder until provided.')
param omnipizzaImage string = '${registryServer}/omnipizza:latest'

// Legacy wiring consumed ONLY by the gated runners path. Defaults keep the app-only
// deploy parameter-free (main.bicep passes none of these while deployRunners=false).
@description('Primary blob endpoint (runners path only).')
param blobEndpoint string = ''
@description('Artifacts container name (runners path only).')
param artifactsContainerName string = ''
@description('Knowledge container name (runners path only).')
param knowledgeContainerName string = ''
@description('Service Bus namespace name (KEDA scaler; runners path only).')
param serviceBusNamespaceName string = ''
@description('Service Bus fully-qualified namespace host (runners path only).')
param serviceBusNamespaceFqdn string = ''
@description('Run-queue name (KEDA trigger; runners path only).')
param runQueueName string = ''
@description('RunEvent topic name (runners path only).')
param runEventsTopicName string = ''
@description('Postgres FQDN (runners path only).')
param postgresFqdn string = ''
@description('Application database name (runners path only).')
param postgresDatabaseName string = ''
@description('gRPC port chaos-proxy listens on (keystone §7 :50051).')
param chaosProxyPort int = 50051
@description('HTTP port the OmniPizza SUT listens on.')
param omnipizzaPort int = 8080
@description('Max worker replicas (runners path only).')
param workersMaxReplicas int = 4
@description('Max runner replicas (chaos-proxy / plugins).')
param runnerMaxReplicas int = 2
@description('Service Bus queue depth that triggers one worker/runner replica.')
param queueMessagesPerReplica int = 5

// ---- Network ----
@description('Optional infrastructure subnet resource ID for VNet-integrated environment. Empty = managed network.')
param infrastructureSubnetId string = ''

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

// -----------------------------------------------------------------------------
// app — secrets + env (spec staging-deploy §5 matrix; names are the REAL ones the
// API reads: apps/api/src/config.ts · infra/azure-key-vault.ts · infra/selecting-brain.ts).
// Deliberately ABSENT: REDIS_URL (single replica — see the scale invariant), every
// *_MODE (offline pins are for tests only; staging is real-or-degrade), and the
// legacy LLM_API_KEY / KEY_VAULT_URI / PORT / BLOB_* / SERVICE_BUS_* names.
// -----------------------------------------------------------------------------
var appSecrets = concat(
  [
    {
      name: 'db-connection-string'
      keyVaultUrl: '${keyVaultUri}secrets/db-connection-string'
      identity: workloadIdentityId
    }
    {
      name: 'session-secret'
      keyVaultUrl: '${keyVaultUri}secrets/session-secret'
      identity: workloadIdentityId
    }
  ],
  hasAnthropicKey ? [
    {
      name: 'anthropic-api-key'
      keyVaultUrl: '${keyVaultUri}secrets/anthropic-api-key'
      identity: workloadIdentityId
    }
  ] : []
)

var appEnv = concat(
  [
    { name: 'NODE_ENV', value: 'production' } // belt+braces with the image ENV
    { name: 'API_PORT', value: string(appPort) } // '3001' — loadConfig(); matches targetPort
    { name: 'AZURE_KEY_VAULT_URL', value: keyVaultUri } // S20 vaultFromEnv → AzureKeyVaultSecretVault
    { name: 'AZURE_CLIENT_ID', value: workloadIdentityClientId } // DefaultAzureCredential → this UAMI
    { name: 'CORS_ORIGINS', value: '' } // same-origin only (SD-3: the API serves the SPA)
    { name: 'DATABASE_URL', secretRef: 'db-connection-string' }
    { name: 'SESSION_SECRET', secretRef: 'session-secret' } // not yet consumed by the app (spec §5 keeps it provisioned)
    // Graceful-shutdown grace window in ms (slice 29). MUST satisfy the drain contract:
    //   readiness detect (periodSeconds × failureThreshold = 5×3 = 15s) < this (20s) < ACA SIGKILL
    //   (terminationGracePeriodSeconds default 30s). 20s = 15s for ACA to observe not-ready + ~5s to
    //   finish in-flight before app.close(). The app default is 10s — TOO SHORT here (ACA would never
    //   see not-ready before close → the drain would be a no-op), so it is set explicitly.
    { name: 'SHUTDOWN_GRACE_MS', value: '20000' }
  ],
  hasAnthropicKey ? [
    { name: 'ANTHROPIC_API_KEY', secretRef: 'anthropic-api-key' } // absent ⇒ deterministic stub (S9)
  ] : []
)

// -----------------------------------------------------------------------------
// Runners path only (deployRunners): legacy secrets/env kept verbatim for TOM's
// return. NOTE: `llm-api-key` is no longer seeded by main.bicep — re-seed it (or
// migrate workers to `anthropic-api-key`) before flipping deployRunners on.
// -----------------------------------------------------------------------------
var runnerSecrets = [
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
]

var runnerCommonEnv = [
  { name: 'NODE_ENV', value: 'production' }
  { name: 'AZURE_CLIENT_ID', value: workloadIdentityClientId }
  { name: 'KEY_VAULT_URI', value: keyVaultUri }
  { name: 'BLOB_ENDPOINT', value: blobEndpoint }
  { name: 'ARTIFACTS_CONTAINER', value: artifactsContainerName }
  { name: 'KNOWLEDGE_CONTAINER', value: knowledgeContainerName }
  { name: 'SERVICE_BUS_NAMESPACE', value: serviceBusNamespaceFqdn }
  { name: 'RUN_QUEUE', value: runQueueName }
  { name: 'RUN_EVENTS_TOPIC', value: runEventsTopicName }
  { name: 'POSTGRES_FQDN', value: postgresFqdn }
  { name: 'POSTGRES_DB', value: postgresDatabaseName }
  { name: 'CHAOS_PROXY_HOST', value: 'chaos-proxy' } // internal env DNS
  { name: 'CHAOS_PROXY_PORT', value: string(chaosProxyPort) }
]

// KEDA Service Bus queue scaler (managed-identity auth) — GATED runners path only.
// ASSUMPTION (validate when deployRunners first flips on): managed-identity auth for
// the azure-servicebus scaler is expressed as `rules[].custom.identity` = the UAMI
// resource ID, with `namespace` + `queueName` in metadata. If a build rejects this,
// move `identity` to the rule level (`rules[].identity`). Tracked in
// specs/infra/azure-environments.md §13.
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
// is supplied; otherwise Azure-managed networking (cheapest default).
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
    zoneRedundant: false // staging: single zone (cost).
    vnetConfiguration: useVnet ? {
      infrastructureSubnetId: infrastructureSubnetId
      internal: true // private environment — no public env endpoint
    } : null
  }
}

// -----------------------------------------------------------------------------
// app — API + built SPA in ONE container (owner decision SD-3). External HTTPS
// ingress (ACA-managed cert), scale-to-zero, probes on the prod health route.
// -----------------------------------------------------------------------------
resource app 'Microsoft.App/containerApps@2024-03-01' = {
  name: 'app'
  location: location
  tags: tags
  identity: identityBlock
  properties: {
    managedEnvironmentId: managedEnv.id
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: {
        external: true
        targetPort: appPort
        transport: 'auto'
        allowInsecure: false
        traffic: [ { latestRevision: true, weight: 100 } ]
      }
      registries: registries
      secrets: appSecrets
    }
    template: {
      containers: [
        {
          name: 'app'
          image: appImage
          resources: { cpu: json('0.5'), memory: '1Gi' }
          env: appEnv
          probes: [
            {
              // Cold start + `prisma migrate deploy` on boot: 24 × 5s = 120s headroom.
              // timeoutSeconds: the ACA default is 1s — swc-node lazy compilation on 0.5 vCPU can
              // stall an early response past that and fail a healthy boot (review C D2).
              type: 'Startup'
              httpGet: { path: '/api/v1/health', port: appPort }
              periodSeconds: 5
              failureThreshold: 24
              timeoutSeconds: 5
            }
            {
              // timeoutSeconds 5: at the 1s default, 3 CPU-saturated responses (RAG ingest,
              // first-request compiles) would restart a healthy app (review C D2).
              type: 'Liveness'
              httpGet: { path: '/api/v1/health', port: appPort }
              periodSeconds: 30
              timeoutSeconds: 5
            }
            {
              // Readiness (slice 27) — gates TRAFFIC only; a failing readiness probe makes ACA stop
              // routing to this replica but keeps it ALIVE (unlike Liveness, which restarts). Hits
              // /api/v1/health/ready → the app runs a cheap `SELECT 1` (bounded ~2s in-app, < the 5s
              // timeoutSeconds here). So a cold-woken / mid-`migrate deploy` Postgres holds traffic
              // instead of crash-looping (staging review: stopped-Postgres). 3 consecutive failures
              // mark the replica not-ready; it recovers automatically once the DB answers.
              //
              // periodSeconds 5 (not 10): this probe is ALSO the graceful-shutdown drain signal
              // (slice 29) — on SIGTERM the app flips /health/ready to 503, and ACA must OBSERVE
              // not-ready (5s × 3 = 15s worst case) BEFORE app.close() fires at SHUTDOWN_GRACE_MS=20s,
              // else the drain is a no-op. At the old 10×3=30s the app would always close first.
              // Keeps the 3-failure tolerance for slice 27 (15s of DB-down before pausing traffic).
              type: 'Readiness'
              httpGet: { path: '/api/v1/health/ready', port: appPort }
              periodSeconds: 5
              failureThreshold: 3
              timeoutSeconds: 5
            }
          ]
        }
      ]
      scale: {
        // max 1 replica while rate-limit/SSO-state are in-memory; raising it requires REDIS_URL first
        // (spec staging-deploy §2 invariant: maxReplicas and "no REDIS_URL" must change together).
        minReplicas: 0 // scale-to-zero (cold start accepted for staging, spec §9)
        maxReplicas: 1
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
// workers — GATED (deployRunners). No ingress; KEDA scales on the 'runs' queue.
// Invokes @gilgamesh/kernel → chaos-proxy over internal gRPC.
// -----------------------------------------------------------------------------
resource workersApp 'Microsoft.App/containerApps@2024-03-01' = if (deployRunners) {
  name: 'workers'
  location: location
  tags: tags
  identity: identityBlock
  properties: {
    managedEnvironmentId: managedEnv.id
    configuration: {
      activeRevisionsMode: 'Single'
      registries: registries
      secrets: runnerSecrets
    }
    template: {
      containers: [
        {
          name: 'workers'
          image: workersImage
          resources: { cpu: json('0.5'), memory: '1Gi' }
          env: concat(runnerCommonEnv, [
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
// chaos-proxy — GATED (deployRunners). Internal gRPC ingress on :50051 (keystone §7).
// OWNER-DELIVERED image. Present while a Run is active, zero when idle.
// -----------------------------------------------------------------------------
resource chaosProxyApp 'Microsoft.App/containerApps@2024-03-01' = if (deployRunners) {
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
// plugin-playwright — GATED (deployRunners). Internal gRPC plugin server (keystone §7).
// -----------------------------------------------------------------------------
resource playwrightApp 'Microsoft.App/containerApps@2024-03-01' = if (deployRunners) {
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
// omnipizza — GATED (deployRunners). Sample System-Under-Test (keystone §7). Internal HTTP.
// -----------------------------------------------------------------------------
resource omnipizzaApp 'Microsoft.App/containerApps@2024-03-01' = if (deployRunners) {
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
@description('Public FQDN of the app (API + SPA).')
output appFqdn string = app.properties.configuration.ingress.fqdn
