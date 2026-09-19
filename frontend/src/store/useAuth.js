import { create } from 'zustand';
import api, { errMsg } from '../lib/api';

const TOKEN_KEY = 'onerecon_token';
const USER_KEY = 'onerecon_user';

function readStoredUser() {
  try {
    return JSON.parse(localStorage.getItem(USER_KEY) || 'null');
  } catch {
    return null;
  }
}

export const useAuth = create((set) => ({
  token: localStorage.getItem(TOKEN_KEY) || null,
  user: readStoredUser(),
  loginError: null,
  loggingIn: false,

  login: async (email, password) => {
    set({ loggingIn: true, loginError: null });
    try {
      const { data } = await api.post('/auth/login', { email, password });
      localStorage.setItem(TOKEN_KEY, data.token);
      localStorage.setItem(USER_KEY, JSON.stringify(data.user));
      set({ token: data.token, user: data.user, loggingIn: false, loginError: null });
      return data.user;
    } catch (err) {
      set({ loggingIn: false, loginError: errMsg(err, 'Login failed') });
      throw err;
    }
  },

  register: async (payload) => {
    set({ loggingIn: true, loginError: null });
    try {
      const { data } = await api.post('/auth/register', payload);
      localStorage.setItem(TOKEN_KEY, data.token);
      localStorage.setItem(USER_KEY, JSON.stringify(data.user));
      set({ token: data.token, user: data.user, loggingIn: false, loginError: null });
      return data.user;
    } catch (err) {
      set({ loggingIn: false, loginError: errMsg(err, 'Registration failed') });
      throw err;
    }
  },

  logout: () => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    set({ token: null, user: null });
  },
}));

export const ROLE_LABEL = {
  admin: 'Admin',
  'general-manager': 'General Manager',
  manager: 'Manager',
  approver: 'Approver',
  investigator: 'Investigator',
  monitor: 'Monitor',
  accountant: 'Accountant',
  cashier: 'Cashier',
};

// roles a newly self-registered user may pick (never admin)
export const REGISTER_ROLES = [
  { value: 'investigator', label: 'Investigator' },
  { value: 'monitor', label: 'Monitor' },
  { value: 'accountant', label: 'Accountant' },
  { value: 'cashier', label: 'Cashier' },
  { value: 'manager', label: 'Manager' },
  { value: 'approver', label: 'Approver' },
];