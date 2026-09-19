import axios from 'axios';

const api = axios.create({
  baseURL: '/api',
  timeout: 90000,
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('onerecon_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response && err.response.status === 401) {
      localStorage.removeItem('onerecon_token');
      localStorage.removeItem('onerecon_user');
      if (!window.location.pathname.startsWith('/login')) {
        window.location.href = '/login';
      }
    }
    return Promise.reject(err);
  }
);

/** readable error message from an axios error */
export function errMsg(err, fallback = 'Something went wrong') {
  if (err && err.response && err.response.data) {
    const d = err.response.data;
    if (typeof d === 'string') return d;
    return d.error || d.message || fallback;
  }
  if (err && err.message) return err.message;
  return fallback;
}

/** download a blob response as a file */
export function downloadBlob(res, fallbackName = 'download') {
  const disposition = res.headers && res.headers['content-disposition'];
  let filename = fallbackName;
  if (disposition) {
    const m = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition);
    if (m) filename = m[1];
  }
  const url = URL.createObjectURL(new Blob([res.data]));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export default api;