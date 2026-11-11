// Bridge to the native Android plugin (Kotlin, see android/app/src/main/java/id/strokuni/app).
// On the web every call degrades gracefully.

const cap = window.Capacitor;
export const isNative = !!(cap && cap.isNativePlatform && cap.isNativePlatform());
const plugin = isNative ? cap.Plugins?.Strokuni : null;

async function call(method, args = {}) {
  if (!plugin || typeof plugin[method] !== 'function') return null;
  try { return await plugin[method](args); }
  catch (e) { console.warn('native', method, e); return null; }
}

export const Native = {
  available: () => !!plugin,
  configure: (cfg) => call('configure', cfg),
  scheduleMeds: (payload) => call('scheduleMeds', payload),
  markTaken: (key, date, at) => call('markTaken', { key, date, at }),
  getTaken: () => call('getTaken'),
  status: () => call('checkStatus'),
  openSetting: (which) => call('openSetting', { which }),
  requestPerms: (permissions) => call('requestPermissions', { permissions }),
  checkPerms: () => call('checkPermissions'),
  speak: (text, rate) => call('speak', { text, rate }),
  stopSpeaking: () => call('stopSpeaking'),
  listen: (prompt) => call('listen', { prompt }),
  testAlarm: (seconds = 10) => call('testAlarm', { seconds }),
  callPhone: (number) => call('callPhone', { number }),
};

if (plugin && plugin.addListener) {
  // Native alarm screen confirmed a dose -> tell the app
  plugin.addListener('doseTaken', (e) => window.dispatchEvent(new CustomEvent('strokuni:doseTaken', { detail: e })));
}
