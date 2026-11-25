import { useState, useCallback } from "react";

export const useAdminConfirmPassword = () => {
  const [modalState, setModalState] = useState({
    open: false,
    title: "Admin Password Required",
    actionDescription: "Please confirm your password to apply this administrative change.",
    confirmButtonText: "Confirm Action",
    danger: false,
    actionContext: {},
    pendingAction: null,
  });

  const confirmAdminAction = useCallback(({
    title = "Admin Password Required",
    actionDescription = "Please enter your current administrator password to authorize this action.",
    confirmButtonText = "Confirm Action",
    danger = false,
    actionContext = {},
    onConfirm,
  }) => {
    setModalState({
      open: true,
      title,
      actionDescription,
      confirmButtonText,
      danger,
      actionContext,
      pendingAction: onConfirm,
    });
  }, []);

  const closeModal = useCallback(() => {
    setModalState((prev) => ({ ...prev, open: false, pendingAction: null }));
  }, []);

  const handleConfirmSuccess = useCallback(async () => {
    const action = modalState.pendingAction;
    if (action) {
      await action();
    }
  }, [modalState.pendingAction]);

  return {
    confirmModalProps: {
      open: modalState.open,
      onClose: closeModal,
      onConfirmSuccess: handleConfirmSuccess,
      title: modalState.title,
      actionDescription: modalState.actionDescription,
      confirmButtonText: modalState.confirmButtonText,
      danger: modalState.danger,
      actionContext: modalState.actionContext,
    },
    confirmAdminAction,
  };
};
