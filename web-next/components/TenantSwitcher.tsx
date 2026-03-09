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
  const [currentTenant, setCurrentTenant] = useState<Tenant | null>(() => {
    if (typeof window === 'undefined') return null;
    const stored = localStorage.getItem('currentTenant');
    return stored ? JSON.parse(stored) as Tenant : null;
  });
  const router = useRouter();

  const fetchTenants = async () => {
    const response = await apiClient.get<Tenant[]>('/api/tenants');
    return response.data;
  };

  useEffect(() => {
    let active = true;
    fetchTenants()
      .then((nextTenants) => {
        if (active) {
          setTenants(nextTenants);
        }
      })
      .catch((error) => {
        console.error('Failed to load tenants', error);
      });

    return () => {
      active = false;
    };
  }, []);

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
        const tenant = tenants.find((item) => item.id === Number.parseInt(e.target.value, 10));
        if (tenant) switchTenant(tenant);
      }}
      style={{ marginLeft: '10px' }}
    >
        {tenants.map((tenant) => (
          <option key={tenant.id} value={tenant.id}>
            {tenant.name} ({tenant.role})
          </option>
        ))}
    </select>
  );
}
