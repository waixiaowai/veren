# Image generation skill

Generates or edits images for the current project (for example website assets, game assets, UI mockups, product mockups, wireframes, logo design, photorealistic images, or infographics) through two model tools:

- `imagegen__generate` — create a new raster image from a prompt, optionally from reference descriptions, and save it into the workspace.
- `imagegen__edit` — transform existing image files (inpainting, background replacement, object removal, compositing, restyling) and save the result into the workspace.

Both tools return the saved file path plus the image itself, so you can inspect your own output before declaring the work done.

## Top-level rules

- One call produces exactly one image. Produce many assets or variants by issuing one call per asset with a distinct, fully-specified prompt. Do not use one vague prompt hoping variants will cover it — separate assets need separate prompts.
- Every call is a paid API call. Iterate at `quality: low`; escalate to `medium` or `high` only for the final asset, dense text, diagrams, identity-sensitive edits, or high-resolution output.
- The plugin is gated by deployment config. When a call returns `IMAGEGEN_DISABLED`, tell the user image generation is disabled and how to enable it; never retry repeatedly.
- When a call returns `IMAGEGEN_NO_KEY`, point the user at the imagegen sign-in flow instead of retrying.
- Generated images land in the workspace (project-bound) or at a preview path. Name meaningful files yourself via `output_path` (`hero.png`, `item-icon.png`); a colliding name automatically derives `hero-v2.png` — existing assets are never overwritten unless the user explicitly asked for replacement.

## When to use

- Generate a new image (concept art, product shot, cover, website hero)
- Generate a new image using one or more reference images for style, composition, or mood
- Edit an existing image (inpainting, lighting or weather transformations, background replacement, object removal, compositing, transparent background)
- Produce many assets or variants for one task

## When not to use

- Extending or matching an existing SVG/vector icon set, logo system, or illustration library inside the repo — edit those sources directly
- Creating simple shapes, diagrams, wireframes, or icons better produced directly in SVG, HTML/CSS, or canvas
- Making a small project-local asset edit when the source file already exists in an editable native format
- Any task where the user clearly wants deterministic code-native output instead of a generated bitmap

## Decision tree

Think about two separate questions:

1. **Intent:** is this a new image or an edit of an existing image?
2. **Execution strategy:** is this one asset or many assets/variants?

Intent:
- If the user wants to modify an existing image while preserving parts of it, treat the request as **edit**.
- If the user provides images only as references for style, composition, mood, or subject guidance, treat the request as **generate**.
- If the user provides no images, treat the request as **generate**.
- Assume the user wants a new image unless they clearly ask to change an existing one.

Execution strategy:
- Many variants of one prompt → repeat the same call with small prompt deltas.
- Many distinct assets → one call per asset, each with its own complete prompt.

## Workflow

1. Decide the intent: `generate` or `edit`.
2. Decide whether the output is preview-only or meant to be consumed by the current project.
3. Decide the execution strategy: single asset vs repeated calls.
4. Collect inputs up front: prompt(s), exact text (verbatim), constraints/avoid list, and any input image paths for edits.
5. For every input image, label its role explicitly: edit target, style reference, or supporting insert/compositing input.
6. If the user asked for a photo, illustration, sprite, product image, banner, or other explicitly raster-style asset, use these tools rather than substituting SVG/HTML/CSS placeholders. If the request is for an icon, logo, or UI graphic that should match existing repo-native SVG/vector/code assets, prefer editing those directly instead.
7. Augment the prompt based on specificity (see the augmentation policy below).
8. Call the tool with the composed prompt, a meaningful `output_path`, and (for edits) the workspace paths of the input images.
9. Inspect the returned image and validate: subject, style, composition, text accuracy, and invariants/avoid items.
10. Iterate with a single targeted change, then re-check.
11. For project-bound work, update any consuming code or references to the saved path. Never leave a project-referenced asset unnamed at the default timestamped path.
12. Always report the final saved path(s), the final prompt or prompt set, and the model used.

## Transparent image requests

Two paths, decided by the configured model's capability:

1. **Model supports true transparency** (e.g. `gpt-image-1.5`/`gpt-image-1`): pass `background: 'transparent'` with `png` or `webp` output and ask the model for an isolated subject on nothing. Real alpha comes back directly.
2. **Model refuses true alpha** (`gpt-image-2` rejects transparent backgrounds; asking returns `IMAGEGEN_TRANSPARENCY_UNSUPPORTED`): the chroma workflow — prompt for the subject on a flat key-color background (classic chroma green `#00ff00` or magenta `#ff00ff`; pick a color far from the subject's palette, and state the flat backdrop in the prompt), then pass `chroma_key` with that same color; the tool converts it to a real alpha channel and forces PNG output.

Either way, inspect the result for halo, leftover spill, or half-transparent edges before delivering. For `background-extraction` edits, preserve fine edges and label text; no halos, no restyling.

## Prompt augmentation

Reformat user prompts into a structured, production-oriented spec. Make the user's goal clearer and more actionable, but do not blindly add detail.

Treat this as prompt-shaping guidance, not a closed schema. Use only the lines that help, and add a short extra labeled line when it materially improves clarity.

### Specificity policy

- If the prompt is already specific and detailed, preserve that specificity and only normalize/structure it.
- If the prompt is generic, you may add tasteful augmentation when it will materially improve the result.

Allowed augmentations:
- composition or framing hints
- polish level or intended-use hints
- practical layout guidance
- reasonable scene concreteness that supports the stated request

Not allowed augmentations:
- extra characters or objects that are not implied by the request
- brand names, slogans, palettes, or narrative beats that are not implied
- arbitrary side-specific placement unless the surrounding layout supports it

## Use-case taxonomy (exact slugs)

Classify each request into one of these buckets and keep the slug consistent across prompts and iterations.

Generate:
- photorealistic-natural — candid/editorial lifestyle scenes with real texture and natural lighting.
- product-mockup — product/packaging shots, catalog imagery, merch concepts.
- ui-mockup — app/web interface mockups and wireframes; specify the desired fidelity.
- infographic-diagram — diagrams/infographics with structured layout and text.
- scientific-educational — classroom explainers, scientific diagrams, and learning visuals with required labels and accuracy constraints.
- ads-marketing — campaign concepts and ad creatives with audience, brand position, scene, and exact tagline/copy.
- productivity-visual — slide, chart, workflow, and data-heavy business visuals.
- logo-brand — logo/mark exploration, vector-friendly.
- illustration-story — comics, children's book art, narrative scenes.
- stylized-concept — style-driven concept art, 3D/stylized renders.
- historical-scene — period-accurate/world-knowledge scenes.

Edit:
- text-localization — translate/replace in-image text, preserve layout.
- identity-preserve — try-on, person-in-scene; lock face/body/pose.
- precise-object-edit — remove/replace a specific element (including interior swaps).
- lighting-weather — time-of-day/season/atmosphere changes only.
- background-extraction — transparent background / clean cutout (model-supported `background: 'transparent'` first; chroma workflow otherwise — see Transparent image requests).
- style-transfer — apply reference style while changing subject/scene.
- compositing — multi-image insert/merge with matched lighting/perspective.
- sketch-to-render — drawing/line art to photoreal render.

## Shared prompt schema

Use this labeled spec as prompt scaffolding:

```text
Use case: <taxonomy slug>
Asset type: <where the asset will be used>
Primary request: <user's main prompt>
Input images: <Image 1: role; Image 2: role> (optional)
Scene/backdrop: <environment>
Subject: <main subject>
Style/medium: <photo/illustration/3D/etc>
Composition/framing: <wide/close/top-down; placement>
Lighting/mood: <lighting + mood>
Color palette: <palette notes>
Materials/textures: <surface details>
Text (verbatim): "<exact text>"
Constraints: <must keep/must avoid>
Avoid: <negative constraints>
```

Notes:
- `Asset type` and `Input images` are prompt scaffolding; the tools take `input_paths` for edit targets and the mask separately.
- Quality, size, and format are tool parameters (`quality`, `size`, `output_format`), not prompt lines.

Augmentation rules:
- Keep it short.
- Add only the details needed to improve the prompt materially.
- For edits, explicitly list invariants (`change only X; keep Y unchanged`).
- If any critical detail is missing and blocks success, ask a question; otherwise proceed.

## Examples

### Generation example (hero image)
```text
Use case: product-mockup
Asset type: landing page hero
Primary request: a minimal hero image of a ceramic coffee mug
Style/medium: clean product photography
Composition/framing: wide composition with usable negative space for page copy if needed
Lighting/mood: soft studio lighting
Constraints: no logos, no text, no watermark
```

### Edit example (invariants)
```text
Use case: precise-object-edit
Asset type: product photo background replacement
Primary request: replace only the background with a warm sunset gradient
Constraints: change only the background; keep the product and its edges unchanged; no text; no watermark
```

## Prompting best practices

- Structure prompt as scene/backdrop -> subject -> details -> constraints.
- Include intended use (ad, UI mock, infographic) to set the mode and polish level.
- Use camera/composition language for photorealism.
- Only use SVG/vector stand-ins when the user explicitly asked for vector output or a non-image placeholder.
- Quote exact text and specify typography + placement.
- For tricky words, spell them letter-by-letter and require verbatim rendering.
- For multi-image inputs, reference images by index and describe how they should be used.
- For edits, repeat invariants every iteration to reduce drift.
- Iterate with single-change follow-ups.
- For sizes: `1024x1024` is the fast square draft; final assets match the target placement; the model matrix (edge limits, 16px multiples, aspect ratio) is validated up front — on `IMAGEGEN_SIZE_INVALID`, fix the size rather than retrying blind.

## Deeper guidance by asset type

Per-slug prompting tips (photorealism language, mockup discipline, infographic layout, edit invariants) live in `references/prompting.md`; copy/paste prompt recipes for website assets, game assets, wireframes, and logos live in `references/sample-prompts.md`. Read them when the request matches one of those shapes instead of improvising.
