/**
 * Reorder screens own vertical drag gestures. Native modal swipe-to-dismiss
 * must stay disabled or iOS can claim the same gesture before the exercise
 * list does. Each screen already provides an explicit close/minimise action.
 */
export const reorderModalOptions = {
  presentation: "modal" as const,
  headerShown: false,
  gestureEnabled: false,
};
