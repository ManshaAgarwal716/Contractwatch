interface User { id: string; name: string; avatar: string; email: string }
interface CreateUserPayload { name: string }
const payload: CreateUserPayload = { name: 'Ada' };
// Valid request: the response contract is intentionally incompatible.
const user = fetch('/api/users/me') as Promise<User>;
// No backend route.
fetch('/api/users/missing');
// The route exists as GET only.
fetch('/api/users/list', { method: 'POST' });
// Backend requires email too.
fetch('/api/users', { method: 'POST', body: JSON.stringify(payload) });
