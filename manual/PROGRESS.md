# Manual documentation progress

Each selector that [SelectorCompiler.ts](../ts/css/SelectorCompiler.ts) accepts, and each property, at-rule, and descriptor in [CssDefinitions.ts](../ts/css/generated/CssDefinitions.ts) and each CSSMedia property in [PropertyTable.ts](../ts/css/PropertyTable.ts) has its own line. Descriptors are written as `@rule / name`. Headings group lines for reading only; a status belongs to one line and is never inherited.

An item is documented when a table row in a DITA topic of the manual ([CSSMedia.ditamap](CSSMedia.ditamap)) names it and defines it in another column or links to its specification. A name that only appears in an example or in passing is not documented.

- `[x]` This item is documented. Its grammar acceptance, computed-value path, downstream consumers, and PDF applicability have each been checked for this item alone, and the code does what the topic says.
- `[~]` This item is documented, but at least one of those checks has not been done for this item alone, or it found that the code does not do what the topic says.
- `[ ]` This item is not documented.

The inventory has 113 selectors, 784 properties, 41 at-rules, and 104 descriptors.

The inventory follows the code. When a selector, property, at-rule, or descriptor is added to or removed from the code, its line is added to or removed from this file.

## At-rules

- [x] @bottom-center
- [x] @bottom-left
- [x] @bottom-left-corner
- [x] @bottom-right
- [x] @bottom-right-corner
- [x] @charset
- [ ] @color-profile
- [x] @container
- [x] @counter-style
- [x] @custom-media
- [x] @else
- [x] @font-face
- [x] @font-feature-values
- [x] @font-palette-values
- [x] @footnote
- [x] @function
- [x] @import
- [ ] @keyframes
- [x] @layer
- [x] @left-bottom
- [x] @left-middle
- [x] @left-top
- [x] @media
- [x] @page
- [ ] @position-try
- [x] @property
- [x] @right-bottom
- [x] @right-middle
- [x] @right-top
- [x] @scope
- [ ] @starting-style
- [x] @supports
- [x] @supports-condition
- [x] @top-center
- [x] @top-left
- [x] @top-left-corner
- [x] @top-right
- [x] @top-right-corner
- [ ] @view-transition
- [ ] @viewport
- [x] @when

## Descriptors

### @color-profile

- [ ] @color-profile / components
- [ ] @color-profile / rendering-intent
- [ ] @color-profile / src

### @container

- [ ] @container / aspect-ratio
- [ ] @container / block-size
- [ ] @container / fallback
- [ ] @container / height
- [ ] @container / inline-size
- [ ] @container / orientation
- [ ] @container / scrollable
- [ ] @container / scrolled
- [ ] @container / snapped
- [ ] @container / stuck
- [ ] @container / width

### @counter-style

- [x] @counter-style / additive-symbols
- [x] @counter-style / fallback
- [x] @counter-style / negative
- [x] @counter-style / pad
- [x] @counter-style / prefix
- [x] @counter-style / range
- [ ] @counter-style / speak-as
- [x] @counter-style / suffix
- [x] @counter-style / symbols
- [x] @counter-style / system

### @font-face

- [x] @font-face / ascent-override
- [x] @font-face / descent-override
- [x] @font-face / font-family
- [x] @font-face / font-feature-settings
- [x] @font-face / font-language-override
- [x] @font-face / font-named-instance
- [x] @font-face / font-size
- [x] @font-face / font-style
- [x] @font-face / font-variation-settings
- [x] @font-face / font-weight
- [x] @font-face / font-width
- [x] @font-face / line-gap-override
- [x] @font-face / size-adjust
- [x] @font-face / src
- [x] @font-face / subscript-position-override
- [x] @font-face / subscript-size-override
- [x] @font-face / superscript-position-override
- [x] @font-face / superscript-size-override
- [x] @font-face / unicode-range

### @font-feature-values

- [x] @font-feature-values / @annotation
- [x] @font-feature-values / @character-variant
- [x] @font-feature-values / @historical-forms
- [x] @font-feature-values / @ornaments
- [x] @font-feature-values / @styleset
- [x] @font-feature-values / @stylistic
- [x] @font-feature-values / @swash

### @font-palette-values

- [x] @font-palette-values / base-palette
- [x] @font-palette-values / font-family
- [x] @font-palette-values / override-colors

### @function

- [x] @function / result

### @media

- [x] @media / any-hover
- [x] @media / any-pointer
- [x] @media / aspect-ratio
- [x] @media / color
- [x] @media / color-gamut
- [x] @media / color-index
- [x] @media / device-aspect-ratio
- [x] @media / device-height
- [x] @media / device-width
- [x] @media / display-mode
- [ ] @media / display-state
- [x] @media / dynamic-range
- [x] @media / environment-blending
- [x] @media / forced-colors
- [x] @media / grid
- [x] @media / height
- [x] @media / horizontal-viewport-segments
- [x] @media / hover
- [x] @media / inverted-colors
- [x] @media / monochrome
- [x] @media / nav-controls
- [x] @media / orientation
- [x] @media / overflow-block
- [x] @media / overflow-inline
- [x] @media / pointer
- [x] @media / prefers-color-scheme
- [x] @media / prefers-contrast
- [x] @media / prefers-reduced-data
- [x] @media / prefers-reduced-motion
- [x] @media / prefers-reduced-transparency
- [ ] @media / resizable
- [x] @media / resolution
- [x] @media / scan
- [x] @media / scripting
- [ ] @media / shape
- [x] @media / update
- [x] @media / vertical-viewport-segments
- [x] @media / video-color-gamut
- [x] @media / video-dynamic-range
- [x] @media / width

### @page

- [~] @page / bleed
- [~] @page / marks
- [~] @page / page-orientation
- [x] @page / size

### @property

- [x] @property / inherits
- [x] @property / initial-value
- [x] @property / syntax

### @view-transition

- [ ] @view-transition / navigation
- [ ] @view-transition / types

### @viewport

- [ ] @viewport / viewport-fit

## Selectors

Each selector, combinator, pseudo-class, and pseudo-element that [SelectorCompiler.ts](../ts/css/SelectorCompiler.ts) accepts has its own line. They are documented in the [selector reference](references/selector-reference.dita). For a selector, the checks are its grammar acceptance in the compiler and its matching in [SelectorMatcher.ts](../ts/pdf/SelectorMatcher.ts).

### Basic selectors

- [x] E
- [x] *
- [x] #id
- [x] .name
- [x] [attr]
- [x] [attr=value]
- [x] [attr~=value]
- [x] [attr|=value]
- [x] [attr^=value]
- [x] [attr$=value]
- [x] [attr*=value]
- [x] ns|E
- [x] &

### Combinators

- [x] A B
- [x] A > B
- [x] A + B
- [x] A ~ B
- [x] A || B
- [x] A /attr/ B

### Pseudo-classes

- [x] :root
- [x] :empty
- [x] :scope
- [x] :first-child
- [x] :last-child
- [x] :only-child
- [x] :first-of-type
- [x] :last-of-type
- [x] :only-of-type
- [x] :nth-child()
- [x] :nth-last-child()
- [x] :nth-of-type()
- [x] :nth-last-of-type()
- [x] :nth-col()
- [x] :nth-last-col()
- [x] :is()
- [x] :matches()
- [x] :where()
- [x] :not()
- [x] :has()
- [x] :lang()
- [x] :dir()
- [x] :link
- [x] :any-link
- [x] :local-link
- [x] :read-only
- [x] :defined
- [x] :hover
- [x] :active
- [x] :focus
- [x] :focus-visible
- [x] :focus-within
- [x] :interest-source
- [x] :interest-target
- [x] :visited
- [x] :target
- [x] :playing
- [x] :paused
- [x] :seeking
- [x] :buffering
- [x] :stalled
- [x] :muted
- [x] :volume-locked
- [x] :current
- [x] :current()
- [x] :past
- [x] :future
- [x] :open
- [x] :popover-open
- [x] :modal
- [x] :fullscreen
- [x] :picture-in-picture
- [x] :enabled
- [x] :disabled
- [x] :read-write
- [x] :placeholder-shown
- [x] :autofill
- [x] :default
- [x] :checked
- [x] :unchecked
- [x] :indeterminate
- [x] :blank
- [x] :valid
- [x] :invalid
- [x] :in-range
- [x] :out-of-range
- [x] :required
- [x] :optional
- [x] :user-valid
- [x] :user-invalid
- [x] :state()
- [x] :heading
- [x] :heading()

### Pseudo-elements

- [x] ::before
- [x] ::after
- [x] ::marker
- [x] ::before::marker
- [x] ::after::marker
- [x] ::first-line
- [x] ::first-letter
- [x] ::first-letter::prefix
- [x] ::first-letter::suffix
- [x] ::footnote-call
- [x] ::footnote-marker
- [x] ::selection
- [x] ::search-text
- [x] ::target-text
- [x] ::spelling-error
- [x] ::grammar-error
- [x] ::highlight()
- [x] ::placeholder
- [x] ::file-selector-button
- [x] ::details-content
- [x] ::backdrop

## Properties

### CSS Align 3 (css-align-3)

- [ ] align-content
- [ ] align-items
- [ ] align-self
- [ ] justify-content
- [ ] justify-items
- [ ] justify-self
- [ ] place-content
- [ ] place-items
- [ ] place-self

### CSS Anchor Positioning 1 (css-anchor-position-1)

- [ ] anchor-name
- [ ] anchor-scope
- [ ] position-anchor
- [ ] position-area
- [ ] position-try
- [ ] position-try-fallbacks
- [ ] position-try-order
- [ ] position-visibility

### CSS Animations 1 (css-animations-1)

- [ ] animation
- [ ] animation-delay
- [ ] animation-direction
- [ ] animation-fill-mode
- [ ] animation-iteration-count
- [ ] animation-name
- [ ] animation-play-state
- [ ] animation-timing-function

### CSS Animations 2 (css-animations-2)

- [ ] animation-composition
- [ ] animation-duration
- [ ] animation-timeline

### CSS Animation Triggers 1 (animation-triggers-1)

- [ ] animation-trigger
- [ ] event-trigger
- [ ] event-trigger-name
- [ ] event-trigger-source
- [ ] timeline-trigger
- [ ] timeline-trigger-activation-range
- [ ] timeline-trigger-activation-range-end
- [ ] timeline-trigger-activation-range-start
- [ ] timeline-trigger-active-range
- [ ] timeline-trigger-active-range-end
- [ ] timeline-trigger-active-range-start
- [ ] timeline-trigger-name
- [ ] timeline-trigger-range
- [ ] timeline-trigger-source
- [ ] trigger-scope

### Scroll-driven Animations 1 (scroll-animations-1)

- [ ] animation-range
- [ ] animation-range-end
- [ ] animation-range-start
- [ ] scroll-timeline
- [ ] scroll-timeline-axis
- [ ] scroll-timeline-name
- [ ] timeline-scope
- [ ] view-timeline
- [ ] view-timeline-axis
- [ ] view-timeline-inset
- [ ] view-timeline-name

### CSS Backgrounds 4 (css-backgrounds-4)

- [x] background
- [x] background-attachment
- [x] background-clip
- [x] background-color
- [x] background-image
- [x] background-origin
- [x] background-position
- [x] background-position-block
- [x] background-position-inline
- [x] background-position-x
- [x] background-position-y
- [x] background-repeat
- [x] background-repeat-block
- [x] background-repeat-inline
- [x] background-repeat-x
- [x] background-repeat-y
- [x] background-size
- [x] background-tbd

### Compositing 1 (compositing-1)

- [x] background-blend-mode
- [~] isolation
- [~] mix-blend-mode

### CSS Borders and Box Decorations 4 (css-borders-4)

- [ ] border
- [ ] border-block
- [ ] border-block-clip
- [ ] border-block-color
- [ ] border-block-end
- [ ] border-block-end-clip
- [ ] border-block-end-color
- [ ] border-block-end-radius
- [ ] border-block-end-style
- [ ] border-block-end-width
- [ ] border-block-start
- [ ] border-block-start-clip
- [ ] border-block-start-color
- [ ] border-block-start-radius
- [ ] border-block-start-style
- [ ] border-block-start-width
- [ ] border-block-style
- [ ] border-block-width
- [ ] border-bottom
- [ ] border-bottom-clip
- [ ] border-bottom-color
- [ ] border-bottom-left-radius
- [ ] border-bottom-radius
- [ ] border-bottom-right-radius
- [ ] border-bottom-style
- [ ] border-bottom-width
- [ ] border-clip
- [ ] border-color
- [ ] border-end-end-radius
- [ ] border-end-start-radius
- [ ] border-image
- [ ] border-image-outset
- [ ] border-image-repeat
- [ ] border-image-slice
- [ ] border-image-source
- [ ] border-image-width
- [ ] border-inline
- [ ] border-inline-clip
- [ ] border-inline-color
- [ ] border-inline-end
- [ ] border-inline-end-clip
- [ ] border-inline-end-color
- [ ] border-inline-end-radius
- [ ] border-inline-end-style
- [ ] border-inline-end-width
- [ ] border-inline-start
- [ ] border-inline-start-clip
- [ ] border-inline-start-color
- [ ] border-inline-start-radius
- [ ] border-inline-start-style
- [ ] border-inline-start-width
- [ ] border-inline-style
- [ ] border-inline-width
- [ ] border-left
- [ ] border-left-clip
- [ ] border-left-color
- [ ] border-left-radius
- [ ] border-left-style
- [ ] border-left-width
- [ ] border-limit
- [ ] border-radius
- [ ] border-right
- [ ] border-right-clip
- [ ] border-right-color
- [ ] border-right-radius
- [ ] border-right-style
- [ ] border-right-width
- [ ] border-shape
- [ ] border-start-end-radius
- [ ] border-start-start-radius
- [ ] border-style
- [ ] border-top
- [ ] border-top-clip
- [ ] border-top-color
- [ ] border-top-left-radius
- [ ] border-top-radius
- [ ] border-top-right-radius
- [ ] border-top-style
- [ ] border-top-width
- [ ] border-width
- [ ] box-shadow
- [ ] box-shadow-blur
- [ ] box-shadow-color
- [ ] box-shadow-offset
- [ ] box-shadow-position
- [ ] box-shadow-spread
- [ ] corner
- [ ] corner-block-end
- [ ] corner-block-end-shape
- [ ] corner-block-start
- [ ] corner-block-start-shape
- [ ] corner-bottom
- [ ] corner-bottom-left
- [ ] corner-bottom-left-shape
- [ ] corner-bottom-right
- [ ] corner-bottom-right-shape
- [ ] corner-bottom-shape
- [ ] corner-end-end
- [ ] corner-end-end-shape
- [ ] corner-end-start
- [ ] corner-end-start-shape
- [ ] corner-inline-end
- [ ] corner-inline-end-shape
- [ ] corner-inline-start
- [ ] corner-inline-start-shape
- [ ] corner-left
- [ ] corner-left-shape
- [ ] corner-right
- [ ] corner-right-shape
- [ ] corner-shape
- [ ] corner-start-end
- [ ] corner-start-end-shape
- [ ] corner-start-start
- [ ] corner-start-start-shape
- [ ] corner-top
- [ ] corner-top-left
- [ ] corner-top-left-shape
- [ ] corner-top-right
- [ ] corner-top-right-shape
- [ ] corner-top-shape

### CSS Round Display 1 (css-round-display-1)

- [ ] border-boundary
- [ ] shape-inside

### CSS Box Sizing 3 (css-sizing-3)

- [x] block-size
- [x] box-sizing
- [x] height
- [x] inline-size
- [x] max-block-size
- [x] max-height
- [x] max-inline-size
- [x] max-width
- [x] min-block-size
- [x] min-height
- [x] min-inline-size
- [x] min-width
- [x] width

### CSS Box Sizing 4 (css-sizing-4)

- [x] aspect-ratio
- [x] contain-intrinsic-block-size
- [x] contain-intrinsic-height
- [x] contain-intrinsic-inline-size
- [x] contain-intrinsic-size
- [x] contain-intrinsic-width
- [~] frame-sizing
- [x] max-size
- [~] min-intrinsic-sizing
- [x] min-size
- [x] size

### CSS Box Model 4 (css-box-4)

- [x] margin
- [x] margin-bottom
- [x] margin-left
- [x] margin-right
- [x] margin-top
- [~] margin-trim
- [x] padding
- [x] padding-bottom
- [x] padding-left
- [x] padding-right
- [x] padding-top

### CSS Logical Properties 1 (css-logical-1)

- [x] margin-block
- [x] margin-block-end
- [x] margin-block-start
- [x] margin-inline
- [x] margin-inline-end
- [x] margin-inline-start
- [x] padding-block
- [x] padding-block-end
- [x] padding-block-start
- [x] padding-inline
- [x] padding-inline-end
- [x] padding-inline-start

### CSS Fragmentation 4 (css-break-4)

- [ ] box-decoration-break
- [ ] break-after
- [ ] break-before
- [ ] break-inside
- [x] margin-break
- [ ] orphans
- [ ] widows

### CSS Positioned Layout 3 (css-position-3)

- [x] bottom
- [x] inset
- [x] inset-block
- [x] inset-block-end
- [x] inset-block-start
- [x] inset-inline
- [x] inset-inline-end
- [x] inset-inline-start
- [x] left
- [~] position
- [x] right
- [x] top

### CSS Positioned Layout 4 (css-position-4)

- [ ] overlay

### CSS 2 (CSS2)

- [ ] azimuth
- [ ] elevation
- [ ] page-break-after
- [ ] page-break-before
- [ ] page-break-inside
- [ ] pitch
- [ ] pitch-range
- [ ] play-during
- [ ] richness
- [ ] speak-header
- [ ] speak-numeral
- [ ] speak-punctuation
- [ ] speech-rate
- [ ] stress
- [ ] volume
- [x] z-index

### CSS Display 4 (css-display-4)

- [~] display
- [~] order
- [~] reading-flow
- [~] reading-order
- [~] visibility

### CSS Fonts 4 (css-fonts-4)

- [x] font
- [x] font-family
- [x] font-feature-settings
- [x] font-kerning
- [x] font-language-override
- [x] font-optical-sizing
- [x] font-palette
- [x] font-size
- [x] font-style
- [x] font-synthesis
- [x] font-synthesis-position
- [x] font-synthesis-small-caps
- [x] font-synthesis-style
- [x] font-synthesis-weight
- [x] font-variant
- [x] font-variant-alternates
- [x] font-variant-caps
- [x] font-variant-east-asian
- [x] font-variant-emoji
- [x] font-variant-ligatures
- [x] font-variant-numeric
- [x] font-variant-position
- [x] font-variation-settings
- [x] font-weight
- [x] font-width

### CSS Fonts 5 (css-fonts-5)

- [x] font-size-adjust

### CSS Inline Layout 3 (css-inline-3)

- [ ] alignment-baseline
- [ ] baseline-shift
- [ ] baseline-source
- [ ] dominant-baseline
- [ ] initial-letter
- [ ] initial-letter-align
- [ ] initial-letter-wrap
- [ ] inline-sizing
- [ ] line-fit-edge
- [x] line-height
- [ ] text-box
- [ ] text-box-edge
- [ ] text-box-trim
- [ ] vertical-align

### CSS Text 4 (css-text-4)

- [ ] hanging-punctuation
- [ ] hyphenate-character
- [ ] hyphenate-limit-chars
- [ ] hyphenate-limit-last
- [ ] hyphenate-limit-lines
- [ ] hyphenate-limit-zone
- [ ] hyphens
- [ ] letter-spacing
- [ ] line-break
- [ ] line-padding
- [ ] overflow-wrap
- [ ] tab-size
- [ ] text-align
- [ ] text-align-all
- [ ] text-align-last
- [ ] text-autospace
- [ ] text-group-align
- [ ] text-indent
- [ ] text-justify
- [ ] text-spacing
- [ ] text-spacing-trim
- [ ] text-transform
- [ ] text-wrap
- [ ] text-wrap-mode
- [ ] text-wrap-style
- [ ] white-space
- [ ] white-space-collapse
- [ ] white-space-trim
- [ ] word-break
- [ ] word-space-transform
- [ ] word-spacing
- [ ] wrap-after
- [ ] wrap-before
- [ ] wrap-inside

### CSS Text Decoration 4 (css-text-decor-4)

- [ ] text-decoration
- [ ] text-decoration-color
- [ ] text-decoration-line
- [ ] text-decoration-skip
- [ ] text-decoration-skip-box
- [ ] text-decoration-skip-ink
- [ ] text-decoration-skip-inset
- [ ] text-decoration-skip-self
- [ ] text-decoration-skip-spaces
- [ ] text-decoration-style
- [ ] text-decoration-thickness
- [ ] text-emphasis
- [ ] text-emphasis-color
- [ ] text-emphasis-position
- [ ] text-emphasis-skip
- [ ] text-emphasis-style
- [ ] text-shadow
- [ ] text-underline-offset
- [ ] text-underline-position

### CSS UI 3 (css-ui-3)

- [ ] text-overflow

### CSS Writing Modes 4 (css-writing-modes-4)

- [ ] direction
- [ ] glyph-orientation-vertical
- [ ] text-combine-upright
- [ ] text-orientation
- [ ] unicode-bidi
- [ ] writing-mode

### CSS Ruby 1 (css-ruby-1)

- [ ] ruby-align
- [ ] ruby-merge
- [ ] ruby-overhang
- [ ] ruby-position

### CSS Rhythmic Sizing 1 (css-rhythm-1)

- [ ] block-step
- [ ] block-step-align
- [ ] block-step-insert
- [ ] block-step-round
- [ ] block-step-size
- [ ] line-height-step

### CSS Line Grid 1 (css-line-grid-1)

- [ ] box-snap
- [ ] line-grid
- [ ] line-snap

### CSS Generated Content 3 (css-content-3)

- [x] bookmark-label
- [x] bookmark-level
- [x] bookmark-state
- [~] content
- [x] quotes
- [x] string-set

### CSS Lists 3 (css-lists-3)

- [x] counter-increment
- [x] counter-reset
- [x] counter-set
- [x] list-style
- [x] list-style-image
- [x] list-style-position
- [x] list-style-type
- [~] marker-side

### CSS Generated Content for Paged Media 3 (css-gcpm-3)

- [x] footnote-display
- [x] footnote-policy

### CSS Paged Media 3 (css-page-3)

- [x] page

### CSS Linked Parameters 1 (css-link-params-1)

- [~] link-parameters

### CSS Cascade 5 (css-cascade-5)

- [x] all

### CSS Containment 2 (css-contain-2)

- [ ] contain
- [ ] content-visibility

### CSS Conditional Rules 5 (css-conditional-5)

- [ ] container
- [ ] container-name
- [ ] container-type

### CSS Color 4 (css-color-4)

- [ ] color
- [ ] opacity

### CSS Color Adjustment 1 (css-color-adjust-1)

- [ ] color-adjust
- [ ] color-scheme
- [ ] forced-color-adjust
- [ ] print-color-adjust

### CSS Color HDR 1 (css-color-hdr-1)

- [ ] dynamic-range-limit

### CSS Images 3 (css-images-3)

- [ ] image-orientation
- [ ] image-rendering
- [ ] object-position

### CSS Images 4 (css-images-4)

- [ ] image-resolution
- [ ] object-fit

### CSS Image Animation 1 (css-image-animation-1)

- [ ] image-animation

### CSS Values 5 (css-values-5)

- [ ] interpolate-size

### CSS Masking 1 (css-masking-1)

- [ ] clip
- [ ] clip-path
- [ ] clip-rule
- [ ] mask
- [ ] mask-border
- [ ] mask-border-mode
- [ ] mask-border-outset
- [ ] mask-border-repeat
- [ ] mask-border-slice
- [ ] mask-border-source
- [ ] mask-border-width
- [ ] mask-clip
- [ ] mask-composite
- [ ] mask-image
- [ ] mask-mode
- [ ] mask-origin
- [ ] mask-position
- [ ] mask-repeat
- [ ] mask-size
- [ ] mask-type

### Filter Effects 1 (filter-effects-1)

- [ ] color-interpolation-filters
- [ ] filter
- [ ] flood-color
- [ ] flood-opacity
- [ ] lighting-color

### Fill and Stroke 3 (fill-stroke-3)

- [ ] fill
- [ ] fill-break
- [ ] fill-color
- [ ] fill-image
- [ ] fill-opacity
- [ ] fill-origin
- [ ] fill-position
- [ ] fill-repeat
- [ ] fill-rule
- [ ] fill-size
- [ ] stroke
- [ ] stroke-align
- [ ] stroke-break
- [ ] stroke-color
- [ ] stroke-dash-corner
- [ ] stroke-dash-justify
- [ ] stroke-dasharray
- [ ] stroke-dashoffset
- [ ] stroke-image
- [ ] stroke-linecap
- [ ] stroke-linejoin
- [ ] stroke-miterlimit
- [ ] stroke-opacity
- [ ] stroke-origin
- [ ] stroke-position
- [ ] stroke-repeat
- [ ] stroke-size
- [ ] stroke-width
- [ ] text-decoration-fill
- [ ] text-decoration-fill-break
- [ ] text-decoration-fill-color
- [ ] text-decoration-fill-image
- [ ] text-decoration-fill-opacity
- [ ] text-decoration-fill-origin
- [ ] text-decoration-fill-position
- [ ] text-decoration-fill-repeat
- [ ] text-decoration-fill-rule
- [ ] text-decoration-fill-size
- [ ] text-decoration-stroke
- [ ] text-decoration-stroke-align
- [ ] text-decoration-stroke-break
- [ ] text-decoration-stroke-color
- [ ] text-decoration-stroke-dash-corner
- [ ] text-decoration-stroke-dash-justify
- [ ] text-decoration-stroke-dasharray
- [ ] text-decoration-stroke-dashoffset
- [ ] text-decoration-stroke-image
- [ ] text-decoration-stroke-linecap
- [ ] text-decoration-stroke-linejoin
- [ ] text-decoration-stroke-miterlimit
- [ ] text-decoration-stroke-opacity
- [ ] text-decoration-stroke-origin
- [ ] text-decoration-stroke-position
- [ ] text-decoration-stroke-repeat
- [ ] text-decoration-stroke-size
- [ ] text-decoration-stroke-width
- [ ] text-emphasis-fill
- [ ] text-emphasis-fill-break
- [ ] text-emphasis-fill-color
- [ ] text-emphasis-fill-image
- [ ] text-emphasis-fill-opacity
- [ ] text-emphasis-fill-origin
- [ ] text-emphasis-fill-position
- [ ] text-emphasis-fill-repeat
- [ ] text-emphasis-fill-rule
- [ ] text-emphasis-fill-size
- [ ] text-emphasis-stroke
- [ ] text-emphasis-stroke-align
- [ ] text-emphasis-stroke-break
- [ ] text-emphasis-stroke-color
- [ ] text-emphasis-stroke-dash-corner
- [ ] text-emphasis-stroke-dash-justify
- [ ] text-emphasis-stroke-dasharray
- [ ] text-emphasis-stroke-dashoffset
- [ ] text-emphasis-stroke-image
- [ ] text-emphasis-stroke-linecap
- [ ] text-emphasis-stroke-linejoin
- [ ] text-emphasis-stroke-miterlimit
- [ ] text-emphasis-stroke-opacity
- [ ] text-emphasis-stroke-origin
- [ ] text-emphasis-stroke-position
- [ ] text-emphasis-stroke-repeat
- [ ] text-emphasis-stroke-size
- [ ] text-emphasis-stroke-width

### MathML Core (mathml-core)

- [ ] math-depth
- [ ] math-shift
- [ ] math-style

### Motion Path 1 (motion-1)

- [ ] offset
- [ ] offset-anchor
- [ ] offset-distance
- [ ] offset-path
- [ ] offset-position
- [ ] offset-rotate

### CSS Tables 3 (css-tables-3)

- [ ] border-collapse
- [ ] border-spacing
- [ ] caption-side
- [ ] empty-cells
- [ ] table-layout

### CSS Multi-column 2 (css-multicol-2)

- [ ] column-count
- [ ] column-fill
- [ ] column-span
- [ ] column-width
- [ ] columns

### CSS Gaps 1 (css-gaps-1)

- [ ] column-gap
- [ ] column-rule
- [ ] column-rule-break
- [ ] column-rule-color
- [ ] column-rule-inset
- [ ] column-rule-inset-cap
- [ ] column-rule-inset-cap-end
- [ ] column-rule-inset-cap-start
- [ ] column-rule-inset-end
- [ ] column-rule-inset-junction
- [ ] column-rule-inset-junction-end
- [ ] column-rule-inset-junction-start
- [ ] column-rule-inset-start
- [ ] column-rule-style
- [ ] column-rule-visibility-items
- [ ] column-rule-width
- [ ] gap
- [ ] row-gap
- [ ] row-rule
- [ ] row-rule-break
- [ ] row-rule-color
- [ ] row-rule-inset
- [ ] row-rule-inset-cap
- [ ] row-rule-inset-cap-end
- [ ] row-rule-inset-cap-start
- [ ] row-rule-inset-end
- [ ] row-rule-inset-junction
- [ ] row-rule-inset-junction-end
- [ ] row-rule-inset-junction-start
- [ ] row-rule-inset-start
- [ ] row-rule-style
- [ ] row-rule-visibility-items
- [ ] row-rule-width
- [ ] rule
- [ ] rule-break
- [ ] rule-color
- [ ] rule-inset
- [ ] rule-inset-cap
- [ ] rule-inset-end
- [ ] rule-inset-junction
- [ ] rule-inset-start
- [ ] rule-overlap
- [ ] rule-style
- [ ] rule-visibility-items
- [ ] rule-width

### CSS Flexbox 1 (css-flexbox-1)

- [ ] flex
- [ ] flex-basis
- [ ] flex-direction
- [ ] flex-flow
- [ ] flex-grow
- [ ] flex-shrink
- [ ] flex-wrap

### CSS Grid 2 (css-grid-2)

- [ ] grid
- [ ] grid-area
- [ ] grid-auto-columns
- [ ] grid-auto-flow
- [ ] grid-auto-rows
- [ ] grid-column
- [ ] grid-column-end
- [ ] grid-column-start
- [ ] grid-row
- [ ] grid-row-end
- [ ] grid-row-start
- [ ] grid-template
- [ ] grid-template-areas
- [ ] grid-template-columns
- [ ] grid-template-rows

### CSS Grid 3 (css-grid-3)

- [ ] flow-tolerance
- [ ] item-cross
- [ ] item-direction
- [ ] item-flow
- [ ] item-pack
- [ ] item-track
- [ ] item-wrap

### CSS Template Layout 3 (css-template-3)

- [ ] chains
- [ ] flow

### CSS Page Floats 3 (css-page-floats-3)

- [ ] clear
- [~] float
- [ ] float-defer
- [ ] float-offset
- [ ] float-reference

### CSS Exclusions (css3-exclusions)

- [ ] wrap-flow
- [ ] wrap-through

### CSS Shapes 1 (css-shapes-1)

- [ ] shape-image-threshold
- [ ] shape-margin
- [ ] shape-outside

### CSS Regions 1 (css-regions-1)

- [ ] flow-from
- [ ] flow-into
- [ ] region-fragment

### CSS Overflow 3 (css-overflow-3)

- [ ] overflow
- [ ] overflow-block
- [ ] overflow-inline
- [ ] overflow-x
- [ ] overflow-y
- [ ] scroll-behavior
- [ ] scrollbar-gutter

### CSS Overflow 4 (css-overflow-4)

- [ ] -webkit-line-clamp
- [ ] block-ellipsis
- [ ] continue
- [ ] line-clamp
- [ ] max-lines
- [ ] overflow-clip-margin
- [ ] overflow-clip-margin-block
- [ ] overflow-clip-margin-block-end
- [ ] overflow-clip-margin-block-start
- [ ] overflow-clip-margin-bottom
- [ ] overflow-clip-margin-inline
- [ ] overflow-clip-margin-inline-end
- [ ] overflow-clip-margin-inline-start
- [ ] overflow-clip-margin-left
- [ ] overflow-clip-margin-right
- [ ] overflow-clip-margin-top

### CSS Overflow 5 (css-overflow-5)

- [ ] scroll-marker-group

### CSS Scroll Anchoring 1 (css-scroll-anchoring-1)

- [ ] overflow-anchor

### CSS Overscroll Behavior 1 (css-overscroll-1)

- [ ] overscroll-behavior
- [ ] overscroll-behavior-block
- [ ] overscroll-behavior-inline
- [ ] overscroll-behavior-x
- [ ] overscroll-behavior-y

### CSS Scroll Snap 1 (css-scroll-snap-1)

- [ ] scroll-margin
- [ ] scroll-margin-block
- [ ] scroll-margin-block-end
- [ ] scroll-margin-block-start
- [ ] scroll-margin-bottom
- [ ] scroll-margin-inline
- [ ] scroll-margin-inline-end
- [ ] scroll-margin-inline-start
- [ ] scroll-margin-left
- [ ] scroll-margin-right
- [ ] scroll-margin-top
- [ ] scroll-padding
- [ ] scroll-padding-block
- [ ] scroll-padding-block-end
- [ ] scroll-padding-block-start
- [ ] scroll-padding-bottom
- [ ] scroll-padding-inline
- [ ] scroll-padding-inline-end
- [ ] scroll-padding-inline-start
- [ ] scroll-padding-left
- [ ] scroll-padding-right
- [ ] scroll-padding-top
- [ ] scroll-snap-align
- [ ] scroll-snap-stop
- [ ] scroll-snap-type

### CSS Scroll Snap 2 (css-scroll-snap-2)

- [ ] scroll-start-target

### CSS Scrollbars 1 (css-scrollbars-1)

- [ ] scrollbar-color
- [ ] scrollbar-width

### CSS Transforms 1 (css-transforms-1)

- [ ] transform
- [ ] transform-box
- [ ] transform-origin

### CSS Transforms 2 (css-transforms-2)

- [ ] backface-visibility
- [ ] perspective
- [ ] perspective-origin
- [ ] rotate
- [ ] scale
- [ ] transform-style
- [ ] translate

### CSS Transitions 1 (css-transitions-1)

- [ ] transition
- [ ] transition-delay
- [ ] transition-duration
- [ ] transition-property
- [ ] transition-timing-function

### CSS Transitions 2 (css-transitions-2)

- [ ] transition-behavior

### CSS View Transitions 1 (css-view-transitions-1)

- [ ] view-transition-name

### CSS View Transitions 2 (css-view-transitions-2)

- [ ] view-transition-class
- [ ] view-transition-group

### CSS Viewport 1 (css-viewport-1)

- [ ] zoom

### CSS Will Change 1 (css-will-change-1)

- [ ] will-change

### CSS Basic User Interface 4 (css-ui-4)

- [ ] accent-color
- [ ] appearance
- [ ] caret
- [ ] caret-animation
- [ ] caret-color
- [ ] caret-shape
- [ ] cursor
- [ ] interactivity
- [ ] interest-delay
- [ ] interest-delay-end
- [ ] interest-delay-start
- [ ] nav-down
- [ ] nav-left
- [ ] nav-right
- [ ] nav-up
- [ ] outline
- [ ] outline-color
- [ ] outline-offset
- [ ] outline-style
- [ ] outline-width
- [ ] pointer-events
- [ ] resize
- [ ] user-select

### CSS Forms 1 (css-forms-1)

- [ ] slider-orientation

### CSS Spatial Navigation 1 (css-nav-1)

- [ ] spatial-navigation-action
- [ ] spatial-navigation-contain
- [ ] spatial-navigation-function

### CSS Speech 1 (css-speech-1)

- [ ] cue
- [ ] cue-after
- [ ] cue-before
- [ ] pause
- [ ] pause-after
- [ ] pause-before
- [ ] rest
- [ ] rest-after
- [ ] rest-before
- [ ] speak
- [ ] speak-as
- [ ] voice-balance
- [ ] voice-duration
- [ ] voice-family
- [ ] voice-pitch
- [ ] voice-range
- [ ] voice-rate
- [ ] voice-stress
- [ ] voice-volume

### CSSMedia extensions

- [~] -cssmedia-lang
- [x] -cssmedia-link
- [x] -cssmedia-toc-depth
- [x] -cssmedia-toc-divider
- [x] -cssmedia-toc-label
- [x] -cssmedia-toc-leader
- [~] -cssmedia-toc-title
- [x] -cssmedia-toc()
- [x] -cssmedia-link-counter()
- [x] @-cssmedia-toc-title
- [x] @-cssmedia-toc-entry
- [x] @-cssmedia-toc-divider
