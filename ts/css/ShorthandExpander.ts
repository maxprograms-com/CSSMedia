/*******************************************************************************
 * Copyright (c) 2026 Maxprograms. All rights reserved.
 *
 * Licensed under the Business Source License 1.1 (the "License");
 * you may not use this file except in compliance with the License.
 *
 * Change Date: 2030-11-01
 * Change License: Mozilla Public License, v. 2.0
 *
 * Additional Use Grant:
 * You may make production use of the Licensed Work for personal use,
 * educational use, and academic research. "Personal use" means use by an
 * individual for their own purposes, and not on behalf of an employer, client
 * or other organization. You may also make production use of the Licensed Work
 * for trial purposes for a period of up to 30 days.
 *
 * You may obtain a copy of the License at https://spdx.org/licenses/BUSL-1.1.html
 * or in the LICENSE file provided in the root of this repository.
 *******************************************************************************/

import type { CssNode, Value } from "css-tree";
import { generate, parse, walk } from "css-tree";
import type { PropertyTable } from "./PropertyTable.js";
import type { CssValue } from "./values/CssValue.js";
import { CssValueParser } from "./values/CssValueParser.js";

export interface MatchNode {
    syntax?: { type: string; name?: string } | null;
    node?: CssNode | null;
    match?: ReadonlyArray<MatchNode>;
}

export interface Longhand {
    property: string;
    value?: CssValue;
    nodes?: ReadonlyArray<CssNode>;
}

interface Segment {
    name: string;
    indices: Array<number>;
}

interface PositionComponent {
    edge?: string;
    offset?: CssValue;
}

type Four = readonly [string, string, string, string];

type Two = readonly [string, string];

type Expansion =
    | { kind: "box"; terms?: ReadonlyArray<string>; targets: Four }
    | { kind: "pair"; terms?: ReadonlyArray<string>; targets: Two }
    | { kind: "components"; terms: Readonly<Record<string, string>>; targets: ReadonlyArray<string> }
    | { kind: "sides"; terms: Readonly<Record<string, string>>; prefixes: ReadonlyArray<string>; resets: ReadonlyArray<string> }
    | { kind: "same"; targets: ReadonlyArray<string> }
    | { kind: "keywords"; target: string; values: Readonly<Record<string, string>> }
    | { kind: "special"; targets: ReadonlyArray<string> };

const LINE_TERMS: Readonly<Record<string, string>> = { "line-width": "-width", "line-style": "-style", "color": "-color" };

const FONT_VARIANT_LONGHANDS: ReadonlyArray<string> = [
    "font-variant-ligatures", "font-variant-position", "font-variant-caps", "font-variant-numeric", "font-variant-alternates", "font-variant-east-asian", "font-variant-emoji"
];

const FONT_RESET_ONLY: ReadonlyArray<string> = [
    "font-feature-settings", "font-kerning", "font-language-override", "font-optical-sizing", "font-size-adjust", "font-variation-settings", ...FONT_VARIANT_LONGHANDS
];

const FONT_SET: Readonly<Record<string, string>> = {
    "font-style": "font-style", "font-variant-css2": "font-variant-caps", "font-weight": "font-weight", "font-width-css3": "font-width",
    "font-size": "font-size", "line-height": "line-height", "font-family": "font-family"
};

const FONT_SYNTHESIS_LONGHANDS: ReadonlyArray<string> = ["font-synthesis-weight", "font-synthesis-style", "font-synthesis-small-caps", "font-synthesis-position"];

const WHITE_SPACE_LONGHANDS: ReadonlyArray<string> = ["white-space-collapse", "text-wrap-mode", "white-space-trim"];

const WHITE_SPACE_KEYWORDS: ReadonlyMap<string, ReadonlyArray<string>> = new Map<string, ReadonlyArray<string>>([
    ["normal", ["collapse", "wrap", "none"]], ["pre", ["preserve", "nowrap", "none"]],
    ["pre-wrap", ["preserve", "wrap", "none"]], ["pre-line", ["preserve-breaks", "wrap", "none"]]
]);

const BACKGROUND_TERMS: Readonly<Record<string, string>> = {
    "bg-image": "background-image", "bg-position": "background-position", "bg-size": "background-size", "repeat-style": "background-repeat", "attachment": "background-attachment"
};

const VISUAL_BOXES: ReadonlySet<string> = new Set<string>(["content-box", "padding-box", "border-box"]);

const BACKGROUND_LAYERED: ReadonlyArray<string> = ["background-image", "background-size", "background-attachment", "background-origin", "background-clip"];

const AXIS_SUFFIXES: ReadonlyArray<string> = ["-x", "-y", "-block", "-inline"];

const HORIZONTAL_EDGES: ReadonlySet<string> = new Set<string>(["left", "right", "x-start", "x-end"]);

const VERTICAL_EDGES: ReadonlySet<string> = new Set<string>(["top", "bottom", "y-start", "y-end"]);

const BLOCK_EDGES: ReadonlySet<string> = new Set<string>(["block-start", "block-end"]);

const INLINE_EDGES: ReadonlySet<string> = new Set<string>(["inline-start", "inline-end"]);

const FLOW_EDGES: ReadonlySet<string> = new Set<string>(["start", "end"]);

const BACKGROUND_LONGHANDS: ReadonlyArray<string> = [
    ...BACKGROUND_LAYERED, ...AXIS_SUFFIXES.map((suffix: string) => "background-position" + suffix), ...AXIS_SUFFIXES.map((suffix: string) => "background-repeat" + suffix),
    "background-color", "background-blend-mode"
];

const FILL_STROKE: string = "fill-stroke-3";

const PAINT_SUFFIXES: ReadonlyArray<string> = ["-image", "-position", "-size", "-repeat", "-origin", "-color"];

const PAINT_PREFIXES: ReadonlyArray<string> = ["", "text-decoration-", "text-emphasis-"];

const FILL: string = "fill";

const MASK_TERMS: Readonly<Record<string, string>> = {
    "mask-reference": "mask-image", "position": "mask-position", "bg-size": "mask-size", "repeat-style": "mask-repeat",
    "compositing-operator": "mask-composite", "masking-mode": "mask-mode"
};

const MASK_BORDER_LONGHANDS: ReadonlyArray<string> = [
    "mask-border-source", "mask-border-slice", "mask-border-width", "mask-border-outset", "mask-border-repeat", "mask-border-mode"
];

const MASK_LONGHANDS: ReadonlyArray<string> = ["mask-image", "mask-position", "mask-size", "mask-repeat", "mask-origin", "mask-clip", "mask-composite", "mask-mode"];

const DECORATION_SKIP_LONGHANDS: ReadonlyArray<string> = [
    "text-decoration-skip-self", "text-decoration-skip-box", "text-decoration-skip-inset", "text-decoration-skip-spaces", "text-decoration-skip-ink"
];

const RADIUS_CORNERS: Four = ["border-top-left-radius", "border-top-right-radius", "border-bottom-right-radius", "border-bottom-left-radius"];

const SHAPE_CORNERS: Four = ["corner-top-left-shape", "corner-top-right-shape", "corner-bottom-right-shape", "corner-bottom-left-shape"];

const SIDE_CORNERS: Readonly<Record<string, Two>> = {
    "top": ["top-left", "top-right"],
    "right": ["top-right", "bottom-right"],
    "bottom": ["bottom-left", "bottom-right"],
    "left": ["top-left", "bottom-left"],
    "block-start": ["start-start", "start-end"],
    "block-end": ["end-start", "end-end"],
    "inline-start": ["start-start", "end-start"],
    "inline-end": ["start-end", "end-end"]
};

const CORNERS: ReadonlyArray<string> = ["top-left", "top-right", "bottom-right", "bottom-left", "start-start", "start-end", "end-start", "end-end"];

const SHADOW_LONGHANDS: ReadonlyArray<string> = ["box-shadow-color", "box-shadow-offset", "box-shadow-blur", "box-shadow-spread", "box-shadow-position"];

const SHADOW_POSITIONS: ReadonlySet<string> = new Set<string>(["outset", "inset"]);

const GRID_TEMPLATE_LONGHANDS: ReadonlyArray<string> = ["grid-template-rows", "grid-template-columns", "grid-template-areas"];

const GRID_LONGHANDS: ReadonlyArray<string> = [...GRID_TEMPLATE_LONGHANDS, "grid-auto-rows", "grid-auto-columns", "grid-auto-flow"];

const ALL_EXCLUDED: ReadonlySet<string> = new Set<string>(["direction", "unicode-bidi"]);

const IGNORED: ReadonlySet<string> = new Set<string>([
    "animation", "transition", "animation-range", "scroll-timeline", "view-timeline", "scroll-margin", "scroll-margin-block", "scroll-margin-inline",
    "scroll-padding", "scroll-padding-block", "scroll-padding-inline", "overscroll-behavior", "scroll-start-target", "interest-delay", "caret", "cue", "pause", "rest"
]);

export class ShorthandExpander {

    private readonly table: PropertyTable;
    private readonly values: CssValueParser = new CssValueParser();
    private readonly initialValues: Map<string, CssValue> = new Map<string, CssValue>();
    private noInitial?: Set<string>;
    private readonly expansions: Map<string, Expansion> = this.buildExpansions();
    private readonly paints: Set<string> = new Set<string>();

    constructor(table: PropertyTable) {
        this.table = table;
        for (const [name, targets] of table.sameValueShorthands()) {
            this.expansions.set(name, { kind: "same", targets });
        }
        for (const prefix of PAINT_PREFIXES) {
            // CSS Fill and Stroke 3 makes fill and stroke shorthands, and §5 their text-decoration-* and text-emphasis-* copies;
            // SVG 2, whose definitions an SVG image reads, makes fill and stroke longhands.
            for (const name of [prefix + FILL, prefix + "stroke"]) {
                if (table.definition(name)?.spec === FILL_STROKE) {
                    this.expansions.set(name, { kind: "special", targets: PAINT_SUFFIXES.map((suffix: string) => name + suffix) });
                    this.paints.add(name);
                }
            }
        }
    }

    isShorthand(property: string): boolean {
        return property === "all" || this.expansions.has(property) || IGNORED.has(property);
    }

    isIgnored(property: string): boolean {
        return IGNORED.has(property);
    }

    longhands(property: string): ReadonlyArray<string> {
        if (property === "all") {
            // CSS Cascade 5 §3.2: all covers every property except direction, unicode-bidi and custom properties.
            return [...this.table.names()].filter((name: string) => !ALL_EXCLUDED.has(name) && !this.isShorthand(name));
        }
        return this.targets(property).flatMap((target: string) => this.expansions.has(target) ? this.longhands(target) : [target]);
    }

    expand(property: string, value: Value, matched: MatchNode): Array<Longhand> | undefined {
        // CSS Cascade 5 §3: a shorthand sets every longhand it covers, and omitted ones to their initial value;
        // a target that is itself a shorthand is expanded again from the nodes it received.
        const expansion: Expansion | undefined = this.expansions.get(property);
        if (expansion === undefined) {
            return undefined;
        }
        const top: Array<CssNode> = value.children.toArray();
        const indexOf: Map<CssNode, number> = this.topLevelIndex(top);
        switch (expansion.kind) {
            case "box":
                return this.expandBox(this.items(matched, indexOf, top, expansion.terms), top, expansion.targets);
            case "pair":
                return this.expandPair(this.items(matched, indexOf, top, expansion.terms), top, expansion.targets);
            case "components":
                return this.expandComponents(this.segments(matched, new Set<string>(Object.keys(expansion.terms)), indexOf), top, expansion.terms, expansion.targets);
            case "sides":
                return this.expandSides(this.segments(matched, new Set<string>(Object.keys(expansion.terms)), indexOf), top, expansion);
            case "same":
                return expansion.targets.map((target: string) => this.longhand(target, top));
            case "keywords": {
                const keyword: string | undefined = top.length === 1 ? generate(top[0]).toLowerCase() : undefined;
                const mapped: string | undefined = keyword === undefined ? undefined : expansion.values[keyword];
                return mapped === undefined ? undefined : [{ property: expansion.target, value: this.ident(mapped) }];
            }
            case "special":
                return this.expandSpecial(property, matched, top, indexOf);
        }
    }

    private targets(property: string): ReadonlyArray<string> {
        const expansion: Expansion | undefined = this.expansions.get(property);
        if (expansion === undefined) {
            return [];
        }
        switch (expansion.kind) {
            case "sides":
                return [...expansion.prefixes.flatMap((prefix: string) => Object.values(expansion.terms).map((suffix: string) => prefix + suffix)), ...expansion.resets];
            case "keywords":
                return [expansion.target];
            default:
                return expansion.targets;
        }
    }

    private buildExpansions(): Map<string, Expansion> {
        const expansions: Map<string, Expansion> = new Map<string, Expansion>([
            ["margin", { kind: "box", terms: ["margin-top"], targets: ["margin-top", "margin-right", "margin-bottom", "margin-left"] }],
            ["padding", { kind: "box", terms: ["padding-top"], targets: ["padding-top", "padding-right", "padding-bottom", "padding-left"] }],
            ["inset", { kind: "box", terms: ["top"], targets: ["top", "right", "bottom", "left"] }],
            ["border-width", { kind: "box", terms: ["border-top-width"], targets: ["border-top-width", "border-right-width", "border-bottom-width", "border-left-width"] }],
            ["border-style", { kind: "box", terms: ["border-top-style"], targets: ["border-top-style", "border-right-style", "border-bottom-style", "border-left-style"] }],
            ["border-color", { kind: "box", targets:["border-top-color", "border-right-color", "border-bottom-color", "border-left-color"] }],
            ["corner-shape", { kind: "box", targets:SHAPE_CORNERS }],
            ["margin-block", { kind: "pair", terms: ["margin-top"], targets: ["margin-block-start", "margin-block-end"] }],
            ["margin-inline", { kind: "pair", terms: ["margin-top"], targets: ["margin-inline-start", "margin-inline-end"] }],
            ["padding-block", { kind: "pair", terms: ["padding-top"], targets: ["padding-block-start", "padding-block-end"] }],
            ["padding-inline", { kind: "pair", terms: ["padding-top"], targets: ["padding-inline-start", "padding-inline-end"] }],
            ["inset-block", { kind: "pair", terms: ["top"], targets: ["inset-block-start", "inset-block-end"] }],
            ["inset-inline", { kind: "pair", terms: ["top"], targets: ["inset-inline-start", "inset-inline-end"] }],
            ["border-block-width", { kind: "pair", terms: ["border-top-width"], targets: ["border-block-start-width", "border-block-end-width"] }],
            ["border-block-style", { kind: "pair", terms: ["border-top-style"], targets: ["border-block-start-style", "border-block-end-style"] }],
            ["border-block-color", { kind: "pair", terms: ["border-top-color"], targets: ["border-block-start-color", "border-block-end-color"] }],
            ["border-inline-width", { kind: "pair", terms: ["border-top-width"], targets: ["border-inline-start-width", "border-inline-end-width"] }],
            ["border-inline-style", { kind: "pair", terms: ["border-top-style"], targets: ["border-inline-start-style", "border-inline-end-style"] }],
            ["border-inline-color", { kind: "pair", terms: ["border-top-color"], targets: ["border-inline-start-color", "border-inline-end-color"] }],
            ["overflow", { kind: "pair", terms: ["overflow-block"], targets: ["overflow-x", "overflow-y"] }],
            ["gap", { kind: "pair", terms: ["row-gap", "column-gap"], targets: ["row-gap", "column-gap"] }],
            ["place-content", { kind: "pair", terms: ["align-content", "justify-content"], targets: ["align-content", "justify-content"] }],
            ["place-items", { kind: "pair", terms: ["align-items", "justify-items"], targets: ["align-items", "justify-items"] }],
            ["place-self", { kind: "pair", terms: ["align-self", "justify-self"], targets: ["align-self", "justify-self"] }],
            ["size", { kind: "pair", terms: ["width", "height"], targets: ["width", "height"] }],
            ["min-size", { kind: "pair", terms: ["min-width", "min-height"], targets: ["min-width", "min-height"] }],
            ["max-size", { kind: "pair", terms: ["max-width", "max-height"], targets: ["max-width", "max-height"] }],
            ["border", { kind: "sides", terms: LINE_TERMS, prefixes: ["border-top", "border-right", "border-bottom", "border-left"], resets: ["border-image"] }],
            ["border-block", { kind: "sides", terms: LINE_TERMS, prefixes: ["border-block-start", "border-block-end"], resets: [] }],
            ["border-inline", { kind: "sides", terms: LINE_TERMS, prefixes: ["border-inline-start", "border-inline-end"], resets: [] }],
            ["outline", { kind: "components", terms: { "outline-width": "outline-width", "outline-style": "outline-style", "outline-color": "outline-color" }, targets: ["outline-width", "outline-style", "outline-color"] }],
            ["columns", this.components(["column-width", "column-count"])],
            ["flex-flow", this.components(["flex-direction", "flex-wrap"])],
            ["text-wrap", this.components(["text-wrap-mode", "text-wrap-style"])],
            ["text-emphasis", this.components(["text-emphasis-style", "text-emphasis-color"])],
            ["text-decoration", this.components(["text-decoration-line", "text-decoration-thickness", "text-decoration-style", "text-decoration-color"])],
            ["border-image", this.components(["border-image-source", "border-image-slice", "border-image-width", "border-image-outset", "border-image-repeat"])],
            ["mask-border", this.components(MASK_BORDER_LONGHANDS)],
            ["offset", this.components(["offset-position", "offset-path", "offset-distance", "offset-rotate", "offset-anchor"])],
            ["container", this.components(["container-name", "container-type"])],
            ["position-try", this.components(["position-try-order", "position-try-fallbacks"])],
            ["block-step", this.components(["block-step-size", "block-step-insert", "block-step-align", "block-step-round"])],
            ["item-flow", this.components(["item-direction", "item-wrap", "item-pack", "flow-tolerance"])],
            ["corner", this.components(["border-radius", "corner-shape"])],
            ["color-adjust", { kind: "same", targets: ["print-color-adjust"] }],
            ["overflow-clip-margin", { kind: "same", targets: ["top", "right", "bottom", "left"].map((side: string) => "overflow-clip-margin-" + side) }],
            ["overflow-clip-margin-inline", { kind: "same", targets: ["overflow-clip-margin-inline-start", "overflow-clip-margin-inline-end"] }],
            ["overflow-clip-margin-block", { kind: "same", targets: ["overflow-clip-margin-block-start", "overflow-clip-margin-block-end"] }],
            ["-webkit-line-clamp", { kind: "special", targets: ["max-lines", "block-ellipsis", "continue"] }],
            ["border-clip", { kind: "same", targets: ["border-top-clip", "border-right-clip", "border-bottom-clip", "border-left-clip"] }],
            ["border-block-clip", { kind: "same", targets: ["border-block-start-clip", "border-block-end-clip"] }],
            ["border-inline-clip", { kind: "same", targets: ["border-inline-start-clip", "border-inline-end-clip"] }],
            ["page-break-before", { kind: "keywords", target: "break-before", values: { "auto": "auto", "left": "left", "right": "right", "avoid": "avoid", "always": "page" } }],
            ["page-break-after", { kind: "keywords", target: "break-after", values: { "auto": "auto", "left": "left", "right": "right", "avoid": "avoid", "always": "page" } }],
            ["page-break-inside", { kind: "keywords", target: "break-inside", values: { "auto": "auto", "avoid": "avoid" } }],
            ["glyph-orientation-vertical", { kind: "keywords", target: "text-orientation", values: { "auto": "mixed", "0deg": "upright", "0": "upright", "90deg": "sideways", "90": "sideways" } }],
            ["list-style", { kind: "special", targets: ["list-style-position", "list-style-image", "list-style-type"] }],
            ["font", { kind: "special", targets: [...new Set<string>([...Object.values(FONT_SET), ...FONT_RESET_ONLY])] }],
            ["font-variant", { kind: "special", targets: FONT_VARIANT_LONGHANDS }],
            ["font-synthesis", { kind: "special", targets: FONT_SYNTHESIS_LONGHANDS }],
            ["white-space", { kind: "special", targets: WHITE_SPACE_LONGHANDS }],
            ["background", { kind: "special", targets: BACKGROUND_LONGHANDS }],
            ["background-tbd", { kind: "special", targets: BACKGROUND_LONGHANDS.filter((property: string) => property !== "background-color") }],
            ["background-position", { kind: "special", targets: AXIS_SUFFIXES.map((suffix: string) => "background-position" + suffix) }],
            ["background-repeat", { kind: "special", targets: AXIS_SUFFIXES.map((suffix: string) => "background-repeat" + suffix) }],
            ["mask", { kind: "special", targets: [...MASK_LONGHANDS, "mask-border"] }],
            ["flex", { kind: "special", targets: ["flex-grow", "flex-shrink", "flex-basis"] }],
            ["border-radius", { kind: "special", targets: RADIUS_CORNERS }],
            ["box-shadow", { kind: "special", targets: SHADOW_LONGHANDS }],
            ["text-align", { kind: "special", targets: ["text-align-all", "text-align-last"] }],
            ["vertical-align", { kind: "special", targets: ["baseline-source", "alignment-baseline", "baseline-shift"] }],
            ["text-spacing", { kind: "special", targets: ["text-spacing-trim", "text-autospace"] }],
            ["text-box", { kind: "special", targets: ["text-box-trim", "text-box-edge"] }],
            ["text-decoration-skip", { kind: "special", targets: DECORATION_SKIP_LONGHANDS }],
            ["line-clamp", { kind: "special", targets: ["max-lines", "block-ellipsis", "continue"] }],
            ["contain-intrinsic-size", { kind: "special", targets: ["contain-intrinsic-width", "contain-intrinsic-height"] }],
            ["grid-row", { kind: "special", targets: ["grid-row-start", "grid-row-end"] }],
            ["grid-column", { kind: "special", targets: ["grid-column-start", "grid-column-end"] }],
            ["grid-area", { kind: "special", targets: ["grid-row-start", "grid-column-start", "grid-row-end", "grid-column-end"] }],
            ["grid-template", { kind: "special", targets: GRID_TEMPLATE_LONGHANDS }],
            ["grid", { kind: "special", targets: GRID_LONGHANDS }]
        ]);
        for (const side of ["top", "right", "bottom", "left"]) {
            expansions.set("border-" + side, { kind: "sides", terms: LINE_TERMS, prefixes: ["border-" + side], resets: [] });
        }
        for (const side of ["block-start", "block-end", "inline-start", "inline-end"]) {
            expansions.set("border-" + side, { kind: "sides", terms: LINE_TERMS, prefixes: ["border-" + side], resets: [] });
        }
        for (const [side, corners] of Object.entries(SIDE_CORNERS)) {
            // CSS Borders 4 §3.6.1, §3.8.1 and §3.9.2: each side shorthand sets the two corners of that side, in the order listed.
            expansions.set("border-" + side + "-radius", { kind: "special", targets: [this.radius(corners[0]), this.radius(corners[1])] });
            expansions.set("corner-" + side + "-shape", { kind: "pair", targets:["corner-" + corners[0] + "-shape", "corner-" + corners[1] + "-shape"] });
            expansions.set("corner-" + side, { kind: "components", terms: { "border-top-radius": "border-" + side + "-radius", "corner-top-shape": "corner-" + side + "-shape" }, targets: ["border-" + side + "-radius", "corner-" + side + "-shape"] });
        }
        for (const corner of CORNERS) {
            expansions.set("corner-" + corner, {
                kind: "components",
                terms: { "border-top-left-radius": this.radius(corner), "corner-top-left-shape": "corner-" + corner + "-shape" },
                targets: [this.radius(corner), "corner-" + corner + "-shape"]
            });
        }
        for (const axis of ["column", "row"]) {
            // CSS Gaps 1 §4.4 and §3.3: the rule shorthands of each axis, and the inset shorthands that set start and end, cap and junction.
            expansions.set(axis + "-rule", { kind: "special", targets: [axis + "-rule-width", axis + "-rule-style", axis + "-rule-color"] });
            expansions.set(axis + "-rule-inset", { kind: "special", targets: [axis + "-rule-inset-cap-start", axis + "-rule-inset-cap-end", axis + "-rule-inset-junction-start", axis + "-rule-inset-junction-end"] });
            expansions.set(axis + "-rule-inset-cap", { kind: "pair", targets:[axis + "-rule-inset-cap-start", axis + "-rule-inset-cap-end"] });
            expansions.set(axis + "-rule-inset-junction", { kind: "pair", targets:[axis + "-rule-inset-junction-start", axis + "-rule-inset-junction-end"] });
            expansions.set(axis + "-rule-inset-start", { kind: "same", targets: [axis + "-rule-inset-cap-start", axis + "-rule-inset-junction-start"] });
            expansions.set(axis + "-rule-inset-end", { kind: "same", targets: [axis + "-rule-inset-cap-end", axis + "-rule-inset-junction-end"] });
        }
        for (const suffix of ["", "-break", "-color", "-style", "-width", "-visibility-items", "-inset", "-inset-cap", "-inset-junction", "-inset-start", "-inset-end"]) {
            expansions.set("rule" + suffix, { kind: "same", targets: ["column-rule" + suffix, "row-rule" + suffix] });
        }
        return expansions;
    }

    private components(longhands: ReadonlyArray<string>): Expansion {
        return { kind: "components", terms: Object.fromEntries(longhands.map((longhand: string) => [longhand, longhand])), targets: longhands };
    }

    private radius(corner: string): string {
        return "border-" + corner + "-radius";
    }

    private expandSpecial(property: string, matched: MatchNode, top: ReadonlyArray<CssNode>, indexOf: Map<CssNode, number>): Array<Longhand> | undefined {
        if (property.endsWith("-radius") && property !== "border-radius") {
            return this.expandSideRadius(property, top);
        }
        if (this.paints.has(property)) {
            return this.expandPaint(property, matched, top, indexOf);
        }
        switch (property) {
            case "list-style":
                return this.expandListStyle(matched, top, indexOf);
            case "font":
                return this.expandFont(matched, top, indexOf);
            case "font-variant":
                return this.expandFontVariant(top);
            case "font-synthesis":
                return this.expandFontSynthesis(top);
            case "white-space":
                return this.expandWhiteSpace(matched, top, indexOf);
            case "background":
                return this.expandBackground(matched, top, indexOf, true);
            case "background-tbd":
                return this.expandBackground(matched, top, indexOf, false);
            case "background-position":
            case "background-repeat":
                return this.expandBackgroundAxes(property, top);
            case "mask":
                return this.expandMask(matched, top, indexOf);
            case "flex":
                return this.expandFlex(matched, top, indexOf);
            case "border-radius":
                return this.expandBorderRadius(top);
            case "box-shadow":
                return this.expandBoxShadow(top);
            case "text-align":
                return this.expandTextAlign(top);
            case "vertical-align":
                return this.expandVerticalAlign(matched, top, indexOf);
            case "text-spacing":
                return this.expandTextSpacing(matched, top, indexOf);
            case "text-box":
                return this.expandTextBox(matched, top, indexOf);
            case "text-decoration-skip":
                return this.expandDecorationSkip(top);
            case "line-clamp":
                return this.expandLineClamp(top);
            case "-webkit-line-clamp":
                return this.expandLegacyLineClamp(top);
            case "contain-intrinsic-size":
                return this.expandContainIntrinsicSize(top);
            case "column-rule":
            case "row-rule":
                return this.expandGapRule(property, top);
            case "column-rule-inset":
            case "row-rule-inset":
                return this.expandRuleInset(property, top);
            case "grid-row":
            case "grid-column":
                return this.expandGridLines(property, top);
            case "grid-area":
                return this.expandGridArea(top);
            case "grid-template":
                return this.expandGridTemplate(top);
            case "grid":
                return this.expandGrid(top);
            default:
                return undefined;
        }
    }

    private expandBox(items: ReadonlyArray<ReadonlyArray<number>>, top: ReadonlyArray<CssNode>, targets: Four): Array<Longhand> | undefined {
        // CSS Box 4 §3.2: one value sets all four sides; two set top and bottom, then right and left; three set top, right and left, then bottom.
        if (items.length < 1 || items.length > 4) {
            return undefined;
        }
        const first: ReadonlyArray<number> = items[0];
        const second: ReadonlyArray<number> = items[1] ?? first;
        const third: ReadonlyArray<number> = items[2] ?? first;
        const fourth: ReadonlyArray<number> = items[3] ?? second;
        return this.assign([[targets[0], first], [targets[1], second], [targets[2], third], [targets[3], fourth]], top);
    }

    private expandPair(items: ReadonlyArray<ReadonlyArray<number>>, top: ReadonlyArray<CssNode>, targets: Two): Array<Longhand> | undefined {
        // The two-value shorthands set both longhands from one value, or the first and then the second.
        if (items.length < 1 || items.length > 2) {
            return undefined;
        }
        return this.assign([[targets[0], items[0]], [targets[1], items[1] ?? items[0]]], top);
    }

    private expandComponents(segments: ReadonlyArray<Segment>, top: ReadonlyArray<CssNode>, terms: Readonly<Record<string, string>>, targets: ReadonlyArray<string>): Array<Longhand> | undefined {
        const indices: Map<string, Array<number>> = this.groupByTarget(segments, terms);
        const result: Array<Longhand> = [];
        for (const target of targets) {
            const assigned: Array<number> | undefined = indices.get(target);
            if (assigned === undefined) {
                result.push({ property: target });
                continue;
            }
            const longhand: Longhand | undefined = this.longhandOf(target, assigned, top);
            if (longhand === undefined) {
                return undefined;
            }
            result.push(longhand);
        }
        return result;
    }

    private expandSides(segments: ReadonlyArray<Segment>, top: ReadonlyArray<CssNode>, expansion: { terms: Readonly<Record<string, string>>; prefixes: ReadonlyArray<string>; resets: ReadonlyArray<string> }): Array<Longhand> | undefined {
        const indices: Map<string, Array<number>> = this.groupByTarget(segments, expansion.terms);
        const result: Array<Longhand> = [];
        for (const suffix of Object.values(expansion.terms)) {
            const assigned: Array<number> | undefined = indices.get(suffix);
            for (const prefix of expansion.prefixes) {
                const longhand: Longhand | undefined = assigned === undefined ? { property: prefix + suffix } : this.longhandOf(prefix + suffix, assigned, top);
                if (longhand === undefined) {
                    return undefined;
                }
                result.push(longhand);
            }
        }
        for (const reset of expansion.resets) {
            result.push({ property: reset });
        }
        return result;
    }

    private expandListStyle(matched: MatchNode, top: ReadonlyArray<CssNode>, indexOf: Map<CssNode, number>): Array<Longhand> | undefined {
        // CSS Lists 3 §3.6: none sets whichever of list-style-image and list-style-type is not otherwise specified.
        const targets: ReadonlyArray<string> = ["list-style-position", "list-style-image", "list-style-type"];
        const terms: Record<string, string> = Object.fromEntries(targets.map((target: string) => [target, target]));
        const longhands: Array<Longhand> | undefined = this.expandComponents(this.segments(matched, new Set<string>(targets), indexOf), top, terms, targets);
        if (longhands === undefined) {
            return undefined;
        }
        const image: Longhand = longhands[1];
        const type: Longhand = longhands[2];
        if (image.value !== undefined && this.isKeyword("none", image.value) && type.value === undefined) {
            type.value = image.value;
        } else if (type.value !== undefined && this.isKeyword("none", type.value) && image.value === undefined) {
            image.value = type.value;
        }
        return longhands;
    }

    private expandFont(matched: MatchNode, top: ReadonlyArray<CssNode>, indexOf: Map<CssNode, number>): Array<Longhand> | undefined {
        // CSS Fonts 4 §2.7: the Set Explicitly and Reset Implicitly subproperties are reset, then the given ones set; a system
        // font, the only form without a font family, takes the system-ui family and the initial value of the rest.
        const set: Array<Longhand> | undefined = this.expandComponents(this.segments(matched, new Set<string>(Object.keys(FONT_SET)), indexOf), top, FONT_SET, Object.values(FONT_SET));
        if (set === undefined) {
            return undefined;
        }
        const family: Longhand | undefined = set.find((longhand: Longhand) => longhand.property === "font-family");
        if (family !== undefined && family.value === undefined) {
            family.value = this.ident("system-ui");
        }
        const reset: Array<Longhand> = FONT_RESET_ONLY.filter((property: string) => property !== "font-variant-caps").map((property: string) => this.initial(property));
        return [...set, ...reset];
    }

    private expandFontSynthesis(top: ReadonlyArray<CssNode>): Array<Longhand> {
        // CSS Fonts 4 §2.8.5: each keyword given sets its longhand to auto, and each one left out sets it to none.
        const given: Array<string> = top.map((node: CssNode) => node.type === "Identifier" ? "font-synthesis-" + node.name.toLowerCase() : "");
        return FONT_SYNTHESIS_LONGHANDS.map((property: string) => this.keyword(property, given.includes(property) ? "auto" : "none"));
    }

    private expandWhiteSpace(matched: MatchNode, top: ReadonlyArray<CssNode>, indexOf: Map<CssNode, number>): Array<Longhand> | undefined {
        // CSS Text 4 §3: the special keywords map to the longhands by the normative table; otherwise the longhands given are set
        // and the omitted ones reset.
        const keyword: string | undefined = this.singleKeyword(top);
        const mapped: ReadonlyArray<string> | undefined = keyword === undefined ? undefined : WHITE_SPACE_KEYWORDS.get(keyword);
        if (mapped !== undefined) {
            return WHITE_SPACE_LONGHANDS.map((property: string, index: number) => this.keyword(property, mapped[index]));
        }
        const terms: Record<string, string> = Object.fromEntries(WHITE_SPACE_LONGHANDS.map((property: string) => [property, property]));
        return this.expandComponents(this.segments(matched, new Set<string>(WHITE_SPACE_LONGHANDS), indexOf), top, terms, WHITE_SPACE_LONGHANDS);
    }

    private expandFontVariant(top: ReadonlyArray<CssNode>): Array<Longhand> | undefined {
        // CSS Fonts 4 §6.11: none sets font-variant-ligatures to none; each other value goes to the subproperty that accepts it.
        const single: string | undefined = this.singleKeyword(top);
        if (single === "normal" || single === "none") {
            return FONT_VARIANT_LONGHANDS.map((property: string) => single === "none" && property === "font-variant-ligatures" ? this.keyword(property, "none") : this.initial(property));
        }
        const assigned: Map<string, Array<number>> = new Map<string, Array<number>>();
        for (let index: number = 0; index < top.length; index++) {
            const text: string = generate(top[index]);
            const owner: string | undefined = FONT_VARIANT_LONGHANDS.find((property: string) => this.table.matchProperty(property, text) !== undefined);
            if (owner === undefined) {
                return undefined;
            }
            const indices: Array<number> | undefined = assigned.get(owner);
            if (indices === undefined) {
                assigned.set(owner, [index]);
            } else {
                indices.push(index);
            }
        }
        const result: Array<Longhand> = [];
        for (const property of FONT_VARIANT_LONGHANDS) {
            const indices: Array<number> | undefined = assigned.get(property);
            if (indices === undefined) {
                result.push(this.initial(property));
                continue;
            }
            const nodes: Array<CssNode> = indices.map((index: number) => top[index]);
            const value: CssValue | undefined = this.values.parseNodes(nodes);
            if (value === undefined || this.table.matchProperty(property, nodes.map((node: CssNode) => generate(node)).join(" ")) === undefined) {
                return undefined;
            }
            result.push({ property, value, nodes });
        }
        return result;
    }

    private expandBackground(matched: MatchNode, top: ReadonlyArray<CssNode>, indexOf: Map<CssNode, number>, withColor: boolean): Array<Longhand> | undefined {
        // CSS Backgrounds 4 §2.12: one <visual-box> sets origin and clip, a value only background-clip accepts sets clip and
        // makes origin border-box, and two values set origin then clip. §2.11: background-tbd sets the same but the color.
        const segments: Array<Segment> = this.segments(matched, new Set<string>([...Object.keys(BACKGROUND_TERMS), "bg-clip", "visual-box", "background-color"]), indexOf)
            .sort((first: Segment, second: Segment) => first.indices[0] - second.indices[0]);
        const layers: Array<Map<string, CssValue>> = [];
        let color: Longhand = this.initial("background-color");
        for (const layer of this.layers(top)) {
            const values: Map<string, CssValue> = new Map<string, CssValue>();
            const boxes: Array<CssValue> = [];
            for (const segment of segments.filter((item: Segment) => item.indices.every((index: number) => layer.includes(index)))) {
                const value: CssValue | undefined = this.valueOf(segment.indices, top);
                if (value === undefined) {
                    return undefined;
                }
                if (segment.name === "background-color") {
                    color = { property: "background-color", value };
                } else if (segment.name === "visual-box" || segment.name === "bg-clip") {
                    boxes.push(value);
                } else if (segment.name === "bg-position" || segment.name === "repeat-style") {
                    const axes: Map<string, CssValue> | undefined = segment.name === "bg-position" ? this.positionAxes(value) : this.repeatAxes(value);
                    if (axes === undefined) {
                        return undefined;
                    }
                    for (const [longhand, item] of axes) {
                        values.set(longhand, item);
                    }
                } else {
                    values.set(BACKGROUND_TERMS[segment.name], value);
                }
            }
            if (boxes.length === 1) {
                const visual: boolean = boxes[0].kind === "ident" && VISUAL_BOXES.has(boxes[0].lower);
                values.set("background-origin", visual ? boxes[0] : this.ident("border-box"));
                values.set("background-clip", boxes[0]);
            } else if (boxes.length === 2) {
                values.set("background-origin", boxes[0]);
                values.set("background-clip", boxes[1]);
            }
            layers.push(values);
        }
        // The shorthand only declares the longhands of each layer; drawing the background is part of painting a box, not of the cascade.
        const result: Array<Longhand> | undefined = this.layeredLonghands(BACKGROUND_LAYERED, layers);
        const position: Array<Longhand> | undefined = this.axisLonghands("background-position", layers);
        const repeat: Array<Longhand> | undefined = this.axisLonghands("background-repeat", layers);
        // Compositing and Blending 1 §3.4.3: "If the background shorthand is used, the background-blend-mode property for that
        // element must be reset to its initial value."
        if (result === undefined || position === undefined || repeat === undefined) {
            return undefined;
        }
        const longhands: Array<Longhand> = [...result, ...position, ...repeat];
        if (withColor) {
            longhands.push(color);
        }
        longhands.push(this.initial("background-blend-mode"));
        return longhands;
    }

    private expandBackgroundAxes(property: string, top: ReadonlyArray<CssNode>): Array<Longhand> | undefined {
        const layers: Array<Map<string, CssValue>> = [];
        for (const layer of this.layers(top)) {
            const value: CssValue | undefined = this.valueOf(layer, top);
            const axes: Map<string, CssValue> | undefined = value === undefined ? undefined
                : (property === "background-repeat" ? this.repeatAxes(value) : this.positionAxes(value));
            if (axes === undefined) {
                return undefined;
            }
            layers.push(axes);
        }
        return this.axisLonghands(property, layers);
    }

    private axisLonghands(property: string, layers: ReadonlyArray<Map<string, CssValue>>): Array<Longhand> | undefined {
        // CSS Backgrounds 4 §2.3, §2.4, §2.6 and §2.7: each layer gives its components to the longhands of the axes it names,
        // and a longhand with no component takes its initial value; the longhands the value names come last.
        const flowRelative: boolean = layers.some((layer: Map<string, CssValue>) => layer.has(property + "-block"));
        const suffixes: ReadonlyArray<string> = flowRelative ? ["-x", "-y", "-block", "-inline"] : ["-block", "-inline", "-x", "-y"];
        return this.layeredLonghands(suffixes.map((suffix: string) => property + suffix), layers);
    }

    private repeatAxes(value: CssValue): Map<string, CssValue> | undefined {
        // CSS Backgrounds 4 §2.4: repeat-x is repeat no-repeat and repeat-y is no-repeat repeat; one <repetition> counts for
        // both axes; repeat-block and repeat-inline repeat in the block or the inline axis and not in the other.
        const items: ReadonlyArray<CssValue> = value.kind === "list" && value.separator === "space" ? value.items : [value];
        const first: CssValue = items[0];
        const repeat: CssValue = this.ident("repeat");
        const none: CssValue = this.ident("no-repeat");
        if (items.length === 2) {
            return new Map<string, CssValue>([["background-repeat-x", first], ["background-repeat-y", items[1]]]);
        }
        if (items.length !== 1 || first.kind !== "ident") {
            return undefined;
        }
        switch (first.lower) {
            case "repeat-x":
                return new Map<string, CssValue>([["background-repeat-x", repeat], ["background-repeat-y", none]]);
            case "repeat-y":
                return new Map<string, CssValue>([["background-repeat-x", none], ["background-repeat-y", repeat]]);
            case "repeat-block":
                return new Map<string, CssValue>([["background-repeat-block", repeat], ["background-repeat-inline", none]]);
            case "repeat-inline":
                return new Map<string, CssValue>([["background-repeat-block", none], ["background-repeat-inline", repeat]]);
            default:
                return new Map<string, CssValue>([["background-repeat-x", first], ["background-repeat-y", first]]);
        }
    }

    private positionAxes(value: CssValue): Map<string, CssValue> | undefined {
        // CSS Backgrounds 4 §2.6: the horizontal, vertical, block-axis and inline-axis components of the position go to
        // background-position-x, background-position-y, background-position-block and background-position-inline.
        const items: ReadonlyArray<CssValue> = value.kind === "list" && value.separator === "space" ? value.items : [value];
        const components: Array<PositionComponent> = [];
        for (let index: number = 0; index < items.length; index++) {
            const item: CssValue = items[index];
            if (item.kind !== "ident") {
                components.push({ offset: item });
                continue;
            }
            // CSS Values 5 §4.2: only the three- and four-value forms have a keyword followed by the offset from that edge.
            const next: CssValue | undefined = items[index + 1];
            const offset: boolean = items.length > 2 && item.lower !== "center" && next !== undefined && next.kind !== "ident";
            components.push(offset && next !== undefined ? { edge: item.lower, offset: next } : { edge: item.lower });
            if (offset) {
                index++;
            }
        }
        if (components.length < 1 || components.length > 2) {
            return undefined;
        }
        if (components.some((component: PositionComponent) =>
            component.edge !== undefined && (BLOCK_EDGES.has(component.edge) || INLINE_EDGES.has(component.edge) || FLOW_EDGES.has(component.edge)))) {
            return this.flowRelativePosition(components);
        }
        let horizontal: PositionComponent | undefined = components.find((component: PositionComponent) => component.edge !== undefined && HORIZONTAL_EDGES.has(component.edge));
        let vertical: PositionComponent | undefined = components.find((component: PositionComponent) => component.edge !== undefined && VERTICAL_EDGES.has(component.edge));
        for (const component of components) {
            if (component === horizontal || component === vertical) {
                continue;
            }
            if (horizontal === undefined) {
                horizontal = component;
            } else {
                vertical = component;
            }
        }
        return new Map<string, CssValue>([["background-position-x", this.positionItem(horizontal)], ["background-position-y", this.positionItem(vertical)]]);
    }

    private positionItem(component?: PositionComponent): CssValue {
        // CSS Values 5 §4.2: a component that is not given is center.
        if (component === undefined) {
            return this.ident("center");
        }
        if (component.edge === undefined) {
            return component.offset as CssValue;
        }
        return component.offset === undefined ? this.ident(component.edge) : { kind: "list", separator: "space", items: [this.ident(component.edge), component.offset] };
    }

    private flowRelativePosition(components: ReadonlyArray<PositionComponent>): Map<string, CssValue> {
        // CSS Values 5 §4.2: of two start, center or end keywords the first is for the block axis; CSS Backgrounds 4 §2.6
        // names the edges of the block and inline longhands start and end.
        let block: PositionComponent | undefined = components.find((component: PositionComponent) => component.edge !== undefined && BLOCK_EDGES.has(component.edge));
        let inline: PositionComponent | undefined = components.find((component: PositionComponent) => component.edge !== undefined && INLINE_EDGES.has(component.edge));
        for (const component of components) {
            if (component === block || component === inline) {
                continue;
            }
            if (block === undefined) {
                block = component;
            } else {
                inline = component;
            }
        }
        const item: (component?: PositionComponent) => CssValue = (component?: PositionComponent): CssValue => {
            if (component === undefined || component.edge === undefined || component.edge === "center") {
                return this.positionItem(component);
            }
            const edge: string = component.edge.endsWith("end") ? "end" : "start";
            return this.positionItem(component.offset === undefined ? { edge } : { edge, offset: component.offset });
        };
        return new Map<string, CssValue>([["background-position-block", item(block)], ["background-position-inline", item(inline)]]);
    }

    private expandMask(matched: MatchNode, top: ReadonlyArray<CssNode>, indexOf: Map<CssNode, number>): Array<Longhand> | undefined {
        // CSS Masking 1 §7.9: one <geometry-box> sets origin and clip, one with no-clip sets origin and clip to no-clip,
        // two set origin then clip; the shorthand also resets mask-border.
        const segments: Array<Segment> = this.segments(matched, new Set<string>([...Object.keys(MASK_TERMS), "geometry-box"]), indexOf);
        const layers: Array<Map<string, CssValue>> = [];
        for (const layer of this.layers(top)) {
            const values: Map<string, CssValue> = new Map<string, CssValue>();
            const boxes: Array<CssValue> = [];
            for (const segment of segments.filter((item: Segment) => item.indices.every((index: number) => layer.includes(index)))) {
                const value: CssValue | undefined = this.valueOf(segment.indices, top);
                if (value === undefined) {
                    return undefined;
                }
                if (segment.name === "geometry-box") {
                    boxes.push(value);
                } else {
                    values.set(MASK_TERMS[segment.name], value);
                }
            }
            const noClip: boolean = layer.some((index: number) => top[index].type === "Identifier" && (top[index] as { name: string }).name.toLowerCase() === "no-clip");
            if (boxes.length === 1) {
                values.set("mask-origin", boxes[0]);
                values.set("mask-clip", noClip ? this.ident("no-clip") : boxes[0]);
            } else if (boxes.length === 2) {
                values.set("mask-origin", boxes[0]);
                values.set("mask-clip", boxes[1]);
            } else if (noClip) {
                values.set("mask-clip", this.ident("no-clip"));
            }
            layers.push(values);
        }
        const result: Array<Longhand> | undefined = this.layeredLonghands(MASK_LONGHANDS, layers);
        return result === undefined ? undefined : [...result, { property: "mask-border" }];
    }

    private expandPaint(property: string, matched: MatchNode, top: ReadonlyArray<CssNode>, indexOf: Map<CssNode, number>): Array<Longhand> | undefined {
        // CSS Fill and Stroke 3 §3.3.7 and §4.4.7: an omitted color is transparent and an omitted origin fill-box or stroke-box;
        // fill-color is one color, of the final layer, and stroke-color a list of one color for each layer (§4.4.1).
        const fill: boolean = property.endsWith(FILL);
        const color: string = fill ? property + "-color" : "color";
        const terms: Readonly<Record<string, string>> = {
            "paint": property + "-image", "position": property + "-position", "bg-size": property + "-size", "repeat-style": property + "-repeat",
            [property + "-origin"]: property + "-origin", [color]: property + "-color"
        };
        const segments: Array<Segment> = this.segments(matched, new Set<string>(Object.keys(terms)), indexOf);
        const layers: Array<Map<string, CssValue>> = [];
        for (const layer of this.layers(top)) {
            const values: Map<string, CssValue> = new Map<string, CssValue>([[property + "-origin", this.ident(property + "-box")], [property + "-color", this.ident("transparent")]]);
            for (const segment of segments.filter((item: Segment) => item.indices.every((index: number) => layer.includes(index)))) {
                const value: CssValue | undefined = this.valueOf(segment.indices, top);
                if (value === undefined) {
                    return undefined;
                }
                values.set(terms[segment.name], value);
            }
            layers.push(values);
        }
        const layered: ReadonlyArray<string> = PAINT_SUFFIXES.map((suffix: string) => property + suffix).filter((name: string) => !fill || name !== color);
        const result: Array<Longhand> | undefined = this.layeredLonghands(layered, layers);
        if (result === undefined || !fill) {
            return result;
        }
        return [...result, { property: color, value: layers[layers.length - 1].get(color) as CssValue }];
    }

    private expandFlex(matched: MatchNode, top: ReadonlyArray<CssNode>, indexOf: Map<CssNode, number>): Array<Longhand> | undefined {
        // CSS Flexbox 1 §7.1: none is 0 0 auto; an omitted flex-grow or flex-shrink is 1, and an omitted flex-basis is 0.
        if (this.singleKeyword(top) === "none") {
            return [this.number("flex-grow", 0), this.number("flex-shrink", 0), this.keyword("flex-basis", "auto")];
        }
        const targets: ReadonlyArray<string> = ["flex-grow", "flex-shrink", "flex-basis"];
        const terms: Record<string, string> = Object.fromEntries(targets.map((target: string) => [target, target]));
        const longhands: Array<Longhand> | undefined = this.expandComponents(this.segments(matched, new Set<string>(targets), indexOf), top, terms, targets);
        if (longhands === undefined) {
            return undefined;
        }
        return [
            longhands[0].value === undefined ? this.number("flex-grow", 1) : longhands[0],
            longhands[1].value === undefined ? this.number("flex-shrink", 1) : longhands[1],
            longhands[2].value === undefined ? this.number("flex-basis", 0) : longhands[2]
        ];
    }

    private expandBorderRadius(top: ReadonlyArray<CssNode>): Array<Longhand> | undefined {
        // CSS Borders 4 §3.6.2: horizontal radii before the slash, vertical after it, each filled in like the sides of a box.
        const halves: [Array<CssValue>, Array<CssValue>] | undefined = this.radii(top, 4);
        if (halves === undefined) {
            return undefined;
        }
        const fill: (values: Array<CssValue>) => Array<CssValue> = (values: Array<CssValue>): Array<CssValue> => {
            const second: CssValue = values[1] ?? values[0];
            return [values[0], second, values[2] ?? values[0], values[3] ?? second];
        };
        const horizontal: Array<CssValue> = fill(halves[0]);
        const vertical: Array<CssValue> = fill(halves[1]);
        return RADIUS_CORNERS.map((property: string, index: number) => this.radiusLonghand(property, horizontal[index], vertical[index]));
    }

    private expandSideRadius(property: string, top: ReadonlyArray<CssNode>): Array<Longhand> | undefined {
        // CSS Borders 4 §3.6.1: each side sets its two corners; a missing second value is copied from the first.
        const targets: ReadonlyArray<string> = this.targets(property);
        const halves: [Array<CssValue>, Array<CssValue>] | undefined = this.radii(top, 2);
        if (halves === undefined) {
            return undefined;
        }
        const horizontal: Array<CssValue> = [halves[0][0], halves[0][1] ?? halves[0][0]];
        const vertical: Array<CssValue> = [halves[1][0], halves[1][1] ?? halves[1][0]];
        return [this.radiusLonghand(targets[0], horizontal[0], vertical[0]), this.radiusLonghand(targets[1], horizontal[1], vertical[1])];
    }

    private radii(top: ReadonlyArray<CssNode>, most: number): [Array<CssValue>, Array<CssValue>] | undefined {
        const slash: number = top.findIndex((node: CssNode) => node.type === "Operator" && node.value === "/");
        const parse: (nodes: ReadonlyArray<CssNode>) => Array<CssValue> | undefined = (nodes: ReadonlyArray<CssNode>): Array<CssValue> | undefined => {
            if (nodes.length < 1 || nodes.length > most) {
                return undefined;
            }
            const values: Array<CssValue> = [];
            for (const node of nodes) {
                const value: CssValue | undefined = this.values.parseNodes([node]);
                if (value === undefined) {
                    return undefined;
                }
                values.push(value);
            }
            return values;
        };
        const horizontal: Array<CssValue> | undefined = parse(slash === -1 ? top : top.slice(0, slash));
        const vertical: Array<CssValue> | undefined = slash === -1 ? horizontal : parse(top.slice(slash + 1));
        return horizontal === undefined || vertical === undefined ? undefined : [horizontal, vertical];
    }

    private radiusLonghand(property: string, horizontal: CssValue, vertical: CssValue): Longhand {
        return { property, value: { kind: "list", separator: "space", items: [horizontal, vertical] } };
    }

    private expandBoxShadow(top: ReadonlyArray<CssNode>): Array<Longhand> | undefined {
        // CSS Borders 4 §6.6: "Omitted lengths are 0; omitted colors default to transparent when the specified offset is none
        // and to currentcolor otherwise."
        const layers: Array<Map<string, CssValue>> = [];
        const zero: CssValue = { kind: "number", value: 0, integer: true };
        for (const layer of this.layers(top)) {
            const lengths: Array<CssValue> = [];
            let color: CssValue | undefined;
            let position: CssValue | undefined;
            let none: boolean = false;
            for (const index of layer) {
                const node: CssNode = top[index];
                const value: CssValue | undefined = this.values.parseNodes([node]);
                if (value === undefined) {
                    return undefined;
                }
                const keyword: string | undefined = value.kind === "ident" ? value.lower : undefined;
                if (keyword === "none") {
                    none = true;
                } else if (keyword !== undefined && SHADOW_POSITIONS.has(keyword)) {
                    position = value;
                } else if (this.table.matchesType("color", node)) {
                    color = value;
                } else {
                    lengths.push(value);
                }
            }
            // The grammar has matched, so the lengths are the two offsets, then the blur, then the spread.
            const offset: CssValue = none ? this.ident("none") : { kind: "list", separator: "space", items: [lengths[0], lengths[1]] };
            const rest: ReadonlyArray<CssValue> = none ? lengths : lengths.slice(2);
            layers.push(new Map<string, CssValue>([
                ["box-shadow-color", color ?? this.ident(none ? "transparent" : "currentcolor")],
                ["box-shadow-offset", offset],
                ["box-shadow-blur", rest[0] ?? zero],
                ["box-shadow-spread", rest[1] ?? zero],
                ["box-shadow-position", position ?? this.ident("outset")]
            ]));
        }
        return this.layeredLonghands(SHADOW_LONGHANDS, layers);
    }

    private expandTextAlign(top: ReadonlyArray<CssNode>): Array<Longhand> | undefined {
        // CSS Text 4 §7.1: justify-all sets both longhands to justify and match-parent both to match-parent; every other
        // value sets text-align-all and resets text-align-last to auto. A <string> must be a single character.
        const keyword: string | undefined = this.singleKeyword(top);
        if (keyword === "justify-all") {
            return [this.keyword("text-align-all", "justify"), this.keyword("text-align-last", "justify")];
        }
        if (keyword === "match-parent") {
            return [this.keyword("text-align-all", "match-parent"), this.keyword("text-align-last", "match-parent")];
        }
        const only: CssNode | undefined = top.length === 1 ? top[0] : undefined;
        if (only !== undefined && only.type === "String" && [...only.value].length !== 1) {
            return undefined;
        }
        const all: Longhand | undefined = this.longhandOf("text-align-all", top.map((node: CssNode, index: number) => index), top);
        return all === undefined ? undefined : [all, this.keyword("text-align-last", "auto")];
    }

    private expandVerticalAlign(matched: MatchNode, top: ReadonlyArray<CssNode>, indexOf: Map<CssNode, number>): Array<Longhand> | undefined {
        // CSS Inline 3 §4.2: first or last sets baseline-source, which is otherwise reset to auto.
        const targets: ReadonlyArray<string> = ["alignment-baseline", "baseline-shift"];
        const terms: Record<string, string> = Object.fromEntries(targets.map((target: string) => [target, target]));
        const longhands: Array<Longhand> | undefined = this.expandComponents(this.segments(matched, new Set<string>(targets), indexOf), top, terms, targets);
        if (longhands === undefined) {
            return undefined;
        }
        const source: CssNode | undefined = top.find((node: CssNode) => node.type === "Identifier" && ["first", "last"].includes(node.name.toLowerCase()));
        const baselineSource: Longhand = source === undefined ? this.keyword("baseline-source", "auto") : this.keyword("baseline-source", (source as { name: string }).name.toLowerCase());
        return [baselineSource, ...longhands];
    }

    private expandTextSpacing(matched: MatchNode, top: ReadonlyArray<CssNode>, indexOf: Map<CssNode, number>): Array<Longhand> | undefined {
        // CSS Text 4 §8.6: none sets space-all and no-autospace, auto sets both to auto, and an omitted component is reset.
        const keyword: string | undefined = this.singleKeyword(top);
        if (keyword === "none") {
            return [this.keyword("text-spacing-trim", "space-all"), this.keyword("text-autospace", "no-autospace")];
        }
        if (keyword === "auto") {
            return [this.keyword("text-spacing-trim", "auto"), this.keyword("text-autospace", "auto")];
        }
        const terms: Record<string, string> = { "spacing-trim": "text-spacing-trim", "autospace": "text-autospace" };
        return this.expandComponents(this.segments(matched, new Set<string>(Object.keys(terms)), indexOf), top, terms, ["text-spacing-trim", "text-autospace"]);
    }

    private expandTextBox(matched: MatchNode, top: ReadonlyArray<CssNode>, indexOf: Map<CssNode, number>): Array<Longhand> | undefined {
        // CSS Inline 3 §6.1: normal sets none and auto; otherwise an omitted text-box-trim is both, not its initial value.
        if (this.singleKeyword(top) === "normal") {
            return [this.keyword("text-box-trim", "none"), this.keyword("text-box-edge", "auto")];
        }
        const targets: ReadonlyArray<string> = ["text-box-trim", "text-box-edge"];
        const terms: Record<string, string> = Object.fromEntries(targets.map((target: string) => [target, target]));
        const longhands: Array<Longhand> | undefined = this.expandComponents(this.segments(matched, new Set<string>(targets), indexOf), top, terms, targets);
        if (longhands === undefined) {
            return undefined;
        }
        return [longhands[0].value === undefined ? this.keyword("text-box-trim", "both") : longhands[0], longhands[1]];
    }

    private expandDecorationSkip(top: ReadonlyArray<CssNode>): Array<Longhand> | undefined {
        // CSS Text Decoration 4 §2.10: none sets every sub-property to none, and auto sets them to their initial values.
        const keyword: string | undefined = this.singleKeyword(top);
        if (keyword === "none") {
            return DECORATION_SKIP_LONGHANDS.map((property: string) => this.keyword(property, "none"));
        }
        return keyword === "auto" ? DECORATION_SKIP_LONGHANDS.map((property: string) => this.initial(property)) : undefined;
    }

    private expandLineClamp(top: ReadonlyArray<CssNode>): Array<Longhand> | undefined {
        // CSS Overflow 4 §5.1: none sets none, none and auto; an integer sets max-lines, continue to discard,
        // and block-ellipsis to the second component or auto.
        if (this.singleKeyword(top) === "none") {
            return [this.keyword("max-lines", "none"), this.keyword("block-ellipsis", "none"), this.keyword("continue", "auto")];
        }
        const lines: Longhand | undefined = this.longhandOf("max-lines", [0], top);
        const ellipsis: Longhand | undefined = top.length > 1 ? this.longhandOf("block-ellipsis", top.slice(1).map((node: CssNode, index: number) => index + 1), top) : this.keyword("block-ellipsis", "auto");
        return lines === undefined || ellipsis === undefined ? undefined : [lines, ellipsis, this.keyword("continue", "discard")];
    }

    private expandLegacyLineClamp(top: ReadonlyArray<CssNode>): Array<Longhand> | undefined {
        // CSS Overflow 4 §5.1.1: as line-clamp, but with continue -webkit-discard and block-ellipsis always auto.
        if (this.singleKeyword(top) === "none") {
            return [this.keyword("max-lines", "none"), this.keyword("block-ellipsis", "auto"), this.keyword("continue", "auto")];
        }
        const lines: Longhand | undefined = this.longhandOf("max-lines", [0], top);
        return lines === undefined ? undefined : [lines, this.keyword("block-ellipsis", "auto"), this.keyword("continue", "-webkit-discard")];
    }

    private expandContainIntrinsicSize(top: ReadonlyArray<CssNode>): Array<Longhand> | undefined {
        // CSS Sizing 4 §5.2: the first value is the width and the second the height; a single value sets both, and auto belongs to the value after it.
        const items: Array<Array<number>> = [];
        let pending: Array<number> = [];
        top.forEach((node: CssNode, index: number) => {
            pending.push(index);
            if (!(node.type === "Identifier" && node.name.toLowerCase() === "auto")) {
                items.push(pending);
                pending = [];
            }
        });
        if (pending.length > 0) {
            return undefined;
        }
        return this.expandPair(items, top, ["contain-intrinsic-width", "contain-intrinsic-height"]);
    }

    private expandGapRule(property: string, top: ReadonlyArray<CssNode>): Array<Longhand> | undefined {
        // CSS Gaps 1 §4.4: each <gap-rule> of the list, inside repeat() or not, gives one item of the width, style and color lists;
        // an omitted component takes the initial value of its longhand.
        const axis: string = property.substring(0, property.indexOf("-rule"));
        const parts: ReadonlyArray<string> = ["width", "style", "color"];
        const lists: Array<Array<CssValue>> = [[], [], []];
        for (const item of this.layers(top)) {
            const nodes: Array<CssNode> = item.map((index: number) => top[index]);
            const repeat: CssNode | undefined = nodes.length === 1 && nodes[0].type === "Function" && nodes[0].name.toLowerCase() === "repeat" ? nodes[0] : undefined;
            if (repeat === undefined) {
                const rule: Array<CssValue> | undefined = this.gapRule(axis, nodes);
                if (rule === undefined) {
                    return undefined;
                }
                rule.forEach((value: CssValue, part: number) => lists[part].push(value));
                continue;
            }
            const inner: Array<CssNode> = (repeat as { children: { toArray(): Array<CssNode> } }).children.toArray();
            const groups: Array<Array<CssNode>> = this.splitByComma(inner);
            const count: CssValue | undefined = groups[0].length === 1 ? this.values.parseNodes(groups[0]) : undefined;
            if (count === undefined || groups.length < 2) {
                return undefined;
            }
            const args: Array<Array<CssValue>> = [[count], [count], [count]];
            for (const group of groups.slice(1)) {
                const rule: Array<CssValue> | undefined = this.gapRule(axis, group);
                if (rule === undefined) {
                    return undefined;
                }
                rule.forEach((value: CssValue, part: number) => args[part].push(value));
            }
            args.forEach((values: Array<CssValue>, part: number) => lists[part].push({ kind: "function", name: "repeat", args: values }));
        }
        return parts.map((part: string, index: number) => ({
            property: axis + "-rule-" + part,
            value: lists[index].length === 1 ? lists[index][0] : { kind: "list", separator: "comma", items: lists[index] }
        }));
    }

    private gapRule(axis: string, nodes: ReadonlyArray<CssNode>): Array<CssValue> | undefined {
        const found: Map<number, CssValue> = new Map<number, CssValue>();
        const types: ReadonlyArray<string> = ["line-width", "line-style", "color"];
        for (const node of nodes) {
            const part: number = types.findIndex((type: string, index: number) => !found.has(index) && this.table.matchesType(type, node));
            const value: CssValue | undefined = part === -1 ? undefined : this.values.parseNodes([node]);
            if (value === undefined) {
                return undefined;
            }
            found.set(part, value);
        }
        const values: Array<CssValue> = [];
        for (const [index, part] of ["width", "style", "color"].entries()) {
            const value: CssValue | undefined = found.get(index) ?? this.firstItem(this.initialValue(axis + "-rule-" + part));
            if (value === undefined) {
                return undefined;
            }
            values.push(value);
        }
        return values;
    }

    private expandRuleInset(property: string, top: ReadonlyArray<CssNode>): Array<Longhand> | undefined {
        // CSS Gaps 1 §3.3.3: cap-start cap-end? [/ junction-start junction-end?]?; omitted junction values copy the cap values,
        // and an omitted end copies its start.
        const targets: ReadonlyArray<string> = this.targets(property);
        const slash: number = top.findIndex((node: CssNode) => node.type === "Operator" && node.value === "/");
        const cap: Array<number> = (slash === -1 ? top : top.slice(0, slash)).map((node: CssNode, index: number) => index);
        const junction: Array<number> = slash === -1 ? cap : top.slice(slash + 1).map((node: CssNode, index: number) => index + slash + 1);
        if (cap.length < 1 || cap.length > 2 || junction.length < 1 || junction.length > 2) {
            return undefined;
        }
        return this.assign([[targets[0], [cap[0]]], [targets[1], [cap[1] ?? cap[0]]], [targets[2], [junction[0]]], [targets[3], [junction[1] ?? junction[0]]]], top);
    }

    private expandGridLines(property: string, top: ReadonlyArray<CssNode>): Array<Longhand> | undefined {
        // CSS Grid 2 §8.4: without a second value, a <custom-ident> start is copied to the end, and anything else gives auto.
        const lines: Array<Array<number>> | undefined = this.splitBySlash(top);
        if (lines === undefined || lines.length > 2) {
            return undefined;
        }
        const targets: ReadonlyArray<string> = this.targets(property);
        const end: Array<number> | undefined = lines[1] ?? (this.isCustomIdent(lines[0], top) ? lines[0] : undefined);
        const start: Longhand | undefined = this.longhandOf(targets[0], lines[0], top);
        const last: Longhand | undefined = end === undefined ? this.keyword(targets[1], "auto") : this.longhandOf(targets[1], end, top);
        return start === undefined || last === undefined ? undefined : [start, last];
    }

    private expandGridArea(top: ReadonlyArray<CssNode>): Array<Longhand> | undefined {
        // CSS Grid 2 §8.4: row-start / column-start / row-end / column-end; an omitted value copies a <custom-ident>
        // from row-start (for column-start) or from its start value (for the ends), else it is auto.
        const lines: Array<Array<number>> | undefined = this.splitBySlash(top);
        if (lines === undefined || lines.length > 4) {
            return undefined;
        }
        const rowStart: Array<number> = lines[0];
        const columnStart: Array<number> | undefined = lines[1] ?? (this.isCustomIdent(rowStart, top) ? rowStart : undefined);
        const rowEnd: Array<number> | undefined = lines[2] ?? (this.isCustomIdent(rowStart, top) ? rowStart : undefined);
        const columnEnd: Array<number> | undefined = lines[3] ?? (columnStart !== undefined && this.isCustomIdent(columnStart, top) ? columnStart : undefined);
        const first: Longhand | undefined = this.longhandOf("grid-row-start", rowStart, top);
        const second: Longhand | undefined = columnStart === undefined ? this.keyword("grid-column-start", "auto") : this.longhandOf("grid-column-start", columnStart, top);
        const third: Longhand | undefined = rowEnd === undefined ? this.keyword("grid-row-end", "auto") : this.longhandOf("grid-row-end", rowEnd, top);
        const fourth: Longhand | undefined = columnEnd === undefined ? this.keyword("grid-column-end", "auto") : this.longhandOf("grid-column-end", columnEnd, top);
        return first === undefined || second === undefined || third === undefined || fourth === undefined ? undefined : [first, second, third, fourth];
    }

    private expandGridTemplate(top: ReadonlyArray<CssNode>): Array<Longhand> | undefined {
        // CSS Grid 2 §7.4: none; rows / columns with no areas; or rows of [line-names]? <string> <track-size>? [line-names]?
        // giving the areas, the rows (auto where no size is given, with adjacent line names merged) and the columns after the slash.
        if (this.singleKeyword(top) === "none") {
            return GRID_TEMPLATE_LONGHANDS.map((property: string) => this.keyword(property, "none"));
        }
        const slash: number = top.findIndex((node: CssNode) => node.type === "Operator" && node.value === "/");
        const before: ReadonlyArray<CssNode> = slash === -1 ? top : top.slice(0, slash);
        const afterIndices: Array<number> | undefined = slash === -1 ? undefined : top.slice(slash + 1).map((node: CssNode, index: number) => index + slash + 1);
        if (!before.some((node: CssNode) => node.type === "String")) {
            if (afterIndices === undefined) {
                return undefined;
            }
            const rows: Longhand | undefined = this.longhandOf("grid-template-rows", before.map((node: CssNode, index: number) => index), top);
            const columns: Longhand | undefined = this.longhandOf("grid-template-columns", afterIndices, top);
            return rows === undefined || columns === undefined ? undefined : [rows, columns, this.keyword("grid-template-areas", "none")];
        }
        const areas: Array<CssValue> = [];
        const rows: Array<CssValue> = [];
        let sized: boolean = true;
        for (const node of before) {
            const value: CssValue | undefined = this.values.parseNodes([node]);
            if (value === undefined) {
                return undefined;
            }
            if (node.type === "String") {
                if (!sized) {
                    rows.push(this.ident("auto"));
                }
                areas.push(value);
                sized = false;
            } else if (node.type === "Brackets") {
                const previous: CssValue | undefined = rows[rows.length - 1];
                if (!sized) {
                    rows.push(this.ident("auto"), value);
                    sized = true;
                } else if (previous !== undefined && previous.kind === "block" && value.kind === "block") {
                    rows[rows.length - 1] = this.mergedNames(previous, value);
                } else {
                    rows.push(value);
                }
            } else {
                rows.push(value);
                sized = true;
            }
        }
        if (!sized) {
            rows.push(this.ident("auto"));
        }
        const columns: Longhand | undefined = afterIndices === undefined ? this.keyword("grid-template-columns", "none") : this.longhandOf("grid-template-columns", afterIndices, top);
        if (columns === undefined) {
            return undefined;
        }
        return [
            { property: "grid-template-rows", value: rows.length === 1 ? rows[0] : { kind: "list", separator: "space", items: rows } },
            columns,
            { property: "grid-template-areas", value: areas.length === 1 ? areas[0] : { kind: "list", separator: "space", items: areas } }
        ];
    }

    private expandGrid(top: ReadonlyArray<CssNode>): Array<Longhand> | undefined {
        // CSS Grid 2 §7.8: a grid-template value resets the grid-auto-* longhands; the auto-flow forms set the tracks of one axis
        // explicitly, the other axis to none, and the auto tracks and flow direction of the other.
        const slash: number = top.findIndex((node: CssNode) => node.type === "Operator" && node.value === "/");
        const isFlow: (node: CssNode) => boolean = (node: CssNode): boolean => node.type === "Identifier" && ["auto-flow", "dense"].includes(node.name.toLowerCase());
        const left: Array<number> = (slash === -1 ? top : top.slice(0, slash)).map((node: CssNode, index: number) => index);
        const right: Array<number> | undefined = slash === -1 ? undefined : top.slice(slash + 1).map((node: CssNode, index: number) => index + slash + 1);
        const leftFlow: boolean = left.some((index: number) => isFlow(top[index]));
        const rightFlow: boolean = right?.some((index: number) => isFlow(top[index])) === true;
        if (!leftFlow && !rightFlow) {
            const template: Array<Longhand> | undefined = this.expandGridTemplate(top);
            return template === undefined ? undefined : [...template, this.initial("grid-auto-rows"), this.initial("grid-auto-columns"), this.initial("grid-auto-flow")];
        }
        if (right === undefined) {
            return undefined;
        }
        const flowSide: Array<number> = leftFlow ? left : right;
        const tracks: Array<number> = flowSide.filter((index: number) => !isFlow(top[index]));
        const dense: boolean = flowSide.some((index: number) => (top[index] as { name?: string }).name?.toLowerCase() === "dense");
        const direction: CssValue = this.ident(leftFlow ? "row" : "column");
        const flow: Longhand = { property: "grid-auto-flow", value: dense ? { kind: "list", separator: "space", items: [direction, this.ident("dense")] } : direction };
        const autoTracks: Longhand | undefined = tracks.length === 0 ? this.initial(leftFlow ? "grid-auto-rows" : "grid-auto-columns") : this.longhandOf(leftFlow ? "grid-auto-rows" : "grid-auto-columns", tracks, top);
        const explicit: Longhand | undefined = this.longhandOf(leftFlow ? "grid-template-columns" : "grid-template-rows", leftFlow ? right : left, top);
        if (autoTracks === undefined || explicit === undefined) {
            return undefined;
        }
        return [
            explicit,
            this.keyword(leftFlow ? "grid-template-rows" : "grid-template-columns", "none"),
            this.keyword("grid-template-areas", "none"),
            autoTracks,
            this.initial(leftFlow ? "grid-auto-columns" : "grid-auto-rows"),
            flow
        ];
    }

    private mergedNames(first: CssValue, second: CssValue): CssValue {
        const names: Array<CssValue> = [];
        for (const block of [first, second]) {
            const content: CssValue | undefined = block.kind === "block" ? block.content : undefined;
            if (content !== undefined) {
                names.push(...(content.kind === "list" ? content.items : [content]));
            }
        }
        return names.length === 0 ? { kind: "block", bracket: "[" } : { kind: "block", bracket: "[", content: { kind: "list", separator: "space", items: names } };
    }

    private isCustomIdent(indices: ReadonlyArray<number>, top: ReadonlyArray<CssNode>): boolean {
        const node: CssNode | undefined = indices.length === 1 ? top[indices[0]] : undefined;
        return node !== undefined && node.type === "Identifier" && !["auto", "span"].includes(node.name.toLowerCase());
    }

    private layeredLonghands(properties: ReadonlyArray<string>, layers: ReadonlyArray<Map<string, CssValue>>): Array<Longhand> | undefined {
        const result: Array<Longhand> = [];
        for (const property of properties) {
            const items: Array<CssValue> = [];
            for (const layer of layers) {
                const item: CssValue | undefined = layer.get(property) ?? this.firstItem(this.initialValue(property));
                if (item === undefined) {
                    return undefined;
                }
                items.push(item);
            }
            result.push({ property, value: items.length === 1 ? items[0] : { kind: "list", separator: "comma", items } });
        }
        return result;
    }

    private layers(top: ReadonlyArray<CssNode>): Array<Array<number>> {
        const layers: Array<Array<number>> = [[]];
        top.forEach((node: CssNode, index: number) => {
            if (node.type === "Operator" && node.value === ",") {
                layers.push([]);
            } else {
                layers[layers.length - 1].push(index);
            }
        });
        return layers;
    }

    private splitBySlash(top: ReadonlyArray<CssNode>): Array<Array<number>> | undefined {
        const parts: Array<Array<number>> = [[]];
        top.forEach((node: CssNode, index: number) => {
            if (node.type === "Operator" && node.value === "/") {
                parts.push([]);
            } else {
                parts[parts.length - 1].push(index);
            }
        });
        return parts.some((part: Array<number>) => part.length === 0) ? undefined : parts;
    }

    private splitByComma(nodes: ReadonlyArray<CssNode>): Array<Array<CssNode>> {
        const groups: Array<Array<CssNode>> = [[]];
        for (const node of nodes) {
            if (node.type === "Operator" && node.value === ",") {
                groups.push([]);
            } else {
                groups[groups.length - 1].push(node);
            }
        }
        return groups;
    }

    private items(matched: MatchNode, indexOf: Map<CssNode, number>, top: ReadonlyArray<CssNode>, terms?: ReadonlyArray<string>): Array<Array<number>> {
        // Without named terms every top-level component of the value is one item.
        if (terms === undefined) {
            return top.map((node: CssNode, index: number) => [index]);
        }
        return this.segments(matched, new Set<string>(terms), indexOf).map((segment: Segment) => segment.indices);
    }

    private assign(pairs: ReadonlyArray<readonly [string, ReadonlyArray<number>]>, top: ReadonlyArray<CssNode>): Array<Longhand> | undefined {
        const result: Array<Longhand> = [];
        for (const [property, indices] of pairs) {
            const longhand: Longhand | undefined = this.longhandOf(property, indices, top);
            if (longhand === undefined) {
                return undefined;
            }
            result.push(longhand);
        }
        return result;
    }

    private longhand(property: string, top: ReadonlyArray<CssNode>): Longhand {
        const value: CssValue | undefined = this.expansions.has(property) ? undefined : this.values.parseNodes(top);
        return value === undefined ? { property, nodes: top } : { property, value, nodes: top };
    }

    private longhandOf(property: string, indices: ReadonlyArray<number>, top: ReadonlyArray<CssNode>): Longhand | undefined {
        const nodes: Array<CssNode> = this.nodesOf(indices, top);
        if (this.expansions.has(property)) {
            return { property, nodes };
        }
        const value: CssValue | undefined = this.values.parseNodes(nodes);
        return value === undefined ? undefined : { property, value, nodes };
    }

    private groupByTarget(segments: ReadonlyArray<Segment>, terms: Readonly<Record<string, string>>): Map<string, Array<number>> {
        const grouped: Map<string, Array<number>> = new Map<string, Array<number>>();
        for (const segment of segments) {
            const target: string = terms[segment.name];
            const indices: Array<number> | undefined = grouped.get(target);
            if (indices === undefined) {
                grouped.set(target, [...segment.indices]);
            } else {
                indices.push(...segment.indices);
            }
        }
        return grouped;
    }

    private segments(matched: MatchNode, names: ReadonlySet<string>, indexOf: Map<CssNode, number>): Array<Segment> {
        // The match tree of the grammar tells which top-level components of the value each named term took.
        const segments: Array<Segment> = [];
        const visit: (entry: MatchNode, root: boolean) => void = (entry: MatchNode, root: boolean): void => {
            const name: string | undefined = entry.syntax?.name;
            if (!root && name !== undefined && (entry.syntax?.type === "Property" || entry.syntax?.type === "Type") && names.has(name)) {
                const indices: Set<number> = new Set<number>();
                this.collectIndices(entry, indexOf, indices);
                segments.push({ name, indices: [...indices].sort((a: number, b: number) => a - b) });
                return;
            }
            if (entry.match !== undefined) {
                for (const child of entry.match) {
                    visit(child, false);
                }
            }
        };
        visit(matched, true);
        return segments.filter((segment: Segment) => segment.indices.length > 0);
    }

    private collectIndices(entry: MatchNode, indexOf: Map<CssNode, number>, indices: Set<number>): void {
        if (entry.node !== undefined && entry.node !== null) {
            const index: number | undefined = indexOf.get(entry.node);
            if (index !== undefined) {
                indices.add(index);
            }
        }
        if (entry.match !== undefined) {
            for (const child of entry.match) {
                this.collectIndices(child, indexOf, indices);
            }
        }
    }

    private topLevelIndex(top: ReadonlyArray<CssNode>): Map<CssNode, number> {
        const indexOf: Map<CssNode, number> = new Map<CssNode, number>();
        top.forEach((node: CssNode, index: number) => {
            walk(node, (inner: CssNode) => {
                indexOf.set(inner, index);
            });
        });
        return indexOf;
    }

    private nodesOf(indices: ReadonlyArray<number>, top: ReadonlyArray<CssNode>): Array<CssNode> {
        // The separators between two components of the same longhand, such as the commas of a font family list, belong to it.
        const nodes: Array<CssNode> = [];
        for (let position: number = 0; position < indices.length; position++) {
            if (position > 0) {
                const gap: Array<CssNode> = top.slice(indices[position - 1] + 1, indices[position]);
                if (gap.every((node: CssNode) => node.type === "Operator")) {
                    nodes.push(...gap);
                }
            }
            nodes.push(top[indices[position]]);
        }
        return nodes;
    }

    private valueOf(indices: ReadonlyArray<number>, top: ReadonlyArray<CssNode>): CssValue | undefined {
        return this.values.parseNodes(this.nodesOf(indices, top));
    }

    private initialValue(property: string): CssValue | undefined {
        let value: CssValue | undefined = this.initialValues.get(property);
        if (value === undefined && this.noInitial?.has(property) !== true) {
            const text: string | undefined = this.table.definition(property)?.initial;
            value = text === undefined ? undefined : this.values.parse(parse(text, { context: "value" }) as Value);
            if (value === undefined) {
                this.noInitial = this.noInitial ?? new Set<string>();
                this.noInitial.add(property);
            } else {
                this.initialValues.set(property, value);
            }
        }
        return value;
    }

    private firstItem(value?: CssValue): CssValue | undefined {
        return value !== undefined && value.kind === "list" && value.separator === "comma" ? value.items[0] : value;
    }

    private initial(property: string): Longhand {
        return { property };
    }

    private keyword(property: string, name: string): Longhand {
        return { property, value: this.ident(name) };
    }

    private number(property: string, value: number): Longhand {
        return { property, value: { kind: "number", value, integer: Number.isInteger(value) } };
    }

    private ident(name: string): CssValue {
        return { kind: "ident", name, lower: name };
    }

    private singleKeyword(top: ReadonlyArray<CssNode>): string | undefined {
        return top.length === 1 && top[0].type === "Identifier" ? top[0].name.toLowerCase() : undefined;
    }

    private isKeyword(keyword: string, value?: CssValue): boolean {
        return value !== undefined && value.kind === "ident" && value.lower === keyword;
    }
}
