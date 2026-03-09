import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { apiClient } from '../../lib/api-client';

interface User {
  id: number;
  email: string;
  role: 'ADMIN' | 'USER';
  disabled: boolean;
}

type ApiError = Error & {
  response?: {
    status?: number;
    data?: {
      error?: string;
    };
  };
};

export default function AdminUsers() {
  const [users, setUsers] = useState<User[]>([]);
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const router = useRouter();

  const loadUsers = async () => {
    const response = await apiClient.get<User[]>('/api/admin/users');
    return response.data;
  };

  const fetchUsers = async () => {
    try {
      setUsers(await loadUsers());
    } catch (error) {
      const apiError = error as ApiError;
      if (apiError.response?.status === 403) {
        void router.push('/login');
        return;
      }
      setError('Failed to load users');
    }
  };

  useEffect(() => {
    let active = true;
    loadUsers()
      .then((nextUsers) => {
        if (active) {
          setUsers(nextUsers);
        }
      })
      .catch((error) => {
        const apiError = error as ApiError;
        if (apiError.response?.status === 403) {
          void router.push('/login');
          return;
        }
        setError('Failed to load users');
      });

    return () => {
      active = false;
    };
  }, [router]);

  const toggleRole = async (id: number, currentRole: string) => {
    const newRole = currentRole === 'ADMIN' ? 'USER' : 'ADMIN';
    try {
      await apiClient.patch(`/api/admin/users/${id}`, { role: newRole });
      await fetchUsers();
    } catch (error) {
      const apiError = error as ApiError;
      alert(apiError.response?.data?.error || 'Error updating role');
    }
  };

  const toggleDisabled = async (id: number, currentDisabled: boolean) => {
    try {
      await apiClient.patch(`/api/admin/users/${id}`, { disabled: !currentDisabled });
      await fetchUsers();
    } catch (error) {
      const apiError = error as ApiError;
      alert(apiError.response?.data?.error || 'Error updating disabled status');
    }
  };

  const filtered = users.filter(u => u.email.toLowerCase().includes(search.toLowerCase()));

  return (
    <div style={{ padding: '20px' }}>
      <h1>Admin Panel — Users</h1>
      {error && <p style={{ color: 'red' }}>{error}</p>}
      <input
        type="text"
        placeholder="Search by email"
        value={search}
        onChange={e => setSearch(e.target.value)}
        style={{ marginBottom: '20px', padding: '8px', width: '300px' }}
      />
      <table border={1} cellPadding={8} style={{ borderCollapse: 'collapse', width: '100%' }}>
        <thead>
          <tr>
            <th>ID</th>
            <th>Email</th>
            <th>Role</th>
            <th>Disabled</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {filtered.map(u => (
            <tr key={u.id}>
              <td>{u.id}</td>
              <td>{u.email}</td>
              <td>{u.role}</td>
              <td>{u.disabled ? 'Yes' : 'No'}</td>
              <td>
                <button onClick={() => toggleRole(u.id, u.role)} style={{ marginRight: 5 }}>
                  Toggle Role
                </button>
                <button onClick={() => toggleDisabled(u.id, u.disabled)}>
                  Toggle Disabled
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
