import { AuditLog } from '../models/AuditLog.js';

/**
 * Append an immutable audit entry. Never throws — audit failures are logged,
 * not fatal, so a broken audit write cannot take down a live operation.
 */
export async function writeAudit({
  workflowId = null,
  actorId = null,
  actorName = '',
  role = '',
  action = '',
  entity = '',
  entityId = '',
  before = null,
  after = null,
} = {}) {
  try {
    await AuditLog.create({
      workflowId,
      actorId,
      actorName,
      role,
      action,
      entity,
      entityId,
      before,
      after,
    });
  } catch (err) {
    console.error('[audit] failed to write entry', err.message);
  }
}

/** Convenience: audit using the authenticated request's user. */
export function auditFor(req) {
  return (fields) =>
    writeAudit({
      actorId: req.user?._id,
      actorName: req.user?.name,
      role: req.user?.role,
      ...fields,
    });
}