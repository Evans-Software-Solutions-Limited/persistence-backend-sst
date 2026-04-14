# 10 — Trainer Features: Technical Design

## Domain Models

```typescript
// src/domain/models/trainer.ts
export interface PTClientRelationship {
  id: string;
  trainerId: string;
  clientId: string;
  status: PTRelationshipStatus;
  trainerName: string;
  clientName: string;
  clientAvatarUrl: string | null;
  clientLastActive: string | null;
  createdAt: string;
}

export type PTRelationshipStatus =
  | "pending"
  | "active"
  | "inactive"
  | "terminated";

export interface WorkoutAssignment {
  id: string;
  trainerId: string;
  clientId: string;
  workoutId: string;
  workoutName: string;
  status: AssignmentStatus;
  notes: string | null;
  targetDate: string | null;
  assignedAt: string;
  completedAt: string | null;
}

export type AssignmentStatus = "assigned" | "in_progress" | "completed";
```

## Port Extensions

```typescript
// ApiPort
getClients(): Promise<Result<PTClientRelationship[], ApiError>>;
inviteClient(email: string): Promise<Result<PTClientRelationship, ApiError>>;
respondToInvitation(relationshipId: string, accept: boolean): Promise<Result<void, ApiError>>;
terminateRelationship(relationshipId: string): Promise<Result<void, ApiError>>;
getClientProfile(clientId: string): Promise<Result<UserProfile, ApiError>>;
getClientSessions(clientId: string): Promise<Result<WorkoutSession[], ApiError>>;
getClientProgress(clientId: string): Promise<Result<{ measurements: BodyMeasurement[]; goals: Goal[]; records: PersonalRecord[] }, ApiError>>;
assignWorkout(data: { clientId: string; workoutId: string; notes?: string; targetDate?: string }): Promise<Result<WorkoutAssignment, ApiError>>;
getAssignments(clientId?: string): Promise<Result<WorkoutAssignment[], ApiError>>;
```

## UI Components

```
containers/ClientListContainer.tsx           # Fetches clients
presenters/ClientListPresenter.tsx           # Client list
containers/ClientDetailContainer.tsx         # Client profile + data
presenters/ClientDetailPresenter.tsx         # Client summary view
containers/InviteClientContainer.tsx         # Invite form
presenters/InviteClientPresenter.tsx         # Invite UI
containers/AssignWorkoutContainer.tsx        # Workout assignment
presenters/AssignWorkoutPresenter.tsx        # Assignment form
components/ClientCard.tsx                    # Client list item
components/AssignmentCard.tsx                # Assignment list item
```

## Role-Based Visibility

```typescript
// In tab navigator
const { session } = useAuth();
const isTrainer =
  session?.role === "personal_trainer" || session?.role === "physiotherapist";

// Clients tab only rendered if isTrainer
```

## Authorization

All trainer endpoints enforce role check server-side:

- JWT must contain `personal_trainer` or `physiotherapist` role
- Client data access requires active relationship
- Terminated relationships block all client data access
