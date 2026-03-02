import React from 'react';
import { useNavigate } from 'react-router-dom'';
import { Form, Input, Button, Alert, Card, Typography } from 'antd'';
import { MailOutlined, LockOutlined } from '@ant-design/icons'';
import { authService } from '../services/authService'';
import { useAuth } from '../hooks/useAuth'';

const { Title } = Typography;

const Login = () => {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();
  const { login } = useAuth();

  useEffect(() => {
    // Clear error on mount
    setError('');
  }, []);

  const onFinish = async (values) => {
    setLoading(true);
    setError('');

    try {
      const { email, password } = values;
      
      // Validate email format
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        throw new Error('Please enter a valid email address');
      }

      // Validate password length
      if (password.length < 6) {
        throw new Error('Password must be at least 6 characters long');
      }

      // Call authentication service
      const response = await authService.login(email, password);
      
      // Store user data
      login(response.user, response.token);
      
      // Redirect to intended page or dashboard
      const redirectPath = location.state?.from?.pathname || '/dashboard';
      navigate(redirectPath);
      
    } catch (error) {
      console.error('Login error:', error);
      setError(error.message || 'Login failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const onFinishFailed = (errorInfo) => {
    console.error('Failed:', errorInfo);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="max-w-md w-full space-y-8">
        <div className="text-center">
          <Title level={2} className="text-blue-600">
            PORTAL Global
          </Title>
          <p className="mt-2 text-gray-600">
            Sign in to your account
          </p>
        </div>
        
        {error && (
          <Alert
            message="Error"
            description={error}
            type="error"
            showIcon
            closable
            onClose={() => setError('')}
          />
        )}

        <Card className="p-6">
          <Form
            form={form}
            name="login"
            onFinish={onFinish}
            onFinishFailed={onFinishFailed}
            layout="vertical"
          >
            <Form.Item
              name="email"
              rules={[
                { required: true, message: 'Please input your email!' },
                { type: 'email', message: 'Please enter a valid email!' }
              ]}
            >
              <Input
                prefix={<MailOutlined className="text-gray-400" /%>}
                placeholder="Email"
                autoComplete="email"
                autoFocus
              />
            </Form.Item>

            <Form.Item
              name="password"
              rules={[
                { required: true, message: 'Please input your password!' },
                { min: 6, message: 'Password must be at least 6 characters long!' }
              ]}
            >
              <Input.Password
                prefix={<LockOutlined className="text-gray-400" /%>}
                placeholder="Password"
                autoComplete="current-password"
              />
            </Form.Item>

            <Form.Item>
              <Button
                type="primary"
                htmlType="submit"
                className="w-full"
                loading={loading}
                disabled={loading}
              >
                Sign In
              </Button>
            </Form.Item>
          </Form>

          <div className="text-center">
            <p className="text-sm text-gray-600">
              Don't have an account?{' '}
              <Button
                type="link"
                onClick={() => navigate('/register')}
                className="text-blue-600"
              >
                Register here
              </Button>
            </p>
          </div>
        </Card>

        <div className="text-center">
          <Button
            type="link"
            onClick={() => navigate('/forgot-password')}
            className="text-sm text-gray-600"
          >
            Forgot password?
          </Button>
        </div>
      </div>
    </div>
  );
};

export default Login;