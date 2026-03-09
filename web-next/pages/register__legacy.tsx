import { useState } from 'react';
import { useRouter } from 'next/router';
import { apiClient } from '../lib/api-client';

type ApiError = Error & {
  response?: {
    data?: {
      error?: string;
    };
  };
};

export default function Register() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiClient.post('/api/auth/register', { email, password });
      await router.push('/login?registered=1');
    } catch (error) {
      const apiError = error as ApiError;
      setError(apiError.response?.data?.error || 'Registration failed');
    }
  };

  return (
    <form onSubmit={handleSubmit} style={{ maxWidth: 400, margin: '50px auto' }}>
      <h1>Register</h1>
      {error && <p style={{ color: 'red' }}>{error}</p>}
      <div>
        <input
          type="email"
          placeholder="Email"
          value={email}
          onChange={e => setEmail(e.target.value)}
          required
          style={{ width: '100%', padding: 8, marginBottom: 10 }}
        />
      </div>
      <div>
        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={e => setPassword(e.target.value)}
          required
          style={{ width: '100%', padding: 8, marginBottom: 10 }}
        />
      </div>
      <button type="submit" style={{ padding: '8px 16px' }}>Register</button>
      <p style={{ marginTop: 10 }}>
        Already have an account? <a href="/login">Login</a>
      </p>
    </form>
  );
}
