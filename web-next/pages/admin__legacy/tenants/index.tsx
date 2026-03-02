import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { apiClient } from '../../../lib/api-client';

interface Tenant {
  id: number;
  name: string;
  slug: string;
}

export default function TenantsManagement() {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [newName, setNewName] = useState('');
  const [newSlug, setNewSlug] = useState('');
  const router = useRouter();

  useEffect(() => {
    fetchTenants();
  }, []);

  const fetchTenants = async () => {
    const res = await apiClient.get('/api/tenants');
    setTenants(res.data);
  };

  const createTenant = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiClient.post('/api/tenants', { name: newName, slug: newSlug });
      setNewName('');
      setNewSlug('');
      fetchTenants();
    } catch (err: any) {
      alert(err.response?.data?.error || 'Creation failed');
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
