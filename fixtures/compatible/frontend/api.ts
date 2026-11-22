interface User { id: number; name: string; avatar: string | null }
export async function getUser(): Promise<User> {
  const response = await fetch('/api/users/me');
  return response.json();
}
