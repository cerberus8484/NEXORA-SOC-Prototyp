import { api } from '../../lib/apiClient';
import type { ManagedUser } from './userMgmtModel';

export const userApi = {
  list: () => api.get<{ data: ManagedUser[] }>('/users'),
  create: (body: { email: string; password: string; role: string }) =>
    api.post<{ data: ManagedUser }>('/users', body),
  setRole: (id: string, role: string) =>
    api.patch<{ data: ManagedUser }>(`/users/${id}/role`, { role }),
  setActive: (id: string, isActive: boolean) =>
    api.patch<{ data: ManagedUser }>(`/users/${id}/active`, { isActive }),
  // Admin-only — Server gibt ein einmaliges temporäres Passwort zurück.
  resetPassword: (id: string) =>
    api.post<{ data: { tempPassword: string } }>(`/users/${id}/reset-password`),
  // Admin-only — MFA eines ausgesperrten Users zurücksetzen (Passwort-Step-up des Admins).
  resetMfa: (id: string, password: string) =>
    api.post<{ status: string; userId: string }>('/mfa/admin/reset', { userId: id, password }),
};
