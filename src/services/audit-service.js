import { getDb } from '../database.js';

export async function logAction(userId, action, entityType, entityUid, details = '') {
  const db = getDb();
  await db('audit_log').insert({
    user_id: userId,
    action,
    entity_type: entityType,
    entity_uid: entityUid,
    details,
  });
}

export async function getAuditLog({ page = 1, limit = 50, userId, action, entityType } = {}) {
  const db = getDb();
  const offset = (page - 1) * limit;

  let query = db('audit_log as a')
    .leftJoin('users as u', 'a.user_id', 'u.id')
    .select('a.*', 'u.swc_name as user_name');

  let countQuery = db('audit_log as a');

  if (userId) {
    query = query.where('a.user_id', userId);
    countQuery = countQuery.where('a.user_id', userId);
  }
  if (action) {
    query = query.where('a.action', 'like', `%${action}%`);
    countQuery = countQuery.where('a.action', 'like', `%${action}%`);
  }
  if (entityType) {
    query = query.where('a.entity_type', entityType);
    countQuery = countQuery.where('a.entity_type', entityType);
  }

  const rows = await query.orderBy([{ column: 'a.created_at', order: 'desc' }, { column: 'a.id', order: 'desc' }]).limit(limit).offset(offset);
  const [{ total }] = await countQuery.count('* as total');

  return { rows, total, page, pages: Math.ceil(total / limit) };
}
