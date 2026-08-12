---
name: Chronicle Asset Core
colors:
  surface: '#f8f9ff'
  surface-dim: '#cbdbf5'
  surface-bright: '#f8f9ff'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#eff4ff'
  surface-container: '#e5eeff'
  surface-container-high: '#dce9ff'
  surface-container-highest: '#d3e4fe'
  on-surface: '#0b1c30'
  on-surface-variant: '#45474c'
  inverse-surface: '#213145'
  inverse-on-surface: '#eaf1ff'
  outline: '#75777d'
  outline-variant: '#c5c6cd'
  surface-tint: '#545f73'
  primary: '#091426'
  on-primary: '#ffffff'
  primary-container: '#1e293b'
  on-primary-container: '#8590a6'
  inverse-primary: '#bcc7de'
  secondary: '#5c5f61'
  on-secondary: '#ffffff'
  secondary-container: '#e0e3e5'
  on-secondary-container: '#626567'
  tertiary: '#001624'
  on-tertiary: '#ffffff'
  tertiary-container: '#002c42'
  on-tertiary-container: '#0099d9'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#d8e3fb'
  primary-fixed-dim: '#bcc7de'
  on-primary-fixed: '#111c2d'
  on-primary-fixed-variant: '#3c475a'
  secondary-fixed: '#e0e3e5'
  secondary-fixed-dim: '#c4c7c9'
  on-secondary-fixed: '#191c1e'
  on-secondary-fixed-variant: '#444749'
  tertiary-fixed: '#c9e6ff'
  tertiary-fixed-dim: '#89ceff'
  on-tertiary-fixed: '#001e2f'
  on-tertiary-fixed-variant: '#004c6e'
  background: '#f8f9ff'
  on-background: '#0b1c30'
  surface-variant: '#d3e4fe'
typography:
  display-lg:
    fontFamily: Inter
    fontSize: 32px
    fontWeight: '700'
    lineHeight: 40px
    letterSpacing: -0.02em
  headline-md:
    fontFamily: Inter
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 32px
    letterSpacing: -0.01em
  title-sm:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '600'
    lineHeight: 24px
  body-md:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
  body-sm:
    fontFamily: Inter
    fontSize: 13px
    fontWeight: '400'
    lineHeight: 18px
  label-caps:
    fontFamily: Inter
    fontSize: 11px
    fontWeight: '700'
    lineHeight: 16px
    letterSpacing: 0.05em
  mono-data:
    fontFamily: JetBrains Mono
    fontSize: 12px
    fontWeight: '400'
    lineHeight: 16px
rounded:
  sm: 0.125rem
  DEFAULT: 0.25rem
  md: 0.375rem
  lg: 0.5rem
  xl: 0.75rem
  full: 9999px
spacing:
  unit: 4px
  gutter: 16px
  margin-page: 24px
  panel-width-fixed: 320px
  grid-gap: 12px
---

## Brand & Style

This design system is built for high-stakes newsroom environments where speed, accuracy, and volume are paramount. The personality is **functionalist, authoritative, and invisible**—the UI recedes to prioritize the imagery and metadata. 

The aesthetic follows a **Corporate / Modern** approach with hints of **Systematic Minimalism**. It avoids decorative flourishes in favor of density and clarity. The experience should evoke a sense of professional mastery, allowing photo editors to navigate thousands of assets with zero cognitive friction. High information density is treated as a feature, not a flaw, organized through strict alignment and clear visual hierarchies.

## Colors

The palette is designed to maintain neutral color perception while editing images. 
- **Primary (Deep Slate):** Used for persistent navigation, headers, and text to provide a grounded, high-contrast framework.
- **Secondary (Workspace White):** A clean, slightly cool white used for the main stage and panels to minimize eye strain during long shifts.
- **Accent (Electric Blue):** Reserved strictly for primary actions, active selection states, and critical "Publish" workflows.
- **Neutral (Slate Gray):** Used for metadata labels, borders, and secondary icons to create a clear distinction between content and interface.

The system utilizes a 10-step tonal scale for the neutral palette to manage subtle depth changes in complex panel layouts.

## Typography

Typography is systematic and utility-first. **Inter** is the workhorse, providing maximum legibility at small sizes for captions and descriptions. **JetBrains Mono** is introduced specifically for technical metadata (EXIF data, file paths, dimensions) to help editors distinguish between editorial content and technical specifications at a glance.

- Use `label-caps` for section headers in sidebars and metadata panels.
- Use `mono-data` for all numeric and technical file information.
- Scale: Typography remains consistent across devices, but line-height is tightened in the "Compact" view mode to increase information density.

## Layout & Spacing

The layout utilizes a **hybrid fluid-fixed model**. The sidebars (Navigation and Metadata) are fixed-width to maintain consistent control layouts, while the central asset grid is fluid, utilizing a dynamic CSS Grid to maximize screen real estate.

**Breakpoints:**
- **Desktop (1440px+):** Tri-pane view (Nav + Grid + Metadata) always visible.
- **Tablet (1024px):** Metadata panel becomes a temporary overlay or "slide-over" to preserve grid visibility.
- **Mobile (768px and below):** Single-column stack with simplified "Action Bar" at the bottom.

The system uses a **4px base unit**. All spacing, margins, and padding must be multiples of 4 (e.g., 8px, 12px, 16px, 24px) to ensure a tight, professional rhythm.

## Elevation & Depth

This system avoids heavy shadows to maximize the focus on image color and contrast. Depth is communicated primarily through **Tonal Layers** and **Low-Contrast Outlines**:

- **Level 0 (Background):** `#F8FAFC` - The main canvas for the image grid.
- **Level 1 (Sidebars):** `#FFFFFF` - Raised slightly via a 1px border (`#E2E8F0`) rather than a shadow.
- **Level 2 (Overlays/Modals):** Pure white with a 1px border and a very subtle, large-radius ambient shadow (0px 10px 15px rgba(0,0,0,0.05)) to suggest floating.
- **Active State:** Selected assets use a 3px `primary_color` stroke rather than a shadow to ensure clear visibility against both light and dark images.

## Shapes

The design uses a **Soft (0.25rem)** shape language. This provides a subtle modern feel without the playfulness of highly rounded "pill" shapes. 

- **Assets/Thumbnails:** 4px radius.
- **Buttons & Inputs:** 4px radius.
- **Tags/Chips:** 2px radius (near-sharp) to emphasize the "technical tool" nature of the application.
- **Context Menus:** 6px radius to distinguish them from the underlying grid elements.

## Components

### Buttons & Inputs
- **Primary Action:** Solid `tertiary_color_hex` with white text. 
- **Search Bar:** Large, persistent top-bar input. Use a "Command-K" indicator icon. Background should be a subtle gray (`#F1F5F9`) until focused, then white with a blue border.
- **Input Fields:** Minimalist with 1px borders. Use `label-caps` for field labels placed above the input.

### Asset Grid
- **Thumbnails:** Must support variable aspect ratios (Masonry) or cropped squares. Hover state reveals quick-action icons (Star, Select, Download) in the corners.
- **Selection:** Use a heavy blue border and a checkbox in the top-left corner of the asset.

### Metadata Panels
- **Keyboard Friendly:** Every field should be reachable via `Tab`. Use "Quick-tags" that can be applied with a single click or a number key shortcut.
- **Lists:** Dense vertical lists with 8px of vertical padding between items.

### Special Components
- **Command Palette:** A centered modal triggered by `Cmd+K` for rapid navigation, bulk tagging, and status changes.
- **Timeline Slider:** A specialized horizontal scrollbar at the bottom of the grid for scrubbing through assets by date.