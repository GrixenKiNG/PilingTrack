# DESIGN.md: ORION — Longbow-inspired concept

## Source
- URL: https://db-longbow.webflow.io/
- Capture date: 2026-07-19
- Evidence: live DOM snapshot, computed styles, page asset inventory, section dimensions and visible content.

## Design Summary
A cinematic, editorial industrial website built as a sequence of full-viewport scenes. The reference combines restrained grey surfaces, white typography, serif emotional headlines, mono technical labels, short looping media, numbered manifesto sections, kinetic text and sparse navigation. ORION adapts these principles to piling and foundation engineering without copying Longbow assets, logos, wording or code.

## Observed Design Tokens
### Colors
- Main atmospheric background: rgb(136,140,143), medium metallic grey.
- Foreground: white.
- Supporting dark: near-black overlays.
- ORION adaptation accent: #D8FF35 for selected technical states and CTA only.

### Typography
- Reference body/labels: Geist Mono, approximately 12.4 px.
- Reference headings: EB Garamond Variable, weight 400.
- ORION adaptation: EB Garamond with Cyrillic fallback Georgia; Geist Mono with Consolas fallback.
- Editorial display scale: 64–150 px desktop, 44–72 px mobile.

### Spacing and layout
- Fullscreen narrative sections: observed 700–710 px at the inspected viewport.
- Large scenes: 1080 px; sticky narrative scene: 1442 px.
- Sparse chrome, wide negative space and edge-aligned technical metadata.
- Sharp shapes, almost no card radius, hairline borders.

## Components
- Loading curtain with typographic mark.
- Fixed transparent navigation and compact menu trigger.
- Fullscreen hero media with centered serif statement.
- Two model/service portals with hover media transition.
- Numbered editorial manifesto (.01–.03).
- Sticky image/statement scenes.
- Kinetic marquee.
- Technical fleet selector with crossfade.
- Minimal footer/contact scene.

## Motion
- Loader wipe and letter reveal.
- Background media push/zoom.
- Line-by-line heading reveal.
- IntersectionObserver section reveal.
- Image parallax constrained to small ranges.
- Hover crossfade on model/service portals.
- Continuous marquee.
- No scroll-jacking; reduced-motion removes nonessential animation.

## ORION Build Instructions
- Use only ORION-owned/local equipment media in the prototype.
- Describe M-12, HSR, factories and wind farms only as target sectors until participation is verified.
- Keep all controls at least 44 px, preserve keyboard navigation and visible focus.
- Use CSS motion first. Keep JavaScript for fleet state, keyboard input and scroll progress.
- Maintain the reference rhythm while producing an independent ORION identity.

## Rerun Inputs
workflow: firecrawl-website-design-clone
source_url: https://db-longbow.webflow.io/
target_stack: standalone HTML concept, later Next.js 16 / React 19
output: docs/design/orion-longbow-inspired-design.md
