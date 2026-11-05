import { formatName } from '@/lib/format';

export function UserList({ users }: { users: { id: number; name: string }[] }) {
  return <ul>{users.map((u) => <li key={u.id}>{formatName(u.name)}</li>)}</ul>;
}
