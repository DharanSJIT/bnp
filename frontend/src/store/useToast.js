import { create } from 'zustand';

let nextId = 1;

export const useToast = create((set, get) => ({
  toasts: [],

  add: (message, type = 'info', duration = 4200) => {
    const id = `toast-${nextId++}`;
    set((s) => ({ toasts: [...s.toasts, { id, message, type, duration }] }));
    if (duration > 0) {
      setTimeout(() => get().remove(id), duration);
    }
    return id;
  },

  remove: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

export const toast = {
  success: (m) => useToast.getState().add(m, 'success'),
  error: (m) => useToast.getState().add(m, 'error', 6000),
  info: (m) => useToast.getState().add(m, 'info'),
};