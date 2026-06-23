import { http } from './client';

export interface WizardState { completed: boolean }

export const wizard = {
  state: () => http.get<WizardState>('/api/v1/admin/wizard/state'),
  setCompleted: (completed: boolean) =>
    http.post<WizardState>('/api/v1/admin/wizard/state', { completed }),
};
