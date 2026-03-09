const API_BASE = 'http://localhost:3000';
const API_BASE_URL = API_BASE;

const Portal = {
  token: localStorage.getItem('portal_token'),
  
  theme: {
    get() {
      return localStorage.getItem('portal_theme') || 'dark';
    },
    set(theme) {
      localStorage.setItem('portal_theme', theme);
      document.documentElement.setAttribute('data-theme', theme);
      this.savePreference(theme);
    },
    toggle() {
      const current = this.get();
      const next = current === 'dark' ? 'light' : 'dark';
      this.set(next);
      return next;
    },
    init() {
      const saved = this.get();
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      const theme = saved || (prefersDark ? 'dark' : 'light');
      document.documentElement.setAttribute('data-theme', theme);
    },
    savePreference(theme) {
      if (navigator.sendBeacon) {
        navigator.sendBeacon('/api/preferences', JSON.stringify({ theme }));
      }
    }
  },

  api: {
    async request(endpoint, options = {}) {
      const url = `${API_BASE_URL}${endpoint}`;
      const headers = {
        'Content-Type': 'application/json',
        ...options.headers
      };

      if (Portal.token) {
        headers['Authorization'] = `Bearer ${Portal.token}`;
      }

      try {
        const response = await fetch(url, {
          ...options,
          headers
        });

        const data = await response.json();

        if (!response.ok) {
          if (response.status === 401) {
            Portal.auth.logout();
            throw new Error('Session expired');
          }
          throw new Error(data.message || 'Request failed');
        }

        return data;
      } catch (error) {
        console.error('API Error:', error);
        throw error;
      }
    },

    get(endpoint) {
      return this.request(endpoint, { method: 'GET' });
    },

    post(endpoint, body) {
      return this.request(endpoint, {
        method: 'POST',
        body: JSON.stringify(body)
      });
    },

    put(endpoint, body) {
      return this.request(endpoint, {
        method: 'PUT',
        body: JSON.stringify(body)
      });
    },

    delete(endpoint) {
      return this.request(endpoint, { method: 'DELETE' });
    }
  },

  auth: {
    async login(email, password) {
      const result = await Portal.api.post('/api/auth/login', { email, password });
      if (result.token || result.accessToken) {
        const token = result.token || result.accessToken;
        localStorage.setItem('portal_token', token);
        Portal.token = token;
        localStorage.setItem('portal_user', JSON.stringify(result.user));
        return result;
      }
      throw new Error(result.message || 'Login failed');
    },

    async register(data) {
      const result = await Portal.api.post('/api/auth/register', data);
      if (result.token || result.accessToken) {
        const token = result.token || result.accessToken;
        localStorage.setItem('portal_token', token);
        Portal.token = token;
        localStorage.setItem('portal_user', JSON.stringify(result.user));
        return result;
      }
      throw new Error(result.message || 'Registration failed');
    },

    logout() {
      localStorage.removeItem('portal_token');
      localStorage.removeItem('portal_user');
      Portal.token = null;
      window.location.href = '/';
    },

    getUser() {
      const user = localStorage.getItem('portal_user');
      return user ? JSON.parse(user) : null;
    },

    isLoggedIn() {
      return !!Portal.token;
    }
  },

  projects: {
    async list(params = {}) {
      const query = new URLSearchParams(params).toString();
      const endpoint = `/api/projects${query ? '?' + query : ''}`;
      return Portal.api.get(endpoint);
    },

    async get(id) {
      return Portal.api.get(`/api/projects/${id}`);
    },

    async create(data) {
      return Portal.api.post('/api/projects', data);
    },

    async update(id, data) {
      return Portal.api.put(`/api/projects/${id}`, data);
    },

    async delete(id) {
      return Portal.api.delete(`/api/projects/${id}`);
    },

    async analyze(id) {
      return Portal.api.get(`/api/projects/${id}/analyze`);
    }
  },

  toast: {
    container: null,
    init() {
      if (!this.container) {
        this.container = document.createElement('div');
        this.container.className = 'toast-container';
        document.body.appendChild(this.container);
      }
    },
    show(options) {
      this.init();
      const { title, message, type = 'info', duration = 5000 } = options;
      
      const toast = document.createElement('div');
      toast.className = `toast toast-${type}`;
      
      const icons = {
        success: '✓',
        error: '✕',
        warning: '⚠',
        info: 'ℹ'
      };
      
      toast.innerHTML = `
        <span class="toast-icon">${icons[type] || icons.info}</span>
        <div class="toast-content">
          ${title ? `<div class="toast-title">${title}</div>` : ''}
          ${message ? `<div class="toast-message">${message}</div>` : ''}
        </div>
        <button class="toast-close">×</button>
      `;
      
      toast.querySelector('.toast-close').onclick = () => this.remove(toast);
      this.container.appendChild(toast);
      
      if (duration > 0) {
        setTimeout(() => this.remove(toast), duration);
      }
      
      return toast;
    },
    remove(toast) {
      if (!toast || !toast.parentNode) return;
      toast.classList.add('toast-exit');
      setTimeout(() => toast.remove(), 300);
    },
    success(title, message) { return this.show({ title, message, type: 'success' }); },
    error(title, message) { return this.show({ title, message, type: 'error' }); },
    warning(title, message) { return this.show({ title, message, type: 'warning' }); },
    info(title, message) { return this.show({ title, message, type: 'info' }); }
  },

  modal: {
    show(options) {
      const { title, content, onClose, buttons = [] } = options;
      
      const overlay = document.createElement('div');
      overlay.className = 'modal-overlay';
      
      const modal = document.createElement('div');
      modal.className = 'modal';
      
      modal.innerHTML = `
        <div class="modal-header">
          <h2 class="modal-title">${title}</h2>
          <button class="modal-close">×</button>
        </div>
        <div class="modal-body">${content}</div>
        ${buttons.length ? `
          <div class="modal-footer">
            ${buttons.map(btn => `<button class="btn ${btn.primary ? 'btn-primary' : 'btn-secondary'}" data-action="${btn.action}">${btn.label}</button>`).join('')}
          </div>
        ` : ''}
      `;
      
      overlay.appendChild(modal);
      document.body.appendChild(overlay);
      
      const close = () => {
        overlay.remove();
        if (onClose) onClose();
      };
      
      modal.querySelector('.modal-close').onclick = close;
      overlay.onclick = (e) => { if (e.target === overlay) close(); };
      
      buttons.forEach(btn => {
        modal.querySelector(`[data-action="${btn.action}"]`).onclick = () => {
          if (btn.onClick) btn.onClick();
          if (btn.close !== false) close();
        };
      });
      
      return { overlay, modal, close };
    }
  },

  pwa: {
    async register() {
      if ('serviceWorker' in navigator) {
        try {
          const registration = await navigator.serviceWorker.register('/static/sw.js', {
            scope: '/'
          });
          console.log('SW registered:', registration.scope);
          return registration;
        } catch (error) {
          console.error('SW registration failed:', error);
          return null;
        }
      }
      return null;
    },

    async requestNotificationPermission() {
      if ('Notification' in window && Notification.permission === 'default') {
        return await Notification.requestPermission();
      }
      return Notification.permission;
    },

    async showNotification(title, options = {}) {
      if ('Notification' in window && Notification.permission === 'granted') {
        return new Notification(title, {
          icon: '/static/icons/icon-192.png',
          badge: '/static/icons/icon-192.png',
          ...options
        });
      }
    }
  },

  realtime: {
    socket: null,
    connected: false,
    listeners: {},
    tenantId: null,

    connect() {
      if (this.socket?.readyState === WebSocket.OPEN) return;
      
      const wsUrl = `ws://${window.location.host}`;
      this.socket = new WebSocket(wsUrl);

      this.socket.onopen = () => {
        console.log('[WS] Connected');
        this.connected = true;
        if (this.tenantId) {
          this.join(this.tenantId);
        }
        this.emit('connected');
      };

      this.socket.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data);
          if (payload.event === 'portal-event') {
            const { event: eventType, data } = payload;
            console.log('[WS] Event:', eventType, data);
            this.emit(eventType, data);
          }
        } catch (e) {
          console.error('[WS] Parse error:', e);
        }
      };

      this.socket.onclose = () => {
        console.log('[WS] Disconnected');
        this.connected = false;
        setTimeout(() => this.connect(), 3000);
      };

      this.socket.onerror = (error) => {
        console.error('[WS] Error:', error);
      };
    },

    join(tenantId) {
      this.tenantId = tenantId;
      if (this.connected) {
        this.socket.send(JSON.stringify({ action: 'join', tenantId }));
      }
    },

    on(event, callback) {
      if (!this.listeners[event]) {
        this.listeners[event] = [];
      }
      this.listeners[event].push(callback);
    },
    
    off(event, callback) {
      if (!this.listeners[event]) return;
      this.listeners[event] = this.listeners[event].filter(cb => cb !== callback);
    },

    emit(event, data) {
      if (this.listeners[event]) {
        this.listeners[event].forEach(cb => cb(data));
      }
    }
  },

  init() {
    this.theme.init();
    this.pwa.register();
    this.realtime.connect();
    this.toast.init();
    
    document.addEventListener('DOMContentLoaded', () => {
      this.initThemeToggle();
      this.initAnimations();
      this.initRealtimeToasts();
    });
  },

  initThemeToggle() {
    const toggle = document.getElementById('theme-toggle');
    if (toggle) {
      toggle.addEventListener('click', () => {
        const newTheme = Portal.theme.toggle();
        const icon = toggle.querySelector('span') || toggle;
        icon.textContent = newTheme === 'dark' ? '🌙' : '☀️';
      });
    }
  },

  initAnimations() {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('visible');
        }
      });
    }, { threshold: 0.1 });

    document.querySelectorAll('[data-animate]').forEach(el => {
      observer.observe(el);
    });
  },

  initRealtimeToasts() {
    this.realtime.on('projectCreated', (project) => {
      this.toast.success('Neues Projekt', `Projekt "${project.name}" wurde erstellt`);
    });
    
    this.realtime.on('projectUpdated', (project) => {
      this.toast.info('Projekt aktualisiert', `Projekt "${project.name}" wurde aktualisiert`);
    });
    
    this.realtime.on('projectDeleted', () => {
      this.toast.warning('Projekt gelöscht', 'Ein Projekt wurde gelöscht');
    });
  }
};

window.Portal = Portal;
Portal.init();
