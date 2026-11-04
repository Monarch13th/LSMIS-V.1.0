import { useState, useCallback } from "react";

/**
 * Custom hook to trigger admin password confirmation before executing sensitive actions.
 * Usage:
 * const { confirmModalProps, confirmAdminAction } = useAdminConfirmPassword();
 * 
 * confirmAdminAction({
 *   title: "Delete User",
 *   actionDescription: "Are you sure you want to delete user Juan Dela Cruz?",
 *   confirmButtonText: "Delete Account",
 *   danger: true,
 *   actionContext: { action: "Delete User Account", module: "Users" },
 *   onConfirm: async () => { await deleteUser(); }
 * });
 */
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
