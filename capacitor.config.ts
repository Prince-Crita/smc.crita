import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'in.crita.smc',
  appName: 'SMC',
  webDir: 'out',

  server: {
    url: 'https://smc-crita.vercel.app',
    cleartext: false
  }
};

export default config;