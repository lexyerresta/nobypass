import 'server-only';
import { db } from '@/lib/db';

export function getActiveUsers() {
  return db.user.findMany({ where: { active: true } });
}
