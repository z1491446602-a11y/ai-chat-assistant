import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { APIConfig } from '@/types';
import { DEFAULT_API_CONFIG } from '@/types';

function getDynamicEndpoint() {
  return '/api/chat';
}

function normalizeModel(model?: string): string {
  if (!model) {
    return DEFAULT_API_CONFIG.model;
  }

  const normalizedModel = String(model).trim();
  if (
    /^gpt-/i.test(normalizedModel)
    || normalizedModel === 'mimo-2.5'
    || normalizedModel === 'mimo-v2.5'
    || normalizedModel === 'mimo-v2.5-pro'
    || normalizedModel === 'kitty-voice'
    || normalizedModel === 'kitty-voice-xiaotian'
  ) {
    return DEFAULT_API_CONFIG.model;
  }

  return normalizedModel === 'deepseek-v4-flash' ? 'deepseek-v4' : normalizedModel;
}

function normalizeAPIConfig(config?: Partial<APIConfig>): APIConfig {
  return {
    ...DEFAULT_API_CONFIG,
    ...config,
    endpoint: getDynamicEndpoint(),
    apiKey: config?.apiKey || DEFAULT_API_CONFIG.apiKey,
    model: normalizeModel(config?.model),
    temperature: config?.temperature ?? DEFAULT_API_CONFIG.temperature,
    maxTokens: config?.maxTokens ?? DEFAULT_API_CONFIG.maxTokens,
    topP: config?.topP ?? DEFAULT_API_CONFIG.topP,
  };
}

type Theme = 'dark' | 'light';

interface SettingsState {
  apiConfig: APIConfig;
  theme: Theme;
  fontSize: number;
  showSettings: boolean;
  sidebarOpen: boolean;
  updateAPIConfig: (config: Partial<APIConfig>) => void;
  refreshEndpoint: () => void;
  setTheme: (theme: Theme) => void;
  setFontSize: (size: number) => void;
  toggleSettings: () => void;
  setShowSettings: (show: boolean) => void;
  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set, get) => ({
      apiConfig: normalizeAPIConfig(),
      theme: 'light',
      fontSize: 14,
      showSettings: false,
      sidebarOpen: true,

      updateAPIConfig: (config) => {
        set(state => ({
          apiConfig: normalizeAPIConfig({
            ...state.apiConfig,
            ...config,
          }),
        }));
      },

      refreshEndpoint: () => {
        set({
          apiConfig: normalizeAPIConfig(get().apiConfig),
        });
      },

      setTheme: (theme) => {
        set({ theme });
        document.documentElement.classList.toggle('dark', theme === 'dark');
      },

      setFontSize: (size) => {
        set({ fontSize: Math.max(12, Math.min(20, size)) });
      },

      toggleSettings: () => {
        set(state => ({ showSettings: !state.showSettings }));
      },

      setShowSettings: (show) => {
        set({ showSettings: show });
      },

      toggleSidebar: () => {
        set(state => ({ sidebarOpen: !state.sidebarOpen }));
      },

      setSidebarOpen: (open) => {
        set({ sidebarOpen: open });
      },
    }),
    {
      name: 'chat-settings',
      partialize: (state) => ({
        apiConfig: {
          apiKey: state.apiConfig.apiKey,
          model: state.apiConfig.model,
          temperature: state.apiConfig.temperature,
          maxTokens: state.apiConfig.maxTokens,
          topP: state.apiConfig.topP,
        },
        theme: state.theme,
        fontSize: state.fontSize,
      }),
      onRehydrateStorage: () => (state) => {
        if (state) {
          state.apiConfig = normalizeAPIConfig(state.apiConfig);
        }
      },
    }
  )
);
