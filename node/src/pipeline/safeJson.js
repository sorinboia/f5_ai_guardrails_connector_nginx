export function safeJson(value) {
  try {
    return JSON.stringify(value);
  } catch (_err) {
    return '[unserializable]';
  }
}
