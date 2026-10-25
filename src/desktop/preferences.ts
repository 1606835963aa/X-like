const syncPolicy = 'manual-incremental';
const allowed: Record<string, string[]> = {
  theme: ['light', 'dark'], layout: ['grid', 'list'], autoSync: ['true', 'false']
};

export function loadPreferences(raw: unknown): Record<string, string> {
  const saved = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  const preferences: Record<string, string> = { autoSync: 'false', syncPolicy };
  for (const [key, values] of Object.entries(allowed)) {
    if (typeof saved[key] === 'string' && values.includes(saved[key])) preferences[key] = saved[key];
  }
  if (saved.syncPolicy !== syncPolicy) preferences.autoSync = 'false';
  return preferences;
}

export function validPreference(key: string, value: string) {
  return allowed[key]?.includes(value) === true;
}
