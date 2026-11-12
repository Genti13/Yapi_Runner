import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.chanchito.runner',
  appName: 'Chanchito Runner',
  // Debe coincidir con "outputPath.base" de angular.json
  webDir: 'dist/chanchito-runner',
  backgroundColor: '#a9defc',
  plugins: {
    CapacitorSQLite: {
      androidIsEncryption: false,
    },
  },
};

export default config;
