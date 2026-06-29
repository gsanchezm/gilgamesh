// =============================================================================
// Gilgamesh — Service Bus module (DESIGN ONLY — never deployed)
// -----------------------------------------------------------------------------
// Cloud adapter for the run-queue + keystone §5 EventBus { publish(topic);
// subscribe(topic) }. In LOCAL docker-compose the broker is Redis + BullMQ
// (keystone §4 apps/workers); in Azure QA the SAME port resolves to Service Bus.
// See azure-environments.md "Message broker — port seam" + deviations note.
//
// Topology:
//   - queue  'runs'        — enqueued Run jobs (keystone §2 Run); KEDA scales workers
//                            + runners on this queue's depth (scale-to-zero when empty).
//   - topic  'run-events'  — RunEvent fan-out (keystone §5 RunEvent: NODE_STATE / LOG /
//                            ARTIFACT / SUMMARY) → API SSE /runs/{id}/events subscribers.
//
// SKU: 'Standard' is required for TOPICS (Basic = queues only) and is a flat ~modest
//      monthly fee with no per-replica idle compute. Parameterized so QA can drop to
//      'Basic' if EventBus topics are implemented off-broker (e.g. Postgres NOTIFY).
//
// Security: connection strings are NOT emitted; apps authenticate with the workload
//           Managed Identity (Azure Service Bus Data Owner). No SAS keys in env.
// =============================================================================

@description('Azure region.')
param location string = resourceGroup().location

@description('Service Bus namespace name (6-50 chars, globally unique).')
param namespaceName string

@description('Tags applied to every resource.')
param tags object = {}

@description('SKU. Standard required for topics/subscriptions (EventBus). Basic = queues only.')
@allowed([ 'Basic', 'Standard', 'Premium' ])
param skuName string = 'Standard'

@description('Run-queue name — enqueued Run jobs; KEDA scaler trigger for workers/runners.')
param runQueueName string = 'runs'

@description('RunEvent topic name — live NODE_STATE/LOG/ARTIFACT/SUMMARY fan-out to SSE.')
param runEventsTopicName string = 'run-events'

@description('Principal (objectId) of the workload identity (send/receive + KEDA scaler auth).')
param workloadIdentityPrincipalId string

@description('Allow public network access (firewall-gated). False with private endpoints (Premium only).')
param allowPublicNetworkAccess bool = true

// Built-in role: "Azure Service Bus Data Owner" — send + receive + manage subscriptions.
var serviceBusDataOwnerRoleId = '090c5cfd-751d-490a-894a-3ce6f1109419'

resource namespace 'Microsoft.ServiceBus/namespaces@2022-10-01-preview' = {
  name: namespaceName
  location: location
  tags: tags
  sku: {
    name: skuName
    tier: skuName
  }
  properties: {
    minimumTlsVersion: '1.2'
    publicNetworkAccess: allowPublicNetworkAccess ? 'Enabled' : 'Disabled'
    // disableLocalAuth: forces Entra-only auth (no SAS keys). ASVS L2 hardening.
    disableLocalAuth: true
  }
}

resource runQueue 'Microsoft.ServiceBus/namespaces/queues@2022-10-01-preview' = {
  parent: namespace
  name: runQueueName
  properties: {
    lockDuration: 'PT5M'            // long-running run dispatch
    maxDeliveryCount: 5
    deadLetteringOnMessageExpiration: true
    defaultMessageTimeToLive: 'P1D'
    enablePartitioning: false
  }
}

// Topics require Standard tier. Guarded so a Basic-tier QA deploy still validates.
resource runEventsTopic 'Microsoft.ServiceBus/namespaces/topics@2022-10-01-preview' = if (skuName != 'Basic') {
  parent: namespace
  name: runEventsTopicName
  properties: {
    defaultMessageTimeToLive: 'PT1H' // ephemeral live events
    enablePartitioning: false
  }
}

// Subscription consumed by the API to stream RunEvent over SSE (/runs/{id}/events).
resource apiEventsSubscription 'Microsoft.ServiceBus/namespaces/topics/subscriptions@2022-10-01-preview' = if (skuName != 'Basic') {
  parent: runEventsTopic
  name: 'api-sse'
  properties: {
    lockDuration: 'PT1M'
    maxDeliveryCount: 10
    defaultMessageTimeToLive: 'PT1H'
  }
}

// Grant the workload identity data-plane access to the namespace.
resource sbRoleAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(namespace.id, workloadIdentityPrincipalId, serviceBusDataOwnerRoleId)
  scope: namespace
  properties: {
    principalId: workloadIdentityPrincipalId
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', serviceBusDataOwnerRoleId)
    principalType: 'ServicePrincipal'
  }
}

@description('Service Bus namespace resource ID.')
output namespaceId string = namespace.id
@description('Service Bus namespace name.')
output namespaceName string = namespace.name
@description('Fully-qualified namespace host (for Entra-auth SDK clients + KEDA scaler).')
output namespaceFqdn string = '${namespace.name}.servicebus.windows.net'
@description('Run-queue name (KEDA scaler trigger).')
output runQueueName string = runQueueName
@description('RunEvent topic name.')
output runEventsTopicName string = runEventsTopicName
