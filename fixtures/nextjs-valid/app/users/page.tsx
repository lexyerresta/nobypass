import { UserList } from '@/components/user-list';
import { getActiveUsers } from '@/data/users';

export default async function UsersPage() {
  return <UserList users={await getActiveUsers()} />;
}
