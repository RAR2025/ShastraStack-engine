import axios from 'axios';

export const BACKEND_URL = import.meta.env.VITE_APP_BACKEND_URL || 'http://localhost:3000';
export const ENGINE_URL = import.meta.env.VITE_SHASTRASTACK_URL || 'http://localhost:4000';
export const MOCK_API_URL = import.meta.env.VITE_MOCK_API_URL || 'http://localhost:5000';
export const MOCK_STUDIO_URL = import.meta.env.VITE_MOCK_STUDIO_URL || 'http://localhost:5174';
export const MOCK_ADMIN_TOKEN = import.meta.env.VITE_MOCK_ADMIN_TOKEN || '';

const backend = axios.create({ baseURL: BACKEND_URL, timeout: 20000 });

const mock = axios.create({ baseURL: MOCK_API_URL, timeout: 20000 });

export function apiErrorMessage(err) {
  if (err?.response?.data?.error?.message) return err.response.data.error.message;
  if (err?.response?.data?.error?.code) return err.response.data.error.code;
  if (err?.code === 'ECONNABORTED') return 'Request timed out';
  if (!err?.response) return 'Service unreachable';
  return err?.message || 'Request failed';
}

export function apiErrorCode(err) {
  return err?.response?.data?.error?.code || err?.code || 'REQUEST_FAILED';
}

export { backend, mock };
