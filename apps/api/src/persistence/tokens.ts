/** DI tokens for the application ports (repositories + infra adapters). */
export const TOKENS = {
  Users: 'UserRepository',
  Orgs: 'OrgRepository',
  Memberships: 'MembershipRepository',
  Sessions: 'SessionRepository',
  Projects: 'ProjectRepository',
  Slices: 'SliceRepository',
  Agents: 'AgentRepository',
  ToolBindings: 'ToolBindingRepository',
  Subscriptions: 'SubscriptionRepository',
  Audit: 'AuditLogRepository',
  UnitOfWork: 'UnitOfWork',
  Hasher: 'PasswordHasher',
  Ids: 'IdGenerator',
  Tokens: 'TokenGenerator',
  Clock: 'Clock',
} as const;
