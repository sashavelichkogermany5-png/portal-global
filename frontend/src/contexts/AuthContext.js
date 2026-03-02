import React, { createContext, useContext, useReducer, useEffect } from 'react';
import api from '../lib/api';
import { toast } from './Toast';

const AuthContext = createContext();

const initialState = {
  user: null,
  token: localStorage.getItem('token') || null,
  loading: true,
  error: null
};

const extractToken = (payload) => {
  if (!payload) return null;
  return (
    payload.token ||
    payload.accessToken ||
    payload.access_token ||
    payload.jwt ||
    payload.data?.token ||
    payload.data?.accessToken ||
    payload.data?.access_token ||
    payload.data?.jwt ||
    null
  );
};

const extractUser = (payload) => payload?.user || payload?.data?.user || null;

const authReducer = (state, action) => {
  switch (action.type) {
    case 'LOGIN_START':
      return { ...state, loading: true, error: null };
    case 'LOGIN_SUCCESS':
      return { 
        ...state, 
        user: action.payload.user, 
        token: action.payload.token, 
        loading: false, 
        error: null 
      };
    case 'LOGIN_FAILURE':
      return { ...state, loading: false, error: action.payload.error };
    case 'LOGOUT':
      return { ...state, user: null, token: null, loading: false };
    case 'UPDATE_USER':
      return { ...state, user: action.payload.user };
    case 'CLEAR_ERROR':
      return { ...state, error: null };
    default:
      return state;
  }
};

export const AuthProvider = ({ children }) => {
  const [state, dispatch] = useReducer(authReducer, initialState);

  useEffect(() => {
    const initializeAuth = async () => {
      try {
        if (state.token) {
          // Verify token
          const response = await api.get('/users/me');
          dispatch({ type: 'LOGIN_SUCCESS', payload: { user: response.data.user, token: state.token } });
        } else {
          dispatch({ type: 'LOGOUT' });
        }
      } catch (error) {
        dispatch({ type: 'LOGOUT' });
      } finally {
        dispatch({ type: 'CLEAR_ERROR' });
      }
    };

    initializeAuth();
  }, []);

  const login = async (email, password) => {
    dispatch({ type: 'LOGIN_START' });
    try {
      const response = await api.post('/auth/login', { email, password });
      const token = extractToken(response.data);
      const user = extractUser(response.data);

      if (!token) {
        throw new Error('Token missing in response');
      }
      
      localStorage.setItem('token', token);
      dispatch({ type: 'LOGIN_SUCCESS', payload: { token, user } });
      
      toast.success('Login successful!');
      
      return { success: true };
    } catch (error) {
      const errorMessage = error.response?.data?.message || 'Login failed';
      dispatch({ type: 'LOGIN_FAILURE', payload: { error: errorMessage } });
      toast.error(errorMessage);
      return { success: false, error: errorMessage };
    }
  };

  const register = async (email, password, firstName, lastName) => {
    dispatch({ type: 'LOGIN_START' });
    try {
      const response = await api.post('/auth/register', { email, password, firstName, lastName });
      const token = extractToken(response.data);
      const user = extractUser(response.data);

      if (!token) {
        throw new Error('Token missing in response');
      }
      
      localStorage.setItem('token', token);
      dispatch({ type: 'LOGIN_SUCCESS', payload: { token, user } });
      
      toast.success('Registration successful!');
      
      return { success: true };
    } catch (error) {
      const errorMessage = error.response?.data?.message || 'Registration failed';
      dispatch({ type: 'LOGIN_FAILURE', payload: { error: errorMessage } });
      toast.error(errorMessage);
      return { success: false, error: errorMessage };
    }
  };

  const logout = () => {
    localStorage.removeItem('token');
    dispatch({ type: 'LOGOUT' });
    toast.success('Logged out successfully!');
  };

  const updateUser = async (userData) => {
    try {
      const response = await api.put('/users/profile', userData);
      dispatch({ type: 'UPDATE_USER', payload: { user: response.data.user } });
      toast.success('Profile updated successfully!');
      return { success: true };
    } catch (error) {
      const errorMessage = error.response?.data?.message || 'Failed to update profile';
      toast.error(errorMessage);
      return { success: false, error: errorMessage };
    }
  };

  const value = {
    user: state.user,
    token: state.token,
    loading: state.loading,
    error: state.error,
    login,
    register,
    logout,
    updateUser
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
