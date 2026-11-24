import { CoachLibraryContainer } from "@/ui/containers/CoachLibraryContainer";

/**
 * Library tab — coach mode only (PER-129 K shell, canvas C10g). Segments
 * Workouts · Programmes · Meals · Resources · Forms; `?segment=` picks one.
 * Hidden (href: null) in athlete mode by `<TabsLayout>`.
 */
export default function LibraryTab() {
  return <CoachLibraryContainer />;
}
