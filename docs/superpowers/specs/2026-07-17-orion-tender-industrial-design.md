# ORION Tender-First Industrial Cinematic Design

**Status:** Approved by the user on 2026-07-17.

## Objective

Turn the ORION public site into a procurement-grade foundation-construction website that creates confidence for major general contractors while preserving the approved Industrial Cinematic art direction.

## Audience and primary decision

Primary audience: general contractors, technical customers, procurement teams, chief project engineers, and infrastructure developers.

The site must answer five questions in the first two screens:

1. What scope does ORION perform?
2. Is the company ready for a large contract?
3. What verified equipment is available?
4. How is production controlled?
5. How can a technical customer start qualification quickly?

## Evidence policy

- Never publish invented project outcomes, dates, volumes, clients, certifications, availability, prices, or equipment specifications.
- Equipment specifications must remain tied to a named source and a downloadable Russian-language PDF card.
- External photographs are model references, not proof that the pictured machine belongs to ORION.
- Named project stories stay unpublished until ORION supplies real photographs and verified project facts.
- Cost is explained through pricing factors; the site does not show fabricated fixed prices or discounts.
- Claims such as 24/7 support, nationwide coverage, own laboratory, safety certification, or guaranteed deadlines remain absent unless documented.

## Research synthesis

### Russian benchmark patterns

- Mostopora: technical documentation, FAQ, calculators, detailed fleet, project filters, live production visibility, and a digital foreman.
- Novateh: clear service taxonomy, technology stages, geography, cost factors, galleries, and named engineering contact.
- Sideks: broad service and equipment catalog, repair/laboratory positioning, but excessive SEO copy and promotional price claims reduce premium trust.

### Global benchmark patterns

- Keller: searchable project evidence, lifecycle framing, global engineering capability expressed locally, and technique/market/solution structure.
- Soletanche Bachy: filtered references, full geotechnical lifecycle, local teams backed by global competence, and expert consultation.
- Bauer: method-led navigation, equipment references, digital production systems, and innovation proof.

### Adopted model

The ORION design combines:
- Mostopora-style document readiness and production transparency.
- Novateh-style process and technology explanation.
- Keller/Soletanche-style evidence hierarchy and consultation CTA.
- Bauer-style equipment and digital-control credibility.
- A restrained cinematic visual language instead of an SEO catalog.

## Information architecture

1. Header: company mark, compact navigation, engineering CTA.
2. Hero: specialization, procurement-grade promise, two CTAs.
3. Qualification proof: only verified facts (8 fleet units, PPR/project workflow, crew-operated rental).
4. Engineering matrix: customer task -> technology -> equipment -> control evidence.
5. Fleet: featured Bauer RTG RM20 followed by all eight units, five sourced photographs per unit, verified profiles, PDFs, and original sources.
6. Tender readiness: document set, mobilization input, quality/safety evidence boundaries, and the exact inputs required from the customer.
7. Digital control: PilingTrack expressed as a customer-facing evidence layer, without unsupported telemetry claims.
8. Project stories: honest empty state reserved for future verified case histories.
9. Process: five steps from source data to documentation.
10. Engineering request: working form, direct contacts, requisites, recovery state.
11. Footer: legal identity, contacts, privacy/data note, and return navigation.

## Visual system

Direction: **Tender-First Industrial Cinematic**.

- Background: near-black graphite, not pure black.
- Light evidence sections: warm engineering paper.
- Accent: restrained construction amber for actions and verified markers.
- Secondary accent: cold technical blue for digital-control evidence.
- Typography: dramatic condensed display hierarchy with readable serif/sans body treatment already present in the project.
- Geometry: sharp edges, one-pixel engineering rules, asymmetric editorial grids, no generic SaaS cards.
- Photography: full-bleed machinery, controlled scrims, visible source attribution.
- Motion: subtle reveal and parallax only when reduced motion is not requested.

## Accessibility and interaction

- WCAG AA text contrast.
- Every interactive target is at least 44 by 44 CSS pixels.
- Visible focus state for keyboard users.
- Mobile navigation closes on selection and Escape.
- Form states: idle, sending, sent, error, and disabled.
- Galleries use buttons with aria-pressed.
- Profile disclosures use aria-expanded, aria-controls, and labelled regions.
- No horizontal overflow at 375px.
- Reduced-motion media query disables decorative motion.

## Content rules

Approved facts:
- Eight fleet units listed in the project data.
- Eighth unit: Bauer RTG RM20.
- Rental with crew/operator.
- Work according to project and PPR.
- Existing requisites and contact details in the project.
- Six equipment profile types with sourced Russian PDF cards.

Unverified until supplied:
- Named clients.
- Named project outcomes.
- Work volumes and dates.
- Geographic coverage.
- Certifications, laboratory, repair base, response SLA, or 24/7 operation.

## Success criteria

- The live /orion route follows the approved evidence hierarchy.
- Major-contract trust is visible before the first long scroll.
- No named fictional or unverified case story is presented as proof.
- All eight units remain accessible with five source-linked photographs and technical passports.
- The lead form still reaches /api/orion/lead and communicates success/failure accessibly.
- Desktop, tablet, and 375px mobile layouts render without horizontal scrolling.
- Focus, touch targets, semantic landmarks, and reduced motion pass manual review.
- Focused tests and production build pass.

