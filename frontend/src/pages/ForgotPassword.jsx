import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom'';
import { Form, Input, Button, Alert, Card, Typography } from 'antd'';
import { MailOutlined, LockOutlined } from '@ant-design/icons'';
import { authService } from '../services/authService'';

const { Title } = Typography;

const ForgotPassword = () => {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const navigate = useNavigate();

  const onFinish = async (values) => {
    setLoading(true);
    setError('');
    setSuccess(false);

    try {
      const { email } = values;
      
      // Validate email format
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        throw new Error('Please enter a valid email address');
      }

      // Call password reset service
      await authService.forgotPassword(email);
      
      setSuccess(true);
      setError('');
      
    } catch (error) {
      console.error('Password reset error:', error);
      setError(error.message || 'Failed to reset password. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const onFinishFailed = (errorInfo) => {
    console.error('Failed:', errorInfo);
  };

  if (success) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="max-w-md w-full space-y-8">
          <div className="text-center">
            <Title level={2} className="text-blue-600">
              PORTAL Global
            </Title>
            <p className="mt-2 text-gray-600">
              Password reset request sent
            </p>
          </div>
          
          <Card className="p-6">
            <Alert
              message="Success"
              description="We've sent password reset instructions to your email address. Please check your inbox."
              type="success"
              showIcon
            />
            
            <div className="text-center mt-4">
              <Button
                type="link"
                onClick={() => navigate('/login')}
                className="text-blue-600"
              >
                Back to Login
              </Button>
            </div>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="max-w-md w-full space-y-8">
        <div className="text-center">
          <Title level={2} className="text-blue-600">
            PORTAL Global
          </Title>
          <p className="mt-2 text-gray-600">
            Reset your password
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
            name="forgot-password"
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
                Send Reset Instructions
              </Button>
            </Form.Item>
          </Form>

          <div className="text-center">
            <Button
              type="link"
              onClick={() => navigate('/login')}
              className="text-sm text-gray-600"
            >
              Back to Login
            </Button>
          </div>
        </Card>
      </div>
    </div>
  );
};

export default ForgotPassword;