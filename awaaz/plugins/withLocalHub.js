/**
 * The community hub (speech + anonymity guard) is a laptop on the local
 * network, reached over plain http://<lan-ip>:8787 — there is no domain or TLS
 * certificate offline. Android blocks cleartext HTTP in release builds by
 * default, so allow it (the hub only ever sees what's already headed to it).
 */
const { withAndroidManifest } = require('expo/config-plugins');

module.exports = (config) =>
  withAndroidManifest(config, (cfg) => {
    const app = cfg.modResults.manifest.application?.[0];
    if (app) app.$['android:usesCleartextTraffic'] = 'true';
    return cfg;
  });
