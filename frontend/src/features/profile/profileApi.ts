import { api } from '../../lib/apiClient';

export type Language = 'de' | 'en';
export type DateFormat = 'dmy' | 'iso';

export interface UserProfile {
  id: string;
  email: string;
  displayName?: string;
  phone: string;
  theme: string;
  language: Language;
  dateFormat: DateFormat;
  role: string;
  isActive: boolean;
  lastLoginAt?: string | null;
  createdAt?: string;
}

export interface UpdateProfileBody {
  displayName?: string;
  phone?: string;
  theme?: string;
  language?: Language;
  dateFormat?: DateFormat;
}

// Per-User-Feature-Flags vom Profil-Endpoint (MFA/PAT-Selbstverwaltung gaten).
export interface ProfileFeatures {
  mfaEnabled: boolean;
  apiTokensEnabled: boolean;
}

interface ProfileResponse {
  data: UserProfile;
  features?: ProfileFeatures;
}

interface ApiSignalOpts {
  signal?: AbortSignal;
}

const FEATURES_OFF: ProfileFeatures = { mfaEnabled: false, apiTokensEnabled: false };

export const profileApi = {
  getProfile: (opts?: ApiSignalOpts): Promise<UserProfile> =>
    api
      .get<ProfileResponse>('/profile', undefined, opts?.signal ? { signal: opts.signal } : undefined)
      .then((res) => res.data),

  // Profil + Feature-Flags in EINEM Request (ProfilePage-Initial-Load).
  getProfileWithFeatures: (opts?: ApiSignalOpts): Promise<{ profile: UserProfile; features: ProfileFeatures }> =>
    api
      .get<ProfileResponse>('/profile', undefined, opts?.signal ? { signal: opts.signal } : undefined)
      .then((res) => ({ profile: res.data, features: res.features ?? FEATURES_OFF })),

  updateProfile: (body: UpdateProfileBody, opts?: ApiSignalOpts): Promise<UserProfile> =>
    api
      .put<ProfileResponse>('/profile', body, opts?.signal ? { signal: opts.signal } : undefined)
      .then((res) => res.data),
};
