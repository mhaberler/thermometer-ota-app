import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.balloonware.thermometerota',
  appName: 'Thermometer OTA',
  webDir: 'dist',
  android: {
    // Enable edge-to-edge so env(safe-area-inset-*) reflects real insets
    edgeToEdge: true,
  },
};

export default config;
