export const repairCorruptedMockData = () => {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    const keysToRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (
        key &&
        (key.startsWith("lmis_db_mock_") ||
          key.startsWith("lmis_mock_") ||
          key.startsWith("lmis_profile_") ||
          key === "lsmis_personnel_audit_mirror_v1")
      ) {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach((k) => {
      try {
        localStorage.removeItem(k);
      } catch (_) { }
    });
  } catch (e) {
  }
};
