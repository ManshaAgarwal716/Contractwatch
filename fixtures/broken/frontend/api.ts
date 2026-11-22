interface User { id: string; name: string; avatar: string; email: string }
interface CreateUserPayload { name: string }
const payload: CreateUserPayload = { name: 'Ada' };
const user = fetch('/api/users/me') as Promise<User>;
fetch('/api/users/missing');
fetch('/api/users', { method: 'POST', body: JSON.stringify(payload) });
