import type { CapacitorConfig } from '@capacitor/cli';
const config: CapacitorConfig = {
  appId: 'com.wind.shizang', appName: '拾藏', webDir: 'dist/ui',
  server: { androidScheme: 'http' },
  plugins: { CapacitorHttp: { enabled: true }, SystemBars: { initialViewportFitValueHint:'cover', style:'LIGHT' } }
};
export default config;
