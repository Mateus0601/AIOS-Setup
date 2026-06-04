# Skill: Frontend & Design — Actionable Guide for FORGE

> Scope: any task that produces UI — landing pages, slides, web apps, components, dashboards, emails. Use alongside the `shadcn` and `magicui` MCPs for primitives.
> Absorbed from the decommissioned PRISM squad (2026-03-15). This is the rewrite that carries the user's REAL documented preferences.

## Non-negotiables (read first)
- **Premium, not merely functional.** Landings, slides and UI must look high-end. "Reveal.js dark + 2 accents" does NOT clear the bar. Strong visual hierarchy, generous spacing, purposeful micro-interactions.
- **pt-BR accents are mandatory** in EVERY user-visible string (ç, ã, õ, á, é, í, ó, ú, â, ê). No exceptions, ever.
- **Clone = pixel-perfect.** When asked to clone a page, the result is identical to the original. Do not change theme, colors, layout, copy or fonts.

## DO (mandatory, concrete)

### Typography
- Body text **12–13pt** (≈16–17px) for reading surfaces; never ship 11px/11pt body — it reads small and tiring.
- Line-height **1.6–1.7** for paragraphs; **1.1–1.2** for headings.
- Max 2 families: 1 display + 1 body (optionally 1 mono for code).
- For long-form reading use a real serif: **Crimson Pro, Source Serif, Charter, or EB Garamond at ≥12pt**.
- Define a modular scale (ratio 1.25 / 1.333 / 1.5) and reuse it — no arbitrary font sizes.

### Spacing system
- Pick ONE spacing unit (4px or 8px base) and snap every margin/padding/gap to multiples of it.
- Whitespace is a design element — be generous around hero, headings and section boundaries.
- Vary rhythm between sections (non-uniform vertical spacing); avoid one identical gap everywhere.

### Hierarchy
- One clear focal point per screen/section. Size, weight, color and position all reinforce the same priority.
- Controlled asymmetry beats predictable symmetry. Break the centered-everything default.
- Border-radius varied by context, not one global value on everything.

### Color
- 60-30-10 (dominant / secondary / accent). Max 1 primary + 1 secondary + 1 accent + derived neutrals.
- Customize the palette — never ship the raw default Tailwind/Bootstrap swatches.
- Use CSS custom properties (`--token`) for every color/spacing/radius value.

### Accessibility (baseline)
- Text contrast **≥ 4.5:1** (WCAG AA); large text ≥ 3:1.
- Visible `:focus-visible` state on every interactive element; never remove the outline without replacing it.
- Hit targets ≥ 44×44px on touch. Label every input (`<label for>` or `aria-label`).
- Every async action shows 3 states: loading, success, error.

### Interaction & motion
- Micro-interactions must have a functional reason (feedback, affordance, state change).
- Entrance animations ≤ 500ms, always with easing (never linear).
- Mobile-first: design the small screen first, enhance upward.

### Component hygiene
- 1 component = 1 responsibility. Composition over inheritance. Explicit typed props.
- Local state first; lift state only when sharing is required.
- Prefer pure CSS; reach for JS animation only when CSS genuinely cannot do it.

### Clone fidelity (when the task is "clone X")
- Reproduce theme, colors, layout, spacing, fonts and copy **exactly** as the original.
- Define EVERY CSS class the markup references — no undefined/empty classes.
- Copy real text from the source; never paraphrase or invent.
- Reload the rendered clone and compare against the original side-by-side before delivering.

### Tooling (MCPs available)
- Reach for **shadcn** (`mcp__shadcn__*`) for accessible primitives (dialog, form, select, tabs…) instead of hand-rolling.
- Reach for **magicui** (`mcp__magicui__*`) for polished animated components when a section needs visual lift.
- Verify a component/pattern already exists in the codebase before creating a new one.

## DON'T (anti-patterns — these change the output)
- **NEVER close a modal/dropdown/form on `mouseout` / `mouseleave`.** Recurring bug: the panel vanishes the moment the cursor leaves. Close only on explicit intent: backdrop click, close button, or `Escape`.
- **NEVER drop pt-BR accents** in any visible string.
- **NEVER alter theme/colors/layout/copy** when the task is to clone — and never leave CSS classes undefined.
- **NEVER use the default font set as primary:** Inter, Roboto, Arial, Open Sans, Poppins, Montserrat, Lato, Nunito, Outfit.
- **NEVER use the AI-cliché gradients:** purple→blue or purple→pink; no animated gradient backgrounds, floating blobs, or fade-in cascade on every element.
- **NEVER use pure #000 on pure #FFF** without intermediate neutrals.
- **NEVER ship lorem ipsum** — write real copy. Avoid filler CTAs: "Revolucione seu X", "Solução completa", "Leve ao próximo nível", "Junte-se a milhares", "Simples, rápido e fácil".
- **NEVER ship the generic AI layout verbatim** (centered hero → 3 icon cards → "how it works" steps → 3 testimonials → 3-col pricing → CTA+footer). Each section may exist, but reimagine sequence and presentation.
- **NEVER remove focus outlines** without an equivalent visible focus style.

## Checklist Pré-Entrega
- [ ] Body text 12–13pt, line-height 1.6–1.7; long-form uses a reading serif ≥12pt.
- [ ] Spacing snapped to a single 4/8px scale; rhythm varies between sections.
- [ ] Palette customized (not raw Tailwind defaults); all visual tokens via CSS variables.
- [ ] Text contrast ≥ 4.5:1; visible `:focus-visible` on every interactive element.
- [ ] No `mouseout`/`mouseleave` handler closes any modal/dropdown/form — close on backdrop, button or Escape only.
- [ ] Every pt-BR visible string has correct accents.
- [ ] Every async action shows loading / success / error.
- [ ] No AI-cliché gradient, no banned default font as primary, no pure black-on-white.
- [ ] Copy is real (no lorem ipsum, no filler CTAs); every CTA answers "why click?".
- [ ] If cloning: theme/colors/layout/fonts/copy match the original, all CSS classes defined, reload-compared side-by-side.
- [ ] Checked codebase/shadcn/magicui for an existing component before building a new one.
- [ ] Responsive verified mobile-first.
