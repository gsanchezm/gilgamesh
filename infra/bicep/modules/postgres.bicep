// =============================================================================
// Gilgamesh — PostgreSQL Flexible Server module (DESIGN ONLY — never deployed)
// -----------------------------------------------------------------------------
// Backs every keystone §2 entity (Org, User, Project, Run, Artifact metadata, ...)
// and keystone §2 KnowledgeChunk.embedding vector(1536) via the *pgvector* extension.
// Row-level tenant isolation by orgId is enforced in the APPLICATION layer (every
// query carries orgId — keystone §0); infra simply provides a single locked-down DB.
//
// Cost posture (single small QA env, no prod):
//   - SKU = Burstable B1ms (1 vCPU / 2 GiB) — cheapest tier that runs Postgres 16.
//   - 32 GiB storage, 7-day backups, NO high-availability, NO read replica.
//   - DOMINANT idle cost: Flexible Server has NO scale-to-zero. STOP the server when
//     idle (owner action / scheduled automation) — see azure-environments.md cost section.
//
// Security:
//   - Admin password is a @secure() param; the deploy stores it in Key Vault and
//     Container Apps consume it as a Key Vault reference (never a plaintext env var).
//   - Entra-ID (AAD) authentication can be enabled for password-less app access (ASVS L2).
//   - Public access default Disabled when private networking is on; otherwise firewall-gated.
// =============================================================================

@description('Azure region.')
param location string = resourceGroup().location

@description('Postgres Flexible Server name (3-63 chars, lowercase).')
param serverName string

@description('Tags applied to every resource.')
param tags object = {}

@description('Initial database name for the Gilgamesh platform.')
param databaseName string = 'gilgamesh'

@description('Administrator login (local auth). Prefer Entra-ID auth for app access.')
param administratorLogin string = 'gilgamesh_admin'

@description('Administrator password. Supplied at deploy as a secure value and copied into Key Vault.')
@secure()
param administratorLoginPassword string

@description('Postgres engine version.')
@allowed([ '15', '16' ])
param postgresVersion string = '16'

@description('Compute SKU. Burstable B1ms is the QA cost-min default.')
param skuName string = 'Standard_B1ms'

@description('Compute tier.')
@allowed([ 'Burstable', 'GeneralPurpose', 'MemoryOptimized' ])
param skuTier string = 'Burstable'

@description('Provisioned storage in GiB.')
param storageSizeGB int = 32

@description('Backup retention (days).')
@minValue(7)
@maxValue(35)
param backupRetentionDays int = 7

@description('Enable public network access. False when delegated-subnet/private networking is used.')
param allowPublicNetworkAccess bool = true

@description('Optional delegated subnet resource ID for VNet-integrated (private) deployment. Empty = public/firewall mode.')
param delegatedSubnetId string = ''

@description('Optional private DNS zone resource ID (privatelink.postgres.database.azure.com) for VNet mode.')
param privateDnsZoneId string = ''

@description('Enable Entra-ID (AAD) authentication alongside password auth.')
param enableEntraAuth bool = true

var useVnet = !empty(delegatedSubnetId)

resource postgres 'Microsoft.DBforPostgreSQL/flexibleServers@2024-08-01' = {
  name: serverName
  location: location
  tags: tags
  sku: {
    name: skuName
    tier: skuTier
  }
  properties: {
    version: postgresVersion
    administratorLogin: administratorLogin
    administratorLoginPassword: administratorLoginPassword
    authConfig: {
      activeDirectoryAuth: enableEntraAuth ? 'Enabled' : 'Disabled'
      passwordAuth: 'Enabled'
      tenantId: subscription().tenantId
    }
    storage: {
      storageSizeGB: storageSizeGB
      autoGrow: 'Enabled'
    }
    backup: {
      backupRetentionDays: backupRetentionDays
      geoRedundantBackup: 'Disabled' // QA: no geo-redundancy (cost).
    }
    highAvailability: {
      mode: 'Disabled' // QA: single node (cost).
    }
    // VNet-integrated (private) mode: no public endpoint, traffic stays on the subnet.
    network: useVnet ? {
      delegatedSubnetResourceId: delegatedSubnetId
      privateDnsZoneArmResourceId: privateDnsZoneId
      publicNetworkAccess: 'Disabled'
    } : {
      publicNetworkAccess: allowPublicNetworkAccess ? 'Enabled' : 'Disabled'
    }
  }
}

// Application database.
resource db 'Microsoft.DBforPostgreSQL/flexibleServers/databases@2024-08-01' = {
  parent: postgres
  name: databaseName
  properties: {
    charset: 'UTF8'
    collation: 'en_US.utf8'
  }
}

// Allowlist pgvector (and common extensions) so the app can `CREATE EXTENSION vector`.
// azure.extensions is a server parameter; vector backs KnowledgeChunk.embedding vector(1536).
resource extensionsAllowlist 'Microsoft.DBforPostgreSQL/flexibleServers/configurations@2024-08-01' = {
  parent: postgres
  name: 'azure.extensions'
  properties: {
    value: 'VECTOR,PG_TRGM,UUID-OSSP'
    source: 'user-override'
  }
}

// Public/firewall mode only: allow other Azure services (Container Apps egress) to connect.
// 0.0.0.0 start+end is the Azure-internal "AllowAllAzureServices" rule, NOT the public internet.
resource allowAzureServices 'Microsoft.DBforPostgreSQL/flexibleServers/firewallRules@2024-08-01' = if (!useVnet && allowPublicNetworkAccess) {
  parent: postgres
  name: 'AllowAllAzureServicesAndResources'
  properties: {
    startIpAddress: '0.0.0.0'
    endIpAddress: '0.0.0.0'
  }
}

@description('Fully-qualified domain name of the Postgres server.')
output fqdn string = postgres.properties.fullyQualifiedDomainName
@description('Resource ID of the Postgres server.')
output serverId string = postgres.id
@description('Application database name.')
output databaseName string = databaseName
@description('Administrator login name.')
output administratorLogin string = administratorLogin
