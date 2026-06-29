import { ApplicationError } from '../errors';
import type { ProjectRecord, Role } from '../ports/records';
import type { MembershipRepository, ProjectRepository } from '../ports/repositories';

/**
 * Resolves a project and the caller's role in its org, enforcing tenant isolation.
 * A non-member gets NOT_FOUND (never 403) so project existence is not leaked across tenants.
 * When `allowedRoles` is given, an insufficient in-tenant role gets FORBIDDEN.
 */
export async function requireProjectAccess(
  deps: { projects: ProjectRepository; memberships: MembershipRepository },
  userId: string,
  projectId: string,
  allowedRoles?: Role[],
): Promise<{ project: ProjectRecord; role: Role }> {
  const project = await deps.projects.findById(projectId);
  if (!project) throw new ApplicationError('NOT_FOUND', 'Project not found.');

  const role = await deps.memberships.findRole(project.orgId, userId);
  if (!role) throw new ApplicationError('NOT_FOUND', 'Project not found.');

  if (allowedRoles && !allowedRoles.includes(role)) {
    throw new ApplicationError('FORBIDDEN', 'You do not have permission to perform this action.');
  }
  return { project, role };
}
