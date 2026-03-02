import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import { ToastContainer } from './components/Toast';
import { Header } from './components/Header';
import { Dashboard } from './pages/Dashboard';
import { Projects } from './pages/Projects';
import { Tasks } from './pages/Tasks';
import { Users } from './pages/Users';
import { Login } from './pages/Login';
import { Register } from './pages/Register';
import { Profile } from './pages/Profile';
import { Settings } from './pages/Settings';
import { NotFound } from './pages/NotFound';
import { LoadingSpinner } from './components/LoadingSpinner';
import { useAuth } from './hooks/useAuth';

function App() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className='min-h-screen flex items-center justify-center bg-gray-50'>
        <LoadingSpinner />
      </div>
    );
  }

  return (
    <AuthProvider>
      <Router>
        {user ? (
          <div className='min-h-screen bg-gray-50'>
            <Header />
            <main className='p-6'>
              <Routes>
                <Route path='/' element={<Dashboard />} />
                <Route path='/projects' element={<Projects />} />
                <Route path='/projects/:id/tasks' element={<Tasks />} />
                <Route path='/users' element={<Users />} />
                <Route path='/profile' element={<Profile />} />
                <Route path='/settings' element={<Settings />} />
                <Route path='/*' element={<NotFound />} />
              </Routes>
            </main>
            <ToastContainer />
          </div>
        ) : (
          <div className='min-h-screen flex items-center justify-center bg-gray-50'>
            <Routes>
              <Route path='/login' element={<Login />} />
              <Route path='/register' element={<Register />} />
              <Route path='/*' element={<Navigate to='/login' />} />
            </Routes>
          </div>
        )}
      </Router>
    </AuthProvider>
  );
}

export default App;
