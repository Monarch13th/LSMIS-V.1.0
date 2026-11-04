export const repairCorruptedMockData = () => {
  try {
    // Purge legacy mock database keys so Supabase PostgreSQL remains the single source of truth
    const keysToRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith("lmis_db_mock_")) {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach((k) => localStorage.removeItem(k));
  } catch (e) {
    // Non-blocking cleanup
  }
};
