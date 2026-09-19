import axios from 'axios';
import { config } from '../config/env.js';

const client = axios.create({
  baseURL: config.aiServiceUrl,
  timeout: Number(process.env.AI_TIMEOUT_MS || 300000), // 5 min for reconcile
});

client.interceptors.request.use((cfg) => {
  console.log(`[ai] -> ${cfg.method.toUpperCase()} ${cfg.url}`);
  return cfg;
});

export async function aiCall(path, body, opts = {}) {
  const { data } = await client.post(path, body, opts);
  return data;
}

export async function aiStatus() {
  try {
    const { data } = await client.get('/health', { timeout: 3000 });
    return data;
  } catch (err) {
    return { status: 'down', error: err.message };
  }
}