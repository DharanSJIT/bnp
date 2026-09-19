import { create } from 'zustand';
import api from '../lib/api';

/** Shared current-workflow context (§5): fetched when a route carries :id */
export const useWorkflow = create((set, get) => ({
  workflow: null,
  mapping: null,
  joinMap: null,
  recentRuns: [],
  loading: false,
  error: null,

  fetch: async (id, { silent } = {}) => {
    if (!id) {
      set({ workflow: null, mapping: null, joinMap: null, recentRuns: [], error: null, loading: false });
      return null;
    }
    if (!silent) set({ loading: true, error: null });
    try {
      const { data } = await api.get(`/workflows/${id}`);
      set({
        workflow: data.workflow,
        mapping: data.mapping,
        joinMap: data.joinMap,
        recentRuns: data.recentRuns || [],
        loading: false,
        error: null,
      });
      return data.workflow;
    } catch (err) {
      if (!silent) set({ loading: false, error: err.response ? err.response.data?.error || err.message : err.message });
      return null;
    }
  },

  refresh: () => {
    const wf = get().workflow;
    if (wf) return get().fetch(wf._id, { silent: true });
    return Promise.resolve(null);
  },

  setWorkflow: (workflow) => set({ workflow }),
  setMapping: (mapping) => set({ mapping }),
  setJoinMap: (joinMap) => set({ joinMap }),
  setRecentRuns: (recentRuns) => set({ recentRuns }),

  /** latest completed run id, if any */
  latestRunId: () => {
    const runs = get().recentRuns || [];
    if (runs.length) return runs[0]._id;
    return null;
  },

  clear: () =>
    set({ workflow: null, mapping: null, joinMap: null, recentRuns: [], loading: false, error: null }),
}));