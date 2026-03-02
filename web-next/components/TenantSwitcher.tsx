import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { apiClient } from '../lib/api-client';

interface Tenant {
  id: number;
  name: string;
  slug: string;
  role?: string;
}

export default function TenantSwitcher() {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [currentTenant, setCurrentTenant] = useState<Tenant | null>(null);
  const router = useRouter();

  useEffect(() => {
    fetchTenants();
    const stored = localStorage.getItem('currentTenant');
    if (stored) setCurrentTenant(JSON.parse(stored));
  }, []);

  const fetchTenants = async () => {
    try {
      const res = await apiClient.get('/api/tenants');
      setTenants(res.data);
    } catch (err) {
      console.error('Failed to load tenants', err);
    }
  };

  const switchTenant = (tenant: Tenant) => {
    setCurrentTenant(tenant);
    localStorage.setItem('currentTenant', JSON.stringify(tenant));
    router.reload();
  };

  if (tenants.length <= 1) return null;

  return (
    <select
      value={currentTenant?.id || ''}
      onChange={(e) => {
        const tenant = tenants.find(t => t.id === parseInt(e.target.value));
        if (tenant) switchTenant(tenant);
      }}
      style={{ marginLeft: '10px' }}
    >
      {tenants.map(t => (
        <option key={t.id} value={t.id}>
          {t.name} ({t.role})
        </option>
      ))}
    </select>
  );
}
