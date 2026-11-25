import { createContext, useContext, useCallback } from "react";

const ToastContext = createContext(null);
export const useToast = () => useContext(ToastContext);

export const ToastProvider = ({ children }) => {
  const showToast = useCallback(() => {}, []);
  const dismiss = useCallback(() => {}, []);

  return (
    <ToastContext.Provider value={{ showToast, dismissToast: dismiss }}>
      {children}
    </ToastContext.Provider>
  );
};
