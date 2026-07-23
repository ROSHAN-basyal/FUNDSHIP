import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.sajilo.split',
  appName: 'Sajilo',
  webDir: 'dist',
  backgroundColor: '#f7f5ee',
  android: {
    path: 'andriod',
    allowMixedContent: true,
    backgroundColor: '#f7f5ee',
    captureInput: true,
    webContentsDebuggingEnabled: true,
  },
  plugins: {
    StatusBar: {
      style: 'LIGHT',
      backgroundColor: '#f7f5ee',
    },
  },
};

export default config;
