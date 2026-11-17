import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.caddieline.app',
  appName: 'CaddieLine',
  webDir: 'dist',
  server: {
    androidScheme: 'https'
  }
};

export default config;
