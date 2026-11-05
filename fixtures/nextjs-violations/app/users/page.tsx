import { UserList } from '@/components/user-list';
import { db } from '@/lib/db';

export default async function UsersPage() {
  // "Quick fix" from an AI agent: query straight from the page.
  const users = await db.user.findMany({ where: { active: true } });
  return <UserList users={users} />;
}
