import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.pocketcaddy.app',
  appName: 'PocketCaddy',
  webDir: 'dist',
  server: {
    androidScheme: 'https'
  }
};

export default config;
