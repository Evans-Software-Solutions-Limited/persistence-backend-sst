# 12 — Production Readiness: Technical Design

## EAS Build Configuration

```json
// eas.json
{
  "cli": { "version": ">= 12.0.0" },
  "build": {
    "development": {
      "developmentClient": true,
      "distribution": "internal",
      "env": { "EXPO_PUBLIC_API_URL": "http://localhost:13557" }
    },
    "preview": {
      "distribution": "internal",
      "env": { "EXPO_PUBLIC_API_URL": "https://api-preprod.persistence.app" }
    },
    "production": {
      "distribution": "store",
      "autoIncrement": true,
      "env": { "EXPO_PUBLIC_API_URL": "https://api.persistence.app" }
    }
  },
  "submit": {
    "production": {
      "ios": { "appleId": "...", "ascAppId": "...", "appleTeamId": "..." },
      "android": { "serviceAccountKeyPath": "./google-services.json" }
    }
  }
}
```

## Performance Optimisation

### Startup

- Minimise root component tree (lazy load tabs)
- Preload critical data from SQLite during splash screen
- Defer non-critical initialization (health, notifications)

### Bundle

- Tree-shake unused code
- Use `expo-constants` to strip dev-only code
- Monitor bundle with `npx expo export --dump-sourcemap`
- Target: <15MB JS bundle

### Rendering

- `React.memo` on list items
- `FlashList` for long lists (exercises, sessions)
- Avoid re-renders from context changes (narrow subscriptions)

## Error Monitoring

```typescript
// src/shared/errors/reporting.ts
export interface ErrorReporter {
  captureException(error: Error, context?: Record<string, string>): void;
  setUser(userId: string): void;
  addBreadcrumb(message: string, data?: Record<string, string>): void;
}
```

Integration options:

1. **Sentry** (`@sentry/react-native`) — full-featured, source map support
2. **Expo EAS Insights** — simpler, Expo-native

## Security Checklist

- Environment variables: only `EXPO_PUBLIC_*` exposed (safe by design)
- API keys: Supabase anon key is public (designed for client use)
- Stripe: publishable key only (safe for client)
- JWT storage: `expo-secure-store` for production (not AsyncStorage)
- Console logs: stripped via Babel plugin in production
- Deep links: validate scheme and path before navigation

## Release Process

```
1. Feature freeze on branch
2. Run full quality gates (typecheck, lint, prettier, build, test)
3. Build preview for internal testing (EAS Build → preview)
4. QA on preview build (critical paths)
5. Build production (EAS Build → production)
6. Submit to App Store Connect / Google Play Console
7. Staged rollout (10% → 50% → 100%)
8. Monitor crash-free rate and error reports
9. Rollback plan: previous version still in store, OTA update revert
```

## Rollback Strategy

- **OTA (Over-The-Air)**: Expo Updates for JS-only changes, instant rollback
- **Store rollback**: Revert to previous build version in store
- **Backend**: SST stages allow instant rollback (`sst deploy --stage production` with previous commit)
