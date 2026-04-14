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

### Component Library: Tamagui

The V2 uses **Tamagui** as the component library foundation.

**Why Tamagui:**

- **Optimizing compiler** — flattens component trees at build time, minimal runtime overhead
- **Universal** — web/mobile support, Expo-compatible
- **Token system** — compiles away at build time for zero-cost theming
- **Rich primitives** — `Stack`, `Text`, `Button`, `Input`, `Sheet`, `Dialog`, etc.

**Alternatives evaluated:**

| Library               | Verdict                                                               |
| --------------------- | --------------------------------------------------------------------- |
| gluestack UI          | Good API but heavier runtime — fallback if Tamagui has Expo 53 issues |
| NativeWind            | Tailwind familiarity but compile-time config complexity               |
| React Native Paper    | Material Design — wrong aesthetic for a fitness app                   |
| React Native Elements | Good primitives but limited theming, less active maintenance          |

**Usage pattern:**

- Use Tamagui primitives wrapped in our own design-system components
- Our wrappers add Persistence branding, custom tokens, and domain-specific variants
- Theme tokens are defined in Tamagui's token system (compiled away at build time)
- If Tamagui proves too complex for the Expo 53 preview environment, fall back to gluestack UI

### Component Styling Pattern

```typescript
// src/ui/components/Button.tsx — wraps Tamagui's Button with Persistence variants
import { Button as TamaguiButton, styled } from "tamagui";

export const Button = styled(TamaguiButton, {
  variants: {
    variant: {
      primary: { backgroundColor: "$primary500", color: "$white" },
      secondary: {
        backgroundColor: "$surface",
        borderColor: "$primary500",
        borderWidth: 1,
      },
      ghost: { backgroundColor: "transparent" },
      danger: { backgroundColor: "$error500" },
    },
    size: {
      sm: { height: 36, paddingHorizontal: "$sm" },
      md: { height: 44, paddingHorizontal: "$base" },
      lg: { height: 52, paddingHorizontal: "$lg" },
    },
  } as const,
  defaultVariants: { variant: "primary", size: "md" },
});
```

### Migration Notes from Old App

The old `persistence-mobile` used Gluestack UI + NativeWind/Tailwind. The V2 replaces this with Tamagui for better build-time optimisation and a cleaner API surface. Tokens from the old app (`constants/colors.ts`, `constants/theme.ts`) should be ported into Tamagui's token system to maintain brand continuity, then evolved.

### Design Quality Tooling

- Use the `/frontend-design` skill when building any screen or component to ensure high visual quality
- Run the app locally and take screenshots at milestones to review visual quality
- Use Expo preview tools or the Claude Preview MCP for visual analysis
- Reference the old app's theme tokens as a baseline, then evolve
