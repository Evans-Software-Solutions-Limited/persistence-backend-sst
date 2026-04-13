# 01 — Design System: Technical Design

## Architecture

All design system code lives in `src/ui/`:

- `src/ui/theme/` — tokens, theme provider, hooks
- `src/ui/components/` — reusable primitives (presenters)

### Theme Structure

```typescript
// src/ui/theme/tokens.ts
export const colors = {
  primary: { 50: '...', 100: '...', ..., 900: '...' },
  secondary: { ... },
  success: { ... },
  warning: { ... },
  error: { ... },
  neutral: { 0: '#fff', 50: '...', ..., 950: '#0a0a0a' },
} as const;

export const typography = {
  heading1: { fontSize: 32, lineHeight: 40, fontWeight: '700' },
  heading2: { fontSize: 24, lineHeight: 32, fontWeight: '700' },
  heading3: { fontSize: 20, lineHeight: 28, fontWeight: '600' },
  heading4: { fontSize: 18, lineHeight: 24, fontWeight: '600' },
  body: { fontSize: 16, lineHeight: 24, fontWeight: '400' },
  bodySmall: { fontSize: 14, lineHeight: 20, fontWeight: '400' },
  caption: { fontSize: 12, lineHeight: 16, fontWeight: '400' },
  label: { fontSize: 14, lineHeight: 20, fontWeight: '500' },
} as const;

export const spacing = {
  xs: 4, sm: 8, md: 12, base: 16, lg: 20, xl: 24, '2xl': 32, '3xl': 48, '4xl': 64,
} as const;

export const borderRadius = {
  sm: 4, md: 8, lg: 12, xl: 16, full: 9999,
} as const;
```

### Theme Provider

```typescript
// src/ui/theme/ThemeProvider.tsx
type ThemeMode = 'light' | 'dark' | 'system';

interface Theme {
  mode: 'light' | 'dark';
  colors: { background: string; surface: string; text: string; textSecondary: string; border: string; ... };
  typography: typeof typography;
  spacing: typeof spacing;
  borderRadius: typeof borderRadius;
}

// Derives semantic colours from mode + token palette
// e.g., light mode: background = neutral.0, text = neutral.900
// dark mode: background = neutral.950, text = neutral.50
```

### Component Patterns

All primitives follow presenter pattern:

```typescript
// src/ui/components/Button.tsx
type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger';
type ButtonSize = 'sm' | 'md' | 'lg';

type ButtonProps = {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  isLoading?: boolean;
  isDisabled?: boolean;
  leftIcon?: ReactNode;
};

export function Button({ label, onPress, variant = 'primary', ... }: ButtonProps) {
  // Pure render — style lookup from theme, no state
}
```

### Migration Notes from Old App

The old `persistence-mobile` used Gluestack UI + NativeWind/Tailwind. The V2 uses:

- **React Native StyleSheet** for performance (no runtime CSS-in-JS)
- **Theme tokens** as plain objects (no Tailwind dependency)
- **Components styled inline** via theme hook

This avoids the Tailwind/NativeWind build complexity and reduces bundle size. If Tailwind is later desired, it can wrap these tokens, but the primitives should work without it.
