import type { CapacitorConfig } from '@capacitor/cli';

// This app loads the live website directly inside the native WebView —
// server.url makes Capacitor skip the bundled www/ files and point the
// WebView straight at the real site.
const config: CapacitorConfig = {
  appId: 'com.hemam.edu.app',
  appName: 'HemamApp',
  webDir: 'www',
  server: {
    url: 'https://hemam-edu.blogspot.com',
    cleartext: false,
  },
  android: {
    allowMixedContent: false,
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 1500,
      backgroundColor: '#121212',
      showSpinner: false,
      androidSplashResourceName: 'splash',
    },
  },
};

export default config;
