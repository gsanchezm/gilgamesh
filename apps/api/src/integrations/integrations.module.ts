import {
  type AuditLogRepository,
  type BrainKeyVerifier,
  type Clock,
  ConnectIntegration,
  DisconnectIntegration,
  type FeatureRepository,
  type IdGenerator,
  ImportRepoFeatures,
  type IntegrationRepository,
  ListIntegrations,
  type MembershipRepository,
  type ProjectRepository,
  type RepoProvider,
  type ScenarioRepository,
  type SecretVault,
  type UnitOfWork,
} from '@gilgamesh/application';
import { Module, type Provider } from '@nestjs/common';
import { TOKENS } from '../persistence/tokens';
import { OrgIntegrationsController, ProjectRepoController } from './integrations.controller';

const T = TOKENS;

// Connect/Disconnect/List share the same IntegrationDeps bundle (S9 adds the AI-key verifier).
const intInject = [T.Integrations, T.Memberships, T.RepoProvider, T.BrainKeys, T.SecretVault, T.Audit, T.Ids, T.Clock];
const intDeps = (
  integrations: IntegrationRepository,
  memberships: MembershipRepository,
  repoProvider: RepoProvider,
  brainKeys: BrainKeyVerifier,
  vault: SecretVault,
  audit: AuditLogRepository,
  ids: IdGenerator,
  clock: Clock,
) => ({ integrations, memberships, repoProvider, brainKeys, vault, audit, ids, clock });

const providers: Provider[] = [
  { provide: ListIntegrations, useFactory: (...a: Parameters<typeof intDeps>) => new ListIntegrations(intDeps(...a)), inject: intInject },
  { provide: ConnectIntegration, useFactory: (...a: Parameters<typeof intDeps>) => new ConnectIntegration(intDeps(...a)), inject: intInject },
  { provide: DisconnectIntegration, useFactory: (...a: Parameters<typeof intDeps>) => new DisconnectIntegration(intDeps(...a)), inject: intInject },
  {
    provide: ImportRepoFeatures,
    useFactory: (
      uow: UnitOfWork,
      integrations: IntegrationRepository,
      repoProvider: RepoProvider,
      features: FeatureRepository,
      scenarios: ScenarioRepository,
      projects: ProjectRepository,
      memberships: MembershipRepository,
      audit: AuditLogRepository,
      ids: IdGenerator,
      clock: Clock,
    ) => new ImportRepoFeatures({ uow, integrations, repoProvider, features, scenarios, projects, memberships, audit, ids, clock }),
    inject: [T.UnitOfWork, T.Integrations, T.RepoProvider, T.Features, T.Scenarios, T.Projects, T.Memberships, T.Audit, T.Ids, T.Clock],
  },
];

@Module({
  controllers: [OrgIntegrationsController, ProjectRepoController],
  providers,
})
export class IntegrationsModule {}
