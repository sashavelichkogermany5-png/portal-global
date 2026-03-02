import React, { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Form, Input, Button, Alert, Card, Typography } from 'antd';
import { MailOutlined, LockOutlined, UserOutlined } from '@ant-design/icons';
import { authService } from '../services/authService';
import { useAuth } from '../hooks/useAuth';

const { Title } = Typography;

const Register = () => {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();
  const { login } = useAuth();

  const onFinish = async (values) => {
    setLoading(true);
    setError('');

    try {
      const { email, password, firstName, lastName, role } = values;
      
      // Validate input
      if (!firstName || !lastName) {
        throw new Error('Please enter your first and last name');
      }

      // Validate email format
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        throw new Error('Please enter a valid email address');
      }

      // Validate password
      if (password.length < 6) {
        throw new Error('Password must be at least 6 characters long');
      }

      // Call registration service
      const response = await authService.register({
        email,
        password,
        firstName,
        lastName,
        role: role || 'client'
      });
      
      // Store user data
      login(response.user, response.token);
      
      // Redirect to dashboard
      navigate('/dashboard');
      
    } catch (error) {
      console.error('Registration error:', error);
      setError(error.message || 'Registration failed. Please try again.');
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
            Create your account
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
            name="register"
            onFinish={onFinish}
            onFinishFailed={onFinishFailed}
            layout="vertical"
          >
            <Form.Item
              name="firstName"
              rules={[
                { required: true, message: 'Please input your first name!' },
                { min: 2, message: 'First name must be at least 2 characters long!' }
              ]}
            >
              <Input
                prefix={<UserOutlined className="text-gray-400" /%>}
                placeholder="First Name"
                autoComplete="given-name"
              />
            </Form.Item>

            <Form.Item
              name="lastName"
              rules={[
                { required: true, message: 'Please input your last name!' },
                { min: 2, message: 'Last name must be at least 2 characters long!' }
              ]}
            >
              <Input
                prefix={<UserOutlined className="text-gray-400" /%>}
                placeholder="Last Name"
                autoComplete="family-name"
              />
            </Form.Item>

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
                autoComplete="new-password"
              />
            </Form.Item>

            <Form.Item
              name="confirmPassword"
              dependencies={["password"]}
              rules={[
                {
                  required: true,
                  message: 'Please confirm your password!'
                },
                ({
                  getFieldValue
                }) => ({
                  validator(rule, value) {
                    if (!value || getFieldValue('password') === value) {
                      return Promise.resolve();
                    }
                    return Promise.reject('The two passwords that you entered do not match!');
                  }
                })
              ]}
            >
              <Input.Password
                prefix={<LockOutlined className="text-gray-400" /%>}
                placeholder="Confirm Password"
                autoComplete="new-password"
              />
            </Form.Item>

            <Form.Item
              name="role"
              rules={[{ required: true, message: 'Please select your role!' }]}
            >
              <Input.Group compact>
                <Form.Item
                  noStyle
                  name="role"
                  rules={[{ required: true }]}
                >
                  <select className="w-full p-2 border rounded-md">
                    <option value="client">Client</option>
                    <option value="worker">Worker</option>
                    <option value="owner">Owner</option>
                  </select>
                </Form.Item>
              </Input.Group>
            </Form.Item>

            <Form.Item>
              <Button
                type="primary"
                htmlType="submit"
                className="w-full"
                loading={loading}
                disabled={loading}
              >
                Create Account
              </Button>
            </Form.Item>
          </Form>

          <div className="text-center">
            <p className="text-sm text-gray-600">
              Already have an account?{' '}
              <Button
                type="link"
                onClick={() => navigate('/login')}
                className="text-blue-600"
              >
                Sign in here
              </Button>
            </p>
          </div>
        </Card>
      </div>
    </div>
  );
};

export default Register;