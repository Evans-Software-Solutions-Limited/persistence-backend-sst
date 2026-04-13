# 08 — Profile & Settings: Technical Design

## Domain Models

```typescript
// src/domain/models/user.ts
export interface UserProfile {
  id: string;
  email: string;
  displayName: string;
  avatarUrl: string | null;
  role: UserRole;
  fitnessLevel: FitnessLevel;
  height: number | null; // cm
  weight: number | null; // kg
  availableEquipment: EquipmentType[];
  accessibilityNeeds: AccessibilityTag[];
  createdAt: string;
}

export type UserRole =
  | "user"
  | "personal_trainer"
  | "physiotherapist"
  | "admin";
export type FitnessLevel = "beginner" | "intermediate" | "advanced" | "expert";

// src/domain/models/preferences.ts
export interface AppPreferences {
  theme: "system" | "light" | "dark";
  weightUnit: "kg" | "lbs";
  distanceUnit: "km" | "miles";
  defaultRestTimer: number; // seconds
  autoStartRestTimer: boolean;
  notifications: NotificationPreferences;
}

export interface NotificationPreferences {
  workoutReminders: boolean;
  restTimer: boolean;
  personalRecords: boolean;
  trainerMessages: boolean;
}
```

## Port Extensions

```typescript
// ApiPort
getProfile(): Promise<Result<UserProfile, ApiError>>;
updateProfile(data: Partial<UserProfile>): Promise<Result<UserProfile, ApiError>>;
deleteAccount(): Promise<Result<void, ApiError>>;
getSessionHistory(cursor?: string): Promise<Result<PaginatedResult<WorkoutSession>, ApiError>>;

// StoragePort
getCachedProfile(): Promise<UserProfile | null>;
cacheProfile(profile: UserProfile): Promise<void>;
getPreferences(): Promise<AppPreferences>;
savePreferences(prefs: Partial<AppPreferences>): Promise<void>;
getCachedSessionHistory(): Promise<WorkoutSession[]>;
cacheSessionHistory(sessions: WorkoutSession[]): Promise<void>;
```

## UI Components

```
containers/ProfileContainer.tsx            # Fetches profile
presenters/ProfilePresenter.tsx            # Profile display
containers/ProfileEditorContainer.tsx      # Edit form
presenters/ProfileEditorPresenter.tsx      # Edit form UI
containers/SettingsContainer.tsx           # Preferences + account
presenters/SettingsPresenter.tsx           # Settings list
containers/SessionHistoryContainer.tsx     # Past sessions
presenters/SessionHistoryPresenter.tsx     # Session list
presenters/SessionHistoryDetailPresenter.tsx # Single past session detail
components/EquipmentPicker.tsx             # Multi-select equipment
components/FitnessLevelPicker.tsx          # Fitness level selector
components/PreferenceToggle.tsx            # Settings toggle row
```

## Preferences Storage

Preferences are **local-only** (AsyncStorage, not API-synced). This avoids unnecessary API calls and works fully offline. Future: sync preferences if multi-device support is needed.

## Tab Navigation

Profile is a tab in the bottom navigation:

```
(tabs)/
├── index.tsx      # Dashboard
├── workouts.tsx   # Workout list
├── progress.tsx   # Progress/goals
└── profile.tsx    # Profile & settings
```
