export function safeJson(value) {
  try {
    return JSON.stringify(value);
  } catch (_err) {
    return '[unserializable]';
  }
}

export function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch (_err) {
    return undefined;
  }
}
