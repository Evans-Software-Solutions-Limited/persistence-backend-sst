# 02 — Auth Flow: Technical Design

## Architecture

Auth is a **driven adapter** implementing the auth port:

```
domain/ports/auth.port.ts          # Interface
adapters/auth/supabase.adapter.ts  # Supabase implementation
adapters/auth/mock.adapter.ts      # Test implementation
ui/hooks/useAuth.ts                # React hook exposing auth state
ui/containers/SignInContainer.tsx   # Sign-in logic
ui/presenters/SignInPresenter.tsx   # Sign-in UI
```

### Auth Port

```typescript
// src/domain/ports/auth.port.ts
export interface AuthPort {
  signInWithEmail(
    email: string,
    password: string,
  ): Promise<Result<AuthSession, AuthError>>;
  signUpWithEmail(
    email: string,
    password: string,
  ): Promise<Result<AuthSession, AuthError>>;
  signInWithOAuth(
    provider: OAuthProvider,
  ): Promise<Result<AuthSession, AuthError>>;
  signOut(): Promise<Result<void, AuthError>>;
  getSession(): Promise<Result<AuthSession | null, AuthError>>;
  onAuthStateChange(
    callback: (session: AuthSession | null) => void,
  ): () => void;
  resetPassword(email: string): Promise<Result<void, AuthError>>;
  refreshSession(): Promise<Result<AuthSession, AuthError>>;
}

export type OAuthProvider = "google" | "apple" | "facebook";

export interface AuthSession {
  accessToken: string;
  refreshToken: string;
  userId: string;
  email: string;
  expiresAt: number;
}

export type AuthError =
  | { code: "invalid_credentials"; message: string }
  | { code: "email_taken"; message: string }
  | { code: "network_error"; message: string }
  | { code: "token_expired"; message: string }
  | { code: "unknown"; message: string };
```

### Supabase Adapter

Wraps `@supabase/supabase-js` auth methods. Existing `src/auth/provider.tsx` is refactored into this adapter.

Token provider pattern (from foundation): `setTokenProvider()` injects the access token into the API client, keeping auth decoupled from API layer.

### Auth State Management

```typescript
// src/ui/hooks/useAuth.ts
interface AuthState {
  session: AuthSession | null;
  isLoading: boolean;
  isAuthenticated: boolean;
}

// Uses AuthPort.onAuthStateChange to keep state in sync
// Provides signIn, signUp, signOut, resetPassword actions
```

### Route Protection

```
app/
├── _layout.tsx           # Root: checks auth, redirects
├── (auth)/
│   ├── _layout.tsx       # Auth group layout
│   ├── sign-in.tsx       # → SignInContainer
│   ├── sign-up.tsx       # → SignUpContainer
│   └── forgot-password.tsx
└── (app)/
    ├── _layout.tsx       # App group layout (tab navigator)
    └── (tabs)/           # Authenticated screens
```

### Container/Presenter Split

```typescript
// SignInContainer: handles auth logic
// - calls useAuth().signIn on form submit
// - manages form validation state
// - handles OAuth flow initiation
// - navigates on success

// SignInPresenter: pure UI
// - email/password inputs
// - OAuth buttons
// - error display
// - loading state
// Props: { onSubmit, onOAuth, error, isLoading }
```

### Offline Session Handling

- On app launch: restore session from AsyncStorage
- If token expired: attempt silent refresh
- If refresh fails (offline): show app with cached data, mark as "offline"
- When back online: refresh token automatically
- Sign-in always requires network (no offline sign-in)
