import React from 'react';
import { Form, Input, Button, Alert, Card, Typography } from 'antd';
import { MailOutlined, LockOutlined } from '@ant-design/icons';
import { authService } from '../services/authService';
import { useAuth } from '../hooks/useAuth';

const { Title } = Typography;

const ResetPassword = () => {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const { login } = useAuth();

  const onFinish = async (values) => {
    setLoading(true);
    setError('');
    setSuccess(false);

    try {
      const { token, password } = values;
      
      // Validate password
      if (password.length < 6) {
        throw new Error('Password must be at least 6 characters long');
      }

      // Call password reset service
      await authService.resetPassword(token, password);
      
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
              Password reset successful
            </p>
          </div>
          
          <Card className="p-6">
            <Alert
              message="Success"
              description="Your password has been successfully reset. You can now sign in with your new password."
              type="success"
              showIcon
            />
            
            <div className="text-center mt-4">
              <Button
                type="primary"
                onClick={() => navigate('/login')}
              >
                Sign In
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
            name="reset-password"
            onFinish={onFinish}
            onFinishFailed={onFinishFailed}
            layout="vertical"
          >
            <Form.Item
              name="token"
              rules={[
                { required: true, message: 'Please input the reset token!' }
              ]}
            >
              <Input
                prefix={<LockOutlined className="text-gray-400" /%>}
                placeholder="Reset Token"
                autoComplete="off"
              />
            </Form.Item>

            <Form.Item
              name="password"
              rules={[
                { required: true, message: 'Please input your new password!' },
                { min: 6, message: 'Password must be at least 6 characters long!' }
              ]}
            >
              <Input.Password
                prefix={<LockOutlined className="text-gray-400" /%>}
                placeholder="New Password"
                autoComplete="new-password"
              />
            </Form.Item>

            <Form.Item
              name="confirmPassword"
              dependencies={["password"]}
              rules={[
                {
                  required: true,
                  message: 'Please confirm your new password!'
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
                placeholder="Confirm New Password"
                autoComplete="new-password"
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
                Reset Password
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

export default ResetPassword;