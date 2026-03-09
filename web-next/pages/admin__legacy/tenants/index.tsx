import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { apiClient } from '../../../lib/api-client';

interface Tenant {
  id: number;
  name: string;
  slug: string;
}

type ApiError = Error & {
  response?: {
    data?: {
      error?: string;
    };
  };
};

export default function TenantsManagement() {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [newName, setNewName] = useState('');
  const [newSlug, setNewSlug] = useState('');
  const router = useRouter();

  const loadTenants = async () => {
    const response = await apiClient.get<Tenant[]>('/api/tenants');
    return response.data;
  };

  const fetchTenants = async () => {
    setTenants(await loadTenants());
  };

  useEffect(() => {
    let active = true;
    loadTenants().then((nextTenants) => {
      if (active) {
        setTenants(nextTenants);
      }
    });

    return () => {
      active = false;
    };
  }, []);

  const createTenant = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiClient.post('/api/tenants', { name: newName, slug: newSlug });
      setNewName('');
      setNewSlug('');
      await fetchTenants();
    } catch (error) {
      const apiError = error as ApiError;
      alert(apiError.response?.data?.error || 'Creation failed');
    }
  };

  const viewMembers = (tenantId: number) => {
    router.push(`/admin/tenants/${tenantId}/members`);
  };

  return (
    <div>
      <h1>Tenants Management</h1>
      <form onSubmit={createTenant}>
        <input type="text" placeholder="Tenant name" value={newName} onChange={e => setNewName(e.target.value)} required />
        <input type="text" placeholder="slug" value={newSlug} onChange={e => setNewSlug(e.target.value)} required />
        <button type="submit">Create Tenant</button>
      </form>
      <table>
        <thead>
          <tr><th>ID</th><th>Name</th><th>Slug</th><th>Actions</th></tr>
        </thead>
        <tbody>
          {tenants.map(t => (
            <tr key={t.id}>
              <td>{t.id}</td>
              <td>{t.name}</td>
              <td>{t.slug}</td>
              <td><button onClick={() => viewMembers(t.id)}>Members</button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
