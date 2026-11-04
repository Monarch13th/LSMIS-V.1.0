import { createContext, useContext, useCallback } from "react";

const ToastContext = createContext(null);
export const useToast = () => useContext(ToastContext);

export const ToastProvider = ({ children }) => {
  // Floating pill toasts disabled across all modules — in-app AlertDialog is used instead
  const showToast = useCallback(() => {}, []);
  const dismiss = useCallback(() => {}, []);

  return (
    <ToastContext.Provider value={{ showToast, dismissToast: dismiss }}>
      {children}
    </ToastContext.Provider>
  );
};
