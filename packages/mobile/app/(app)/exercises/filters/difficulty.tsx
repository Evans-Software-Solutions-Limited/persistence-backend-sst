import { FilterAxisDetailPresenter } from "../../../../src/ui/presenters/FilterAxisDetailPresenter";
import { useExerciseFiltersPending } from "../../../../src/ui/hooks/useExerciseFiltersPending";
import {
  EXERCISE_DIFFICULTIES,
  DIFFICULTY_LABELS,
  type ExerciseDifficulty,
} from "../../../../src/domain/models/exercise";

/**
 * Difficulty axis detail screen. Short list — no search bar (AC 7.11).
 */
export default function DifficultyScreen() {
  const pending = useExerciseFiltersPending();
  const items = EXERCISE_DIFFICULTIES.map((key) => ({
    key,
    label: DIFFICULTY_LABELS[key],
  }));

  return (
    <FilterAxisDetailPresenter
      items={items}
      selectedKeys={pending.difficulties}
      onToggle={(key) => pending.toggleDifficulty(key as ExerciseDifficulty)}
      testID="filters-difficulty"
    />
  );
}
