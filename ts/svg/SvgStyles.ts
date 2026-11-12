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

import type { CssNode, Declaration as CssTreeDeclaration, MediaQueryList } from "css-tree";
import { parse, tokenize, tokenTypes } from "css-tree";
import type { XMLAttribute, XMLDocument, XMLNode } from "typesxml";
import { ProcessingInstruction, TextNode, XMLElement } from "typesxml";
import { AnPlusBParser } from "../css/AnPlusBParser.js";
import type { AttributeMatcher, CompiledSelector, CompiledSelectorStep, CompoundSelector, NthMatcher, RelativeSelector } from "../css/CompiledSelector.js";
import { ConditionEvaluator } from "../css/ConditionEvaluator.js";
import { DeclarationReader } from "../css/DeclarationReader.js";
import type { PropertyTable } from "../css/PropertyTable.js";
import { ShorthandExpander } from "../css/ShorthandExpander.js";
import type { TriState } from "../css/ConditionEvaluator.js";
import type {
    ContainerCondition, ContainerQuery, CssWideKeyword, Declaration, DeclaredValue, DescriptorRule, FontFaceRule, FontFeatureValuesRule, FunctionRule, PendingSubstitution,
    PropertyRule, Scope, StyleRule, Stylesheet
} from "../css/Stylesheet.js";
import { SyntaxDefinition } from "../css/SyntaxDefinition.js";
import { DEFAULT_PAGE_SIZE, StylesheetReader } from "../css/StylesheetReader.js";
import { CalcSimplifier } from "../css/values/CalcSimplifier.js";
import { ColorKeywords } from "../css/values/ColorKeywords.js";
import type { ParsedColor } from "../css/values/ColorParser.js";
import { ColorParser } from "../css/values/ColorParser.js";
import { CssUnits } from "../css/values/CssUnits.js";
import type { BaseType, CssValue } from "../css/values/CssValue.js";
import { CssValueParser } from "../css/values/CssValueParser.js";
import type { PaletteRule } from "../paint/ColorGlyphPainter.js";
import { ColorGlyphPainter } from "../paint/ColorGlyphPainter.js";
import { SourceElement } from "../parse/SourceElement.js";
import { BaseUrls } from "../pdf/BaseUrls.js";
import type { StyleComputer } from "../pdf/StyleComputer.js";
import type { CustomValue, SubstitutionHost } from "../pdf/ValueSubstitution.js";
import { ValueSubstitution } from "../pdf/ValueSubstitution.js";
import type { DocumentFonts } from "../PdfGenerator.js";
import type { ComputedStyle } from "../pdf/ComputedStyle.js";
import { ElementUnits } from "../pdf/ElementUnits.js";
import { FontMatcher } from "../pdf/FontMatcher.js";
import type { FontMetrics } from "../pdf/FontMetrics.js";
import { LanguageRangeMatcher } from "../pdf/LanguageRangeMatcher.js";
import { LengthResolver } from "../pdf/LengthResolver.js";
import { SvgGeometry } from "./SvgGeometry.js";

export interface SvgNode {
    element: XMLElement;
    parent?: SvgNode;
}

interface Resolution {
    node: SvgNode;
    cascaded: ReadonlyMap<string, DeclaredValue>;
    parent: ComputedStyle;
    values: Record<string, CssValue>;
    inherited: Record<string, CssValue>;
    parentCustoms: ReadonlyMap<string, CustomValue>;
    customs: Map<string, CustomValue | null>;
    done: Set<string>;
    host?: SubstitutionHost;
    replaced?: Map<PendingSubstitution, ReadonlyArray<Declaration> | CssWideKeyword | null>;
    stack?: Array<string>;
    cyclic?: Set<string>;
}

const XML_NAMESPACE: string = "http://www.w3.org/XML/1998/namespace";
const XLINK_NAMESPACE: string = "http://www.w3.org/1999/xlink";
const XHTML_NAMESPACE: string = "http://www.w3.org/1999/xhtml";
const SVG_NAMESPACE: string = "http://www.w3.org/2000/svg";
const MEDIUM: number = 16;
const RELATIVE_SIZE_RATIO: number = 1.2;
const SIZE_FACTORS: ReadonlyMap<string, number> = new Map<string, number>([
    ["xx-small", 3 / 5], ["x-small", 3 / 4], ["small", 8 / 9], ["medium", 1], ["large", 6 / 5], ["x-large", 3 / 2], ["xx-large", 2], ["xxx-large", 3]
]);
const USER_AGENT_SHEET: string = "@namespace url(" + SVG_NAMESPACE + "); @namespace xml url(" + XML_NAMESPACE + ");"
    + " svg:not(:root), image, marker, pattern, symbol { overflow: hidden }"
    + " *:not(svg), *:not(foreignObject) > svg { transform-origin: 0 0 }"
    + " *[xml|space=preserve] { white-space-collapse: preserve-spaces }"
    + " style, defs, symbol, marker { display: none !important }";
const PRESENTATION: ReadonlySet<string> = new Set<string>([
    "alignment-baseline", "baseline-shift", "clip-path", "clip-rule", "color", "color-interpolation", "color-interpolation-filters", "cursor", "direction",
    "display", "dominant-baseline", "fill", "fill-opacity", "fill-rule", "filter", "flood-color", "flood-opacity", "font-family", "font-size",
    "font-size-adjust", "font-stretch", "font-style", "font-variant", "font-weight", "glyph-orientation-vertical", "image-rendering", "letter-spacing",
    "lighting-color", "marker-end", "marker-mid", "marker-start", "mask", "mask-type", "opacity", "overflow", "paint-order", "pointer-events",
    "shape-rendering", "stop-color", "stop-opacity", "stroke", "stroke-dasharray", "stroke-dashoffset", "stroke-linecap", "stroke-linejoin",
    "stroke-miterlimit", "stroke-opacity", "stroke-width", "text-anchor", "text-decoration", "text-overflow", "text-rendering", "transform-origin",
    "unicode-bidi", "vector-effect", "visibility", "white-space", "word-spacing", "writing-mode"
]);
const GEOMETRY: ReadonlyMap<string, ReadonlySet<string>> = new Map<string, ReadonlySet<string>>([
    ["cx", new Set<string>(["circle", "ellipse"])], ["cy", new Set<string>(["circle", "ellipse"])], ["r", new Set<string>(["circle"])],
    ["rx", new Set<string>(["ellipse", "rect"])], ["ry", new Set<string>(["ellipse", "rect"])],
    ["x", new Set<string>(["foreignObject", "image", "rect", "svg", "symbol", "use"])], ["y", new Set<string>(["foreignObject", "image", "rect", "svg", "symbol", "use"])],
    ["width", new Set<string>(["foreignObject", "image", "rect", "svg", "symbol", "use"])], ["height", new Set<string>(["foreignObject", "image", "rect", "svg", "symbol", "use"])],
    ["pathLength", new Set<string>(["path", "circle", "ellipse", "line", "polygon", "polyline", "rect"])]
]);
const TRANSFORM_ATTRIBUTES: ReadonlyMap<string, string> = new Map<string, string>([["pattern", "patternTransform"], ["linearGradient", "gradientTransform"], ["radialGradient", "gradientTransform"]]);
const TRANSFORM_ARGUMENTS: Readonly<Record<string, readonly [number, number]>> = { matrix: [6, 6], translate: [1, 2], scale: [1, 2], rotate: [1, 3], skewX: [1, 1], skewY: [1, 1] };
const LEGACY_WRITING_MODES: ReadonlyMap<string, string> = new Map<string, string>([
    ["lr", "horizontal-tb"], ["lr-tb", "horizontal-tb"], ["rl", "horizontal-tb"], ["rl-tb", "horizontal-tb"], ["tb", "vertical-rl"], ["tb-rl", "vertical-rl"]
]);
const WHITE_SPACE: RegExp = /[\t\n\f\r ]+/;
const PRIORITIES: ReadonlyMap<string, number> = new Map<string, number>([
    ["writing-mode", 0], ["direction", 0], ["text-orientation", 0], ["font-size", 1], ["font-family", 2], ["font-style", 2], ["font-weight", 2], ["font-width", 2],
    ["font-optical-sizing", 2], ["font-variation-settings", 2], ["font-size-adjust", 3], ["line-height", 4], ["color", 5]
]);
const LATER: number = 6;
const UNSET: DeclaredValue = { kind: "keyword", keyword: "unset" };
const NO_CUSTOMS: ReadonlyMap<string, CustomValue> = new Map<string, CustomValue>();
const NO_DECLARATIONS: ReadonlyMap<string, DeclaredValue> = new Map<string, DeclaredValue>();
const NON_NEGATIVE: ReadonlySet<string> = new Set<string>(["stroke-width", "stroke-miterlimit", "rx", "ry", "r", "width", "height", "path-length"]);
const BOX_HINTS: ReadonlySet<string> = new Set<string>(["display", "width", "height", "overflow"]);
const UNSCOPED: number = Number.NEGATIVE_INFINITY;
const NO_LAYER: string = "";
const FONT_DEPENDENCIES: ReadonlyArray<string> = ["writing-mode", "font-size", "font-family", "font-style", "font-weight", "font-width", "font-size-adjust", "line-height"];
const PALETTE_RULE: string = "font-palette-values";
const NO_PALETTES: ReadonlyArray<PaletteRule> = [];
const STYLE_QUERY: RegExp = /(?:^|[^\w-])style\s*\(/i;
const NO_SCOPE: ReadonlyArray<readonly [SvgNode | undefined, number]> = [[undefined, Number.POSITIVE_INFINITY]];

export class SvgStyles {

    readonly root: XMLElement;
    readonly url: string;
    readonly diagnostics: Array<string> = [];
    private readonly table: PropertyTable;
    private readonly reader: DeclarationReader;
    private readonly values: CssValueParser = new CssValueParser();
    private readonly lengths: LengthResolver = new LengthResolver();
    private readonly load: (url: string) => Buffer | undefined;
    private readonly fontsFor: (rules: ReadonlyArray<FontFaceRule>, features: ReadonlyArray<FontFeatureValuesRule>) => DocumentFonts;
    private agentSheet?: Stylesheet;
    private authorSheet?: Stylesheet;
    private ownFonts?: DocumentFonts;
    private ownPalettes?: ReadonlyArray<PaletteRule>;
    private hostPalettes: ReadonlyArray<PaletteRule> = NO_PALETTES;
    private documentRoot?: ComputedStyle;
    private readonly scopes: Map<XMLElement, ReadonlyMap<string, string>> = new Map<XMLElement, ReadonlyMap<string, string>>();
    private readonly parents: Map<XMLElement, XMLElement> = new Map<XMLElement, XMLElement>();
    private readonly ids: Map<string, XMLElement> = new Map<string, XMLElement>();
    private readonly attached: Map<XMLElement, readonly [ReadonlyArray<Declaration>, ReadonlyArray<Declaration>]> = new Map<XMLElement, readonly [ReadonlyArray<Declaration>, ReadonlyArray<Declaration>]>();
    private readonly styles: WeakMap<SvgNode, ComputedStyle> = new WeakMap<SvgNode, ComputedStyle>();
    private readonly simplifier: CalcSimplifier = new CalcSimplifier();
    private readonly keywords: ColorKeywords = new ColorKeywords();
    private colors?: ColorParser;
    private conditions?: ConditionEvaluator;
    private anPlusB?: AnPlusBParser;
    private ranges?: LanguageRangeMatcher;
    private geometry?: SvgGeometry;
    private places?: Map<XMLElement, readonly [SvgNode, ComputedStyle]>;
    private customs?: WeakMap<ComputedStyle, ReadonlyMap<string, CustomValue>>;
    private substituter?: ValueSubstitution;
    private expander?: ShorthandExpander;
    private cssUnits?: CssUnits;
    private hostSheet?: Stylesheet;
    private readonly computer: StyleComputer;
    private registered?: ReadonlyMap<string, PropertyRule>;
    private initials?: Map<string, CustomValue | null>;
    private initialStyle?: ComputedStyle;
    private viewport: readonly [number, number] = [300, 150];
    private rootValues?: Readonly<Record<string, CssValue>>;
    private readonly source: XMLDocument | XMLElement;
    private readonly outer: ReadonlyMap<string, string>;
    private sheetsRead: boolean = false;
    private hostRules?: ReadonlyArray<StyleRule>;
    private hostHolds?: (queries: ReadonlyArray<ContainerQuery>) => boolean;
    private hostStyle?: ComputedStyle;
    private hostRoot?: SourceElement;
    private hostIds?: Map<string, XMLElement>;
    private hostLayers: ReadonlyArray<readonly [string, ReadonlyArray<string>]> = [];
    private layerRanks?: Map<string, number>;
    private readonly rootOf: WeakMap<Scope, XMLElement> = new WeakMap<Scope, XMLElement>();
    private rootPlace?: SvgNode;
    private scopeNode?: SvgNode;

    constructor(source: XMLDocument | XMLElement, url: string, table: PropertyTable, computer: StyleComputer,
        fontsFor: (rules: ReadonlyArray<FontFaceRule>, features: ReadonlyArray<FontFeatureValuesRule>) => DocumentFonts, load: (url: string) => Buffer | undefined,
        outer: ReadonlyMap<string, string> = new Map<string, string>([["xml", XML_NAMESPACE]])) {
        this.source = source;
        this.root = source instanceof XMLElement ? source : source.getRoot() as XMLElement;
        this.url = url;
        this.table = table;
        this.computer = computer;
        this.reader = new DeclarationReader(table);
        this.fontsFor = fontsFor;
        this.load = load;
        this.outer = outer;
        this.index(this.root, outer);
    }

    fonts(): DocumentFonts {
        // The fonts of the image depend on the @font-face and @font-feature-values rules of its style sheets, so those are read first.
        if (this.ownFonts === undefined) {
            this.loadSheets();
            const sheet: Stylesheet = this.authorSheet as Stylesheet;
            this.ownFonts = this.fontsFor(sheet.fontFaces, sheet.fontFeatureValues);
        }
        return this.ownFonts;
    }

    palettes(): ReadonlyArray<PaletteRule> {
        // CSS Fonts 4 §9.2: var(), env() and relative units in the descriptors "are evaluated within the context of the root element",
        // which for an svg element of the document is the root of the document, whose own rules come first.
        if (this.ownPalettes === undefined) {
            this.loadSheets();
            const root: ComputedStyle = this.documentRoot ?? this.style(this.rootNode());
            const customs: ReadonlyMap<string, CustomValue> = this.documentRoot === undefined ? this.customs?.get(root) ?? NO_CUSTOMS
                : new Map<string, CustomValue>(Object.entries(root.custom));
            const resolution: Resolution = {
                node: { element: this.hostRoot ?? this.root }, cascaded: NO_DECLARATIONS, parent: root, values: root.values as Record<string, CssValue>,
                inherited: root.inherited as Record<string, CssValue>, parentCustoms: customs, customs: new Map<string, CustomValue | null>(), done: new Set<string>()
            };
            const own: Array<PaletteRule> = (this.authorSheet as Stylesheet).fontPalettes.map((rule: DescriptorRule): PaletteRule => {
                const values: Record<string, CssValue> = {};
                for (const [name, declared] of Object.entries(rule.descriptors)) {
                    const value: CssValue | undefined = this.descriptor(name, declared, resolution);
                    if (value !== undefined) {
                        values[name] = value;
                    }
                }
                return ColorGlyphPainter.fromValues(rule.name, values);
            });
            this.ownPalettes = own.length === 0 ? this.hostPalettes : [...this.hostPalettes, ...own];
        }
        return this.ownPalettes;
    }

    private descriptor(name: string, declared: DeclaredValue, resolution: Resolution): CssValue | undefined {
        let read: DeclaredValue | undefined = declared;
        if (declared.kind === "pending") {
            const result: ReadonlyArray<Declaration> | CssWideKeyword | undefined = this.substitution().replace(declared, name, this.hostOf(resolution), PALETTE_RULE);
            read = result === undefined || typeof result === "string" ? undefined : result.find((declaration: Declaration) => declaration.property === name)?.value;
        }
        if (read === undefined || read.kind !== "value") {
            return undefined;
        }
        if (name !== "override-colors") {
            return this.absolute(read.value, this.units(resolution.values, resolution.values, resolution.values));
        }
        // CSS Fonts 4 §9.2.3: "Each specified <color> must be an absolute color, otherwise the descriptor is invalid."
        this.colors = this.colors ?? new ColorParser(undefined);
        return this.colors.isAbsolute(read.value) ? this.colored(read.value) : undefined;
    }

    private get metrics(): FontMetrics {
        return this.fonts()[0];
    }

    embed(sheet: Stylesheet, box: ComputedStyle, root: ComputedStyle, palettes: ReadonlyArray<PaletteRule>, hostRoot: SourceElement,
        holds: (queries: ReadonlyArray<ContainerQuery>) => boolean): void {
        this.hostSheet = sheet;
        this.hostRules = sheet.styleRules;
        this.hostLayers = sheet.layers;
        this.rootValues = root.values;
        this.documentRoot = root;
        this.hostPalettes = palettes;
        this.hostRoot = hostRoot;
        this.hostHolds = holds;
        this.host(box);
    }

    host(box: ComputedStyle): void {
        const values: Record<string, CssValue> = Object.create(this.initial().values) as Record<string, CssValue>;
        for (const property of this.table.names()) {
            const inherited: CssValue | undefined = box.inherited[property];
            if (inherited !== undefined && this.table.definition(property)?.inherited === true) {
                values[property] = inherited;
            }
        }
        this.hostStyle = { values, inherited: values, custom: {} };
        const customs: Map<string, CustomValue> = new Map<string, CustomValue>(Object.entries(box.custom));
        if (customs.size > 0) {
            this.customs = this.customs ?? new WeakMap<ComputedStyle, ReadonlyMap<string, CustomValue>>();
            this.customs.set(this.hostStyle, customs);
        }
    }

    loadSheets(): void {
        if (this.sheetsRead) {
            return;
        }
        this.sheetsRead = true;
        this.agentSheet = new StylesheetReader(this.table).readText(USER_AGENT_SHEET, this.url);
        // SVG 2 §6.3 and §6.9: the xml-stylesheet processing instructions, then the style sheets in the document; Associating
        // Style Sheets with XML Documents 1.0 puts the instructions "in the document's prolog".
        const instructions: Array<string> = [];
        if (!(this.source instanceof XMLElement)) {
            for (const node of this.source.contentIterator() as IterableIterator<XMLNode>) {
                if (node === this.root) {
                    break;
                }
                if (node instanceof ProcessingInstruction && node.getTarget() === "xml-stylesheet") {
                    instructions.push(node.getData());
                }
            }
        }
        const reader: StylesheetReader = new StylesheetReader(this.table, this.load);
        this.added(reader.readLinked(instructions, this.url));
        this.sheets(this.root, reader);
        const sheet: Stylesheet = this.authorSheet as Stylesheet;
        this.diagnostics.push(...sheet.diagnostics);
        if (sheet.colorProfiles.length > 0) {
            throw new Error("The @color-profile rule in the style sheet of the SVG image " + this.url + " is not implemented");
        }
        // A style() query needs the computed styles of the ancestors of an SVG element, which are not available to the cascade.
        if (sheet.styleRules.some((rule: StyleRule) => rule.containers.some((query: ContainerQuery) =>
            query.conditions.some((condition: ContainerCondition) => condition.query !== undefined && STYLE_QUERY.test(condition.query))))) {
            throw new Error("A container style query in the style sheet of the SVG image " + this.url + " is not implemented");
        }
    }

    private added(sheet: Stylesheet, owner?: XMLElement): void {
        // Cascade 6 §2.5.4: without <scope-start> the scoping root is the parent element of the owner node of the style sheet;
        // Media Queries 5 §10: the custom media queries of a sheet hold for the media attributes after it.
        const before: number = this.authorSheet?.styleRules.length ?? 0;
        this.authorSheet = sheet;
        for (const rule of sheet.styleRules.slice(before)) {
            for (let scope: Scope | undefined = rule.scope; scope !== undefined && owner !== undefined; scope = scope.parent) {
                if (scope.start === undefined) {
                    this.rootOf.set(scope, owner);
                }
            }
        }
        this.conditions = this.conditions ?? new ConditionEvaluator(DEFAULT_PAGE_SIZE);
        for (const [name, value] of sheet.customMedia) {
            if (typeof value === "boolean") {
                this.conditions.define(name, value);
                continue;
            }
            try {
                const list: CssNode = parse(value, { context: "mediaQueryList" });
                if (list.type === "MediaQueryList") {
                    this.conditions.define(name, list);
                }
            } catch {
                // do nothing: an invalid media query list defines nothing
            }
        }
    }

    setViewport(width: number, height: number): void {
        this.viewport = [width, height];
    }

    rootNode(): SvgNode {
        // The root of an embedded image has the document's elements above it, for the selectors of the document's style sheet.
        if (this.rootPlace === undefined) {
            let above: SvgNode | undefined;
            const ancestors: Array<SourceElement> = [];
            for (let ancestor: SourceElement | undefined = this.hostRoot === undefined ? undefined : (this.root as SourceElement).getParent(); ancestor !== undefined; ancestor = ancestor.getParent()) {
                ancestors.unshift(ancestor);
            }
            for (const element of ancestors) {
                above = above === undefined ? { element } : { element, parent: above };
            }
            this.rootPlace = above === undefined ? { element: this.root } : { element: this.root, parent: above };
        }
        return this.rootPlace;
    }

    boxHints(): ReadonlyArray<Declaration> {
        // SVG 2 §8.3: the presentation attributes of the outermost svg element that the box showing it reads; the others are
        // painted by the image.
        return this.attachedTo(this.root)[0].filter((declaration: Declaration) => BOX_HINTS.has(declaration.property));
    }

    styleAttribute(): ReadonlyArray<Declaration> {
        return this.attachedTo(this.root)[1];
    }

    classNames(): ReadonlyArray<string> {
        // SVG 2 §6.5: the class attribute holds the class names, as in HTML.
        return (this.attribute(this.root, "class") ?? "").split(WHITE_SPACE).filter((name: string) => name.length > 0);
    }

    element(id: string): XMLElement | undefined {
        return this.ids.get(id) ?? this.hostElement(id);
    }

    private hostElement(id: string): XMLElement | undefined {
        // A reference can name an element of another svg of the document, which is looked for only when one does.
        if (this.hostRoot === undefined) {
            return undefined;
        }
        if (this.hostIds === undefined) {
            const ids: Map<string, XMLElement> = new Map<string, XMLElement>();
            const pending: Array<XMLElement> = [this.hostRoot];
            while (pending.length > 0) {
                const current: XMLElement = pending.pop() as XMLElement;
                const own: string | undefined = current.getAttribute("id")?.getValue() ?? current.getAttribute("xml:id")?.getValue();
                if (own !== undefined && !ids.has(own)) {
                    ids.set(own, current);
                }
                const children: Array<XMLElement> = current.getChildren();
                for (let child: number = children.length - 1; child >= 0; child--) {
                    pending.push(children[child]);
                }
            }
            this.hostIds = ids;
        }
        return this.hostIds.get(id);
    }

    private namespaceOf(element: XMLElement): string | undefined {
        // The tree builder gives an unprefixed element of the document its xmlns unless that is the root's, which outer holds.
        const name: string = element.getName();
        const colon: number = name.indexOf(":");
        const scope: ReadonlyMap<string, string> | undefined = this.scopes.get(element);
        const uri: string | undefined = scope === undefined && colon < 0 ? element.getAttribute("xmlns")?.getValue() ?? this.outer.get("")
            : (scope ?? this.outer).get(colon < 0 ? "" : name.substring(0, colon));
        return uri === undefined || uri.length === 0 ? undefined : uri;
    }

    private prefixUri(element: XMLElement, prefix: string): string | undefined {
        return (this.scopes.get(element) ?? this.outer).get(prefix);
    }

    localName(element: XMLElement): string {
        const name: string = element.getName();
        return name.substring(name.indexOf(":") + 1);
    }

    isSvg(element: XMLElement, localName?: string): boolean {
        return this.namespaceOf(element) === SVG_NAMESPACE && (localName === undefined || this.localName(element) === localName);
    }

    attribute(element: XMLElement, localName: string, namespace?: string): string | undefined {
        // Namespaces in XML 1.0 §6.2: an unprefixed attribute is in no namespace.
        for (const attribute of element.getAttributes() as Array<XMLAttribute>) {
            const name: string = attribute.getName();
            const colon: number = name.indexOf(":");
            if (name.substring(colon + 1) === localName && !name.startsWith("xmlns")
                && (colon < 0 ? undefined : this.prefixUri(element, name.substring(0, colon))) === namespace) {
                return attribute.getValue();
            }
        }
        return undefined;
    }

    href(element: XMLElement): string | undefined {
        // SVG 2 §16.1.7: href, or xlink:href when href is absent.
        return this.attribute(element, "href") ?? this.attribute(element, "href", XLINK_NAMESPACE);
    }

    resolve(reference: string): string {
        return BaseUrls.resolved(reference, this.url) ?? reference;
    }

    private index(element: XMLElement, inherited: ReadonlyMap<string, string>): void {
        let scope: Map<string, string> | undefined;
        for (const attribute of element.getAttributes() as Array<XMLAttribute>) {
            const name: string = attribute.getName();
            if (name === "xmlns" || name.startsWith("xmlns:")) {
                // The tree builder can repeat the xmlns in scope on every element, which needs no scope of its own.
                const prefix: string = name === "xmlns" ? "" : name.substring(6);
                if ((scope ?? inherited).get(prefix) !== attribute.getValue()) {
                    scope = scope ?? new Map<string, string>(inherited);
                    scope.set(prefix, attribute.getValue());
                }
            }
        }
        const current: ReadonlyMap<string, string> = scope ?? inherited;
        this.scopes.set(element, current);
        const id: string | undefined = element.getAttribute("id")?.getValue() ?? element.getAttribute("xml:id")?.getValue();
        if (id !== undefined && !this.ids.has(id)) {
            this.ids.set(id, element);
        }
        for (const child of element.getChildren()) {
            this.parents.set(child, element);
            this.index(child, current);
        }
    }

    private sheets(element: XMLElement, reader: StylesheetReader): void {
        // SVG 2 §6.2 and §6.3, HTML §4.2.4 and §4.2.6: style elements of type text/css, and stylesheet links.
        const namespace: string | undefined = this.namespaceOf(element);
        const name: string = this.localName(element);
        if ((namespace === SVG_NAMESPACE || namespace === XHTML_NAMESPACE) && name === "style") {
            const type: string = (this.attribute(element, "type") ?? "").trim().toLowerCase();
            if ((type.length === 0 || type === "text/css") && this.mediaHolds(this.attribute(element, "media"))) {
                this.added(reader.readText(this.text(element), this.url), this.parents.get(element));
            }
            return;
        }
        if (namespace === XHTML_NAMESPACE && name === "link") {
            const relations: Array<string> = (this.attribute(element, "rel") ?? "").toLowerCase().split(WHITE_SPACE);
            const href: string | undefined = this.attribute(element, "href");
            if (relations.includes("stylesheet") && !relations.includes("alternate") && href !== undefined && this.mediaHolds(this.attribute(element, "media"))) {
                this.added(reader.readLink(href, this.url), this.parents.get(element));
            }
            return;
        }
        for (const child of element.getChildren()) {
            this.sheets(child, reader);
        }
    }

    private text(element: XMLElement): string {
        let text: string = "";
        for (const node of element.getContent()) {
            if (node instanceof TextNode) {
                text += node.getValue();
            }
        }
        return text;
    }

    private mediaHolds(media: string | undefined): boolean {
        if (media === undefined || media.trim().length === 0) {
            return true;
        }
        try {
            const list: CssNode = parse(media, { context: "mediaQueryList" });
            return list.type === "MediaQueryList" && this.media(list);
        } catch {
            return false;
        }
    }

    private media(list: MediaQueryList): boolean {
        this.conditions = this.conditions ?? new ConditionEvaluator(DEFAULT_PAGE_SIZE);
        return this.conditions.matchesList(list);
    }

    private rank(key: string): number {
        // CSS Cascade 5 §6.4.2 and §6.4.3: the document's layers and the image's share one order, and a layer of the same name is one layer.
        if (this.layerRanks === undefined) {
            const merged: Map<string, Array<string>> = new Map<string, Array<string>>();
            for (const [name, children] of this.hostLayers) {
                merged.set(name, [...children]);
            }
            const own: Map<string, ReadonlyArray<string>> = new Map<string, ReadonlyArray<string>>((this.authorSheet?.layers ?? []).map(
                ([name, children]: readonly [string, ReadonlyArray<string>]): [string, ReadonlyArray<string>] => [this.imageLayer(name), children.map((child: string) => this.imageLayer(child))]));
            const add: (name: string) => void = (name: string): void => {
                if (!merged.has(name)) {
                    merged.set(name, []);
                }
                for (const child of own.get(name) ?? []) {
                    if (!(merged.get(name) as Array<string>).includes(child)) {
                        (merged.get(name) as Array<string>).push(child);
                    }
                    add(child);
                }
            };
            add(NO_LAYER);
            const ranks: Map<string, number> = new Map<string, number>();
            const visit: (current: string) => void = (current: string): void => {
                for (const child of merged.get(current) as Array<string>) {
                    visit(child);
                }
                ranks.set(current, ranks.size);
            };
            visit(NO_LAYER);
            this.layerRanks = ranks;
        }
        return this.layerRanks.get(key) as number;
    }

    private imageLayer(name: string): string {
        // An anonymous layer of the image is not the one of the same number in the document.
        return name.split(".").map((part: string) => part.startsWith("#") ? "#image" + part.substring(1) : part).join(".");
    }

    style(node: SvgNode, parent?: ComputedStyle): ComputedStyle {
        let style: ComputedStyle | undefined = this.styles.get(node);
        if (style === undefined) {
            style = this.compute(node, this.cascade(node), parent ?? (node.element === this.root ? this.hostStyle : undefined));
            this.styles.set(node, style);
        }
        return style;
    }

    placed(element: XMLElement): readonly [SvgNode, ComputedStyle] {
        // An element used through a reference keeps the style of its place in its document.
        this.places = this.places ?? new Map<XMLElement, readonly [SvgNode, ComputedStyle]>();
        let place: readonly [SvgNode, ComputedStyle] | undefined = this.places.get(element);
        if (place === undefined) {
            const parent: XMLElement | undefined = element === this.root ? undefined : this.parents.get(element) ?? (element instanceof SourceElement ? element.getParent() : undefined);
            const above: readonly [SvgNode, ComputedStyle] | undefined = parent === undefined ? undefined : this.placed(parent);
            const node: SvgNode = element === this.root ? this.rootNode() : (above === undefined ? { element } : { element, parent: above[0] });
            place = [node, this.style(node, above?.[1])];
            this.places.set(element, place);
        }
        return place;
    }

    private cascade(node: SvgNode): Map<string, DeclaredValue> {
        // CSS Cascade 5 §6.1 and §6.5: important UA, important author, author, presentational hints, UA, then layers, specificity,
        // scope proximity and order; §7.3.4: revert goes back to the UA origin, and revert-layer to the layer below.
        this.loadSheets();
        const candidates: Map<string, Array<readonly [DeclaredValue, ReadonlyArray<number>]>> = new Map<string, Array<readonly [DeclaredValue, ReadonlyArray<number>]>>();
        const add: (declaration: Declaration, key: ReadonlyArray<number>) => void = (declaration: Declaration, key: ReadonlyArray<number>): void => {
            const list: Array<readonly [DeclaredValue, ReadonlyArray<number>]> = candidates.get(declaration.property) ?? [];
            list.push([declaration.value, key]);
            candidates.set(declaration.property, list);
        };
        const hostCount: number = this.hostRules === undefined ? 0 : this.hostRules.length;
        this.hostCandidates(node, add);
        const author: Stylesheet = this.authorSheet as Stylesheet;
        for (const [sheet, agent] of [[this.agentSheet as Stylesheet, true], [author, false]] as Array<[Stylesheet, boolean]>) {
            sheet.styleRules.forEach((rule: StyleRule, order: number) => {
                // Without a host document there is no query container, so a container query is unknown and its rules do not apply.
                if (rule.containers.length > 0 && (this.hostHolds === undefined || !this.hostHolds(rule.containers))) {
                    return;
                }
                let specificity: readonly [number, number, number] | undefined;
                let proximity: number = Number.POSITIVE_INFINITY;
                if (rule.scope === undefined) {
                    specificity = this.specificity(node, rule.selectors);
                } else {
                    const found: readonly [readonly [number, number, number], number] | undefined = this.scoped(node, rule.selectors, rule.scope);
                    if (found !== undefined) {
                        [specificity, proximity] = found;
                    }
                }
                if (specificity !== undefined) {
                    const rank: number = agent ? 0 : this.rank(this.imageLayer(author.layers[rule.layer][0]));
                    const own: readonly [number, number, number] = specificity;
                    rule.declarations.forEach((declaration: Declaration, position: number) => {
                        if (!this.inRange(declaration)) {
                            return;
                        }
                        const layer: number = declaration.important ? -rank : rank;
                        add(declaration, [declaration.important ? (agent ? 4 : 3) : (agent ? 0 : 2), 0, layer, ...own, -proximity, agent ? order : hostCount + order, position]);
                    });
                }
            });
        }
        const [hints, style]: readonly [ReadonlyArray<Declaration>, ReadonlyArray<Declaration>] = this.attachedTo(node.element);
        for (const hint of hints) {
            add(hint, [1, 0, 0, 0, 0, 0, UNSCOPED, 0, 0]);
        }
        style.forEach((declaration: Declaration, position: number) => {
            add(declaration, [declaration.important ? 3 : 2, 1, 0, 0, 0, 0, UNSCOPED, 0, position]);
        });
        const result: Map<string, DeclaredValue> = new Map<string, DeclaredValue>();
        for (const [property, list] of candidates) {
            list.sort((first: readonly [DeclaredValue, ReadonlyArray<number>], second: readonly [DeclaredValue, ReadonlyArray<number>]) => this.compare(second[1], first[1]));
            let winner: DeclaredValue = UNSET;
            for (let index: number = 0; index < list.length; index++) {
                const [value, key]: readonly [DeclaredValue, ReadonlyArray<number>] = list[index];
                if (value.kind !== "keyword" || (value.keyword !== "revert" && value.keyword !== "revert-layer")) {
                    winner = value;
                    break;
                }
                if (key[0] === 0 || key[0] === 4) {
                    break;
                }
                const layer: boolean = value.keyword === "revert-layer";
                while (index + 1 < list.length && (layer ? list[index + 1][1][0] === key[0] && list[index + 1][1][1] === key[1] && list[index + 1][1][2] === key[2]
                    : list[index + 1][1][0] !== 0 && list[index + 1][1][0] !== 4)) {
                    index++;
                }
            }
            result.set(property, winner);
        }
        return result;
    }

    private hostCandidates(node: SvgNode, add: (declaration: Declaration, key: ReadonlyArray<number>) => void): void {
        this.hostRules?.forEach((rule: StyleRule, order: number) => {
            if (rule.containers.length > 0 && this.hostHolds?.(rule.containers) !== true) {
                return;
            }
            const found: readonly [readonly [number, number, number], number] | undefined = this.scoped(node, rule.selectors, rule.scope);
            if (found !== undefined) {
                const [own, proximity]: readonly [readonly [number, number, number], number] = found;
                const rank: number = this.rank(this.hostLayers[rule.layer][0]);
                rule.declarations.forEach((declaration: Declaration, position: number) => {
                    add(declaration, [declaration.important ? 3 : 2, 0, declaration.important ? -rank : rank, ...own, -proximity, order, position]);
                });
            }
        });
    }

    private scoped(node: SvgNode, selectors: ReadonlyArray<CompiledSelector>, scope?: Scope): readonly [readonly [number, number, number], number] | undefined {
        // CSS Cascade 6 §2.5.3: of the scoping roots the node is in scope of, the match with the highest specificity counts, and
        // the nearest root breaks a tie.
        let specificity: readonly [number, number, number] | undefined;
        let proximity: number = Number.POSITIVE_INFINITY;
        for (const [root, distance] of scope === undefined ? NO_SCOPE : this.scopeMatches(node, scope)) {
            const found: readonly [number, number, number] | undefined = this.inScopeOf(root, () => this.specificity(node, selectors));
            const difference: number = found === undefined ? -1 : (specificity === undefined ? 1 : this.compare(found, specificity));
            if (found !== undefined && (difference > 0 || (difference === 0 && distance < proximity))) {
                specificity = found;
                proximity = distance;
            }
        }
        return specificity === undefined ? undefined : [specificity, proximity];
    }

    private scopeMatches(node: SvgNode, scope: Scope): Array<readonly [SvgNode | undefined, number]> {
        // CSS Cascade 6 §2.5: the subject must be in scope of a scoping root, and proximity counts the generations between them.
        const matches: Array<readonly [SvgNode | undefined, number]> = [];
        const outerRoots: ReadonlyArray<SvgNode | undefined> = scope.parent === undefined ? [undefined]
            : this.scopeMatches(node, scope.parent).map((match: readonly [SvgNode | undefined, number]) => match[0]);
        const owner: XMLElement | undefined = this.rootOf.get(scope);
        let generations: number = 0;
        for (let candidate: SvgNode | undefined = node; candidate !== undefined; candidate = candidate.parent) {
            const current: SvgNode = candidate;
            if (scope.start !== undefined && outerRoots.some((outer: SvgNode | undefined) => this.matchesAny(current, scope.start as ReadonlyArray<CompiledSelector>, outer))
                && this.inScope(node, current, scope)) {
                matches.push([current, generations]);
            } else if (owner !== undefined && current.element === owner && this.inScope(node, current, scope)) {
                matches.push([current, generations]);
            }
            generations++;
        }
        if (scope.start === undefined && owner === undefined && this.inScope(node, undefined, scope)) {
            matches.push([undefined, generations]);
        }
        return matches;
    }

    private inScope(node: SvgNode, root: SvgNode | undefined, scope: Scope): boolean {
        if (scope.end === undefined) {
            return true;
        }
        for (let candidate: SvgNode | undefined = node; candidate !== undefined; candidate = candidate.parent) {
            if (this.matchesAny(candidate, scope.end, root)) {
                return false;
            }
            if (candidate === root) {
                return true;
            }
        }
        return true;
    }

    private matchesAny(node: SvgNode, selectors: ReadonlyArray<CompiledSelector>, root: SvgNode | undefined): boolean {
        return this.inScopeOf(root, () => selectors.some((selector: CompiledSelector) => this.matches(node, selector.steps, selector.steps.length - 1)));
    }

    private inScopeOf<T>(root: SvgNode | undefined, test: () => T): T {
        const saved: SvgNode | undefined = this.scopeNode;
        this.setScope(root);
        try {
            return test();
        } finally {
            this.setScope(saved);
        }
    }

    private setScope(root: SvgNode | undefined): void {
        if (root === undefined) {
            delete this.scopeNode;
        } else {
            this.scopeNode = root;
        }
    }

    private specificity(node: SvgNode, selectors: ReadonlyArray<CompiledSelector>): readonly [number, number, number] | undefined {
        let best: readonly [number, number, number] | undefined;
        for (const selector of selectors) {
            if (selector.pseudoElement === undefined && this.matches(node, selector.steps, selector.steps.length - 1) && (best === undefined || this.compare(selector.specificity, best) > 0)) {
                best = selector.specificity;
            }
        }
        return best;
    }

    private compare(first: ReadonlyArray<number>, second: ReadonlyArray<number>): number {
        for (let index: number = 0; index < first.length; index++) {
            if (first[index] !== second[index]) {
                return first[index] - second[index];
            }
        }
        return 0;
    }

    private attachedTo(element: XMLElement): readonly [ReadonlyArray<Declaration>, ReadonlyArray<Declaration>] {
        let attached: readonly [ReadonlyArray<Declaration>, ReadonlyArray<Declaration>] | undefined = this.attached.get(element);
        if (attached === undefined) {
            attached = [this.presentation(element), this.declarations(this.attribute(element, "style") ?? "")];
            this.attached.set(element, attached);
        }
        return attached;
    }

    private presentation(element: XMLElement): Array<Declaration> {
        // SVG 2 §6.6: only elements in the SVG namespace have presentation attributes, the geometry ones on some elements;
        // §4.2: an attribute that does not parse is taken as the initial value of its property.
        if (!this.isSvg(element)) {
            return [];
        }
        const name: string = this.localName(element);
        const declarations: Array<Declaration> = [];
        for (const attribute of element.getAttributes() as Array<XMLAttribute>) {
            const attributeName: string = attribute.getName();
            const value: string = attribute.getValue();
            if (attributeName === (TRANSFORM_ATTRIBUTES.get(name) ?? "transform")) {
                declarations.push(...this.presented("transform", this.transformList(value)));
            } else if (attributeName === "d" && name === "path") {
                declarations.push({ property: "d", value: { kind: "value", value: { kind: "string", value } }, important: false });
            } else if (GEOMETRY.get(attributeName)?.has(name) === true) {
                declarations.push(...this.presented(attributeName === "pathLength" ? "path-length" : attributeName, value));
            } else if (attributeName === "writing-mode") {
                // CSS Writing Modes 4 §3.2.1: the SVG 1.1 values compute to horizontal-tb and vertical-rl.
                declarations.push(...this.presented(attributeName, LEGACY_WRITING_MODES.get(value.trim()) ?? value));
            } else if (PRESENTATION.has(attributeName) && !(attributeName === "fill" && name.startsWith("animate")) && !(attributeName === "fill" && name === "set")) {
                declarations.push(...this.presented(attributeName, value));
            }
        }
        return declarations;
    }

    private presented(property: string, value: string | undefined): Array<Declaration> {
        // SVG 2 §4.2: a <length> or <length-percentage> may also be a <number> of user units, and !important is invalid.
        if (value !== undefined && !value.includes("!")) {
            const parsed: Array<Declaration> = this.declarations(property + ":" + value);
            if (parsed.length > 0) {
                return parsed;
            }
            const unitless: Array<Declaration> = this.declarations(property + ":" + this.withUnits(value));
            if (unitless.length > 0) {
                return unitless;
            }
        }
        return this.declarations(property + ":initial");
    }

    private withUnits(value: string): string {
        let text: string = "";
        let depth: number = 0;
        tokenize(value, (type: number, start: number, end: number) => {
            if (type === tokenTypes.Function || type === tokenTypes.LeftParenthesis) {
                depth++;
            } else if (type === tokenTypes.RightParenthesis) {
                depth--;
            }
            text += value.substring(start, end) + (type === tokenTypes.Number && depth === 0 ? "px" : "");
        });
        return text;
    }

    private transformList(value: string): string | undefined {
        // CSS Transforms 1 §7.1: the SVG transform attribute, with lengths in user units and angles in degrees, and
        // rotate(<angle> <cx> <cy>) a rotation about that point.
        const functions: Array<string> = [];
        const pattern: RegExp = /[\t\n\f\r ]*,?[\t\n\f\r ]*(matrix|translate|scale|rotate|skewX|skewY)[\t\n\f\r ]*\(([^)]*)\)/y;
        let position: number = 0;
        for (let match: RegExpExecArray | null = pattern.exec(value); match !== null; match = pattern.exec(value)) {
            const name: string = match[1];
            this.geometry = this.geometry ?? new SvgGeometry();
            const numbers: Array<number> = this.geometry.numbers(match[2]);
            const [minimum, maximum]: readonly [number, number] = TRANSFORM_ARGUMENTS[name];
            if (numbers.length < minimum || numbers.length > maximum || (name === "rotate" && numbers.length === 2)) {
                return undefined;
            }
            position = pattern.lastIndex;
            if (name === "matrix") {
                functions.push("matrix(" + numbers.join(",") + ")");
            } else if (name === "translate") {
                functions.push("translate(" + numbers[0] + "px," + (numbers[1] ?? 0) + "px)");
            } else if (name === "scale") {
                functions.push("scale(" + numbers[0] + "," + (numbers[1] ?? numbers[0]) + ")");
            } else if (name === "rotate" && numbers.length === 3) {
                functions.push("translate(" + numbers[1] + "px," + numbers[2] + "px) rotate(" + numbers[0] + "deg) translate(" + (-numbers[1]) + "px," + (-numbers[2]) + "px)");
            } else {
                functions.push(name + "(" + numbers[0] + "deg)");
            }
        }
        if (value.substring(position).trim().length > 0) {
            return undefined;
        }
        return functions.length === 0 ? "none" : functions.join(" ");
    }

    private declarations(text: string): Array<Declaration> {
        const read: Array<Declaration> = [];
        let list: CssNode;
        try {
            list = parse(text, { context: "declarationList" });
        } catch {
            return read;
        }
        if (list.type === "DeclarationList") {
            for (const node of list.children) {
                const declared: Array<Declaration> | undefined = node.type === "Declaration" ? this.reader.read(node as CssTreeDeclaration, this.url, DeclarationReader.NO_NAMESPACES) : undefined;
                if (declared !== undefined) {
                    read.push(...declared.filter((declaration: Declaration) => this.inRange(declaration)));
                }
            }
        }
        return read;
    }

    private inRange(declaration: Declaration): boolean {
        // SVG 2 §10 and §13.5: for these properties "A negative value is invalid" although their grammars allow it.
        const declared: DeclaredValue = declaration.value;
        if (declared.kind !== "value" || !NON_NEGATIVE.has(declaration.property)) {
            return true;
        }
        const value: CssValue = declared.value;
        if (value.kind === "length") {
            return value.px >= 0;
        }
        return (value.kind !== "number" && value.kind !== "dimension" && value.kind !== "percentage") || value.value >= 0;
    }

    private matches(node: SvgNode, steps: ReadonlyArray<CompiledSelectorStep>, index: number): boolean {
        const step: CompiledSelectorStep = steps[index];
        if (!this.compound(node, step.compound)) {
            return false;
        }
        if (index === 0) {
            return true;
        }
        if (step.combinator === "child") {
            return node.parent !== undefined && this.matches(node.parent, steps, index - 1);
        }
        if (step.combinator === "descendant") {
            for (let ancestor: SvgNode | undefined = node.parent; ancestor !== undefined; ancestor = ancestor.parent) {
                if (this.matches(ancestor, steps, index - 1)) {
                    return true;
                }
            }
            return false;
        }
        const siblings: Array<SvgNode> = this.siblings(node);
        const position: number = siblings.findIndex((sibling: SvgNode) => sibling.element === node.element);
        if (step.combinator === "adjacentSibling") {
            return position > 0 && this.matches(siblings[position - 1], steps, index - 1);
        }
        return step.combinator === "generalSibling" && siblings.slice(0, Math.max(0, position)).some((sibling: SvgNode) => this.matches(sibling, steps, index - 1));
    }

    private siblings(node: SvgNode): Array<SvgNode> {
        const parent: SvgNode | undefined = node.parent;
        return parent === undefined ? [node] : parent.element.getChildren().map((element: XMLElement) => element === node.element ? node : { element, parent });
    }

    private compound(node: SvgNode, compound: CompoundSelector): boolean {
        const element: XMLElement = node.element;
        const type: CompoundSelector["type"] = compound.type;
        const namespace: string | undefined = this.namespaceOf(element);
        if (compound.never || compound.dir !== undefined || compound.localLinks !== undefined || (type.kind === "localName" && this.localName(element) !== type.name)
            || (type.namespace.kind === "none" && namespace !== undefined) || (type.namespace.kind === "uri" && namespace !== type.namespace.uri)) {
            return false;
        }
        if (compound.ids !== undefined && !compound.ids.every((id: string) => this.attribute(element, "id") === id || this.attribute(element, "id", XML_NAMESPACE) === id)) {
            return false;
        }
        // SVG 2 §6.5: the class attribute holds the class names, as in HTML.
        const classes: Array<string> = (this.attribute(element, "class") ?? "").split(WHITE_SPACE);
        if (compound.classes !== undefined && !compound.classes.every((name: string) => classes.includes(name))) {
            return false;
        }
        if (compound.attributes !== undefined && !compound.attributes.every((matcher: AttributeMatcher) => this.attributeMatches(element, matcher))) {
            return false;
        }
        if (compound.structural !== undefined && !compound.structural.every((pseudo: string) => this.structural(node, pseudo))) {
            return false;
        }
        if (compound.nth !== undefined && !compound.nth.every((nth: NthMatcher) => this.nth(node, nth))) {
            return false;
        }
        if (compound.lang !== undefined) {
            const matcher: LanguageRangeMatcher = this.ranges = this.ranges ?? new LanguageRangeMatcher();
            const language: string = this.language(node);
            if (!compound.lang.every((ranges: ReadonlyArray<string>) => ranges.some((range: string) => matcher.matches(language, range)))) {
                return false;
            }
        }
        if (compound.negations !== undefined && compound.negations.some((steps: ReadonlyArray<CompiledSelectorStep>) => this.matches(node, steps, steps.length - 1))) {
            return false;
        }
        if (compound.anyOf !== undefined && !compound.anyOf.every((alternatives: ReadonlyArray<ReadonlyArray<CompiledSelectorStep>>) =>
            alternatives.some((steps: ReadonlyArray<CompiledSelectorStep>) => this.matches(node, steps, steps.length - 1)))) {
            return false;
        }
        return compound.has === undefined || compound.has.every((relatives: ReadonlyArray<RelativeSelector>) =>
            relatives.some((relative: RelativeSelector) => this.relative(node, relative)));
    }

    private relative(anchor: SvgNode, relative: RelativeSelector): boolean {
        // Selectors 4 §4.5: an element reached from the anchor through the leading combinator matches the relative selector.
        const last: number = relative.steps.length - 1;
        const descendants: (node: SvgNode, childrenOnly: boolean) => Array<SvgNode> = (node: SvgNode, childrenOnly: boolean): Array<SvgNode> =>
            node.element.getChildren().flatMap((element: XMLElement) => {
                const child: SvgNode = { element, parent: node };
                return childrenOnly ? [child] : [child, ...descendants(child, false)];
            });
        const reaches: (candidate: SvgNode) => boolean = (candidate: SvgNode): boolean => this.matches(candidate, relative.steps, last);
        if (relative.combinator === "child" || relative.combinator === "descendant") {
            return descendants(anchor, relative.combinator === "child" && last === 0).some(reaches);
        }
        const siblings: Array<SvgNode> = this.siblings(anchor);
        const position: number = siblings.findIndex((sibling: SvgNode) => sibling.element === anchor.element);
        const following: Array<SvgNode> = siblings.slice(position + 1, relative.combinator === "adjacentSibling" && last === 0 ? position + 2 : siblings.length);
        return following.some((sibling: SvgNode) => reaches(sibling) || (last > 0 && descendants(sibling, false).some(reaches)));
    }

    private attributeMatches(element: XMLElement, matcher: AttributeMatcher): boolean {
        for (const attribute of element.getAttributes() as Array<XMLAttribute>) {
            const name: string = attribute.getName();
            const colon: number = name.indexOf(":");
            if (name.substring(colon + 1) !== matcher.name || name === "xmlns" || name.startsWith("xmlns:")) {
                continue;
            }
            const uri: string | undefined = colon < 0 ? undefined : this.prefixUri(element, name.substring(0, colon));
            const inNamespace: boolean = matcher.namespace.kind === "any" || (matcher.namespace.kind === "none" ? colon < 0 : uri === matcher.namespace.uri);
            if (inNamespace && this.valueMatches(attribute.getValue(), matcher)) {
                return true;
            }
        }
        return false;
    }

    private valueMatches(actual: string, matcher: AttributeMatcher): boolean {
        const value: string | undefined = matcher.value;
        if (value === undefined) {
            return true;
        }
        const compared: string = matcher.caseInsensitive ? actual.toLowerCase() : actual;
        switch (matcher.operator) {
            case "=":
                return compared === value;
            case "~=":
                return value.length > 0 && !WHITE_SPACE.test(value) && compared.split(WHITE_SPACE).includes(value);
            case "|=":
                return compared === value || compared.startsWith(value + "-");
            case "^=":
                return value.length > 0 && compared.startsWith(value);
            case "$=":
                return value.length > 0 && compared.endsWith(value);
            case "*=":
                return value.length > 0 && compared.includes(value);
            default:
                return false;
        }
    }

    private structural(node: SvgNode, pseudo: string): boolean {
        const siblings: Array<SvgNode> = this.siblings(node);
        const position: number = siblings.findIndex((sibling: SvgNode) => sibling.element === node.element);
        switch (pseudo) {
            case "root":
                return node.parent === undefined && (node.element === this.root || node.element === this.hostRoot);
            case "scope":
                return this.scopeNode !== undefined ? node.element === this.scopeNode.element : node.parent === undefined && (node.element === this.root || node.element === this.hostRoot);
            case "empty":
                return node.element.getChildren().length === 0 && this.text(node.element).length === 0;
            case "first-child":
                return position === 0;
            case "last-child":
                return position === siblings.length - 1;
            case "only-child":
                return siblings.length === 1;
            case "first-of-type":
                return this.typeIndex(node, siblings, false) === 1;
            case "last-of-type":
                return this.typeIndex(node, siblings, true) === 1;
            case "only-of-type":
                return this.typeIndex(node, siblings, false) === 1 && this.typeIndex(node, siblings, true) === 1;
            case "any-link":
                return this.isSvg(node.element, "a") && this.href(node.element) !== undefined;
            default:
                return false;
        }
    }

    private nth(node: SvgNode, nth: NthMatcher): boolean {
        const siblings: Array<SvgNode> = this.siblings(node);
        const anPlusB: AnPlusBParser = this.anPlusB = this.anPlusB ?? new AnPlusBParser();
        if (nth.kind === "of-type" || nth.kind === "last-of-type") {
            return anPlusB.matches(nth.expression, this.typeIndex(node, siblings, nth.kind === "last-of-type"));
        }
        const of: ReadonlyArray<ReadonlyArray<CompiledSelectorStep>> | undefined = nth.of;
        const counted: (sibling: SvgNode) => boolean = (sibling: SvgNode): boolean =>
            of === undefined || of.some((steps: ReadonlyArray<CompiledSelectorStep>) => this.matches(sibling, steps, steps.length - 1));
        if ((nth.kind !== "child" && nth.kind !== "last-child") || !counted(node)) {
            return false;
        }
        let index: number = 0;
        for (const sibling of nth.kind === "last-child" ? [...siblings].reverse() : siblings) {
            index += counted(sibling) ? 1 : 0;
            if (sibling.element === node.element) {
                break;
            }
        }
        return anPlusB.matches(nth.expression, index);
    }

    private typeIndex(node: SvgNode, siblings: ReadonlyArray<SvgNode>, fromEnd: boolean): number {
        const name: string = this.localName(node.element);
        const namespace: string | undefined = this.namespaceOf(node.element);
        let index: number = 0;
        for (const sibling of fromEnd ? [...siblings].reverse() : siblings) {
            index += this.localName(sibling.element) === name && this.namespaceOf(sibling.element) === namespace ? 1 : 0;
            if (sibling.element === node.element) {
                break;
            }
        }
        return index;
    }

    language(node: SvgNode): string {
        // SVG 2 §5.11.3: xml:lang, or lang where xml:lang is absent, of the element or the nearest ancestor that has one.
        for (let current: SvgNode | undefined = node; current !== undefined; current = current.parent) {
            const language: string | undefined = this.attribute(current.element, "lang", XML_NAMESPACE) ?? this.attribute(current.element, "lang");
            if (language !== undefined) {
                return language;
            }
        }
        return "";
    }

    private initial(): ComputedStyle {
        // CSS Cascade 5 §7.1: the initial value of every longhand, computed as a declared one would be, since the text of an
        // SVG image is prepared by the same code as the text of the document.
        if (this.initialStyle === undefined) {
            const values: Record<string, CssValue> = { "font-size": { kind: "length", px: MEDIUM } };
            this.metrics.unsettled(values);
            this.initialStyle = { values, inherited: values, custom: {} };
            const expander: ShorthandExpander = new ShorthandExpander(this.table);
            for (const property of this.table.names()) {
                const text: string | undefined = this.table.definition(property)?.initial;
                if (property === "font-size" || text === undefined || expander.isShorthand(property)) {
                    continue;
                }
                let value: CssValue | undefined;
                try {
                    const node: CssNode = parse(text, { context: "value" });
                    value = node.type === "Value" ? this.values.parse(node) : undefined;
                } catch {
                    value = undefined;
                }
                const computed: CssValue | undefined = value === undefined ? undefined : this.computeValue(property, { kind: "value", value }, false, this.initialStyle, values,
                    { element: this.root });
                if (computed !== undefined) {
                    values[property] = computed;
                }
            }
        }
        return this.initialStyle;
    }

    private compute(node: SvgNode, cascaded: Map<string, DeclaredValue>, parent?: ComputedStyle): ComputedStyle {
        // An element computes the properties it declares; any other value comes from its parent when the property is
        // inherited, and is the initial value when it is not, through the prototype chain.
        const base: ComputedStyle = parent ?? this.initial();
        const parentCustoms: ReadonlyMap<string, CustomValue> = (parent === undefined ? undefined : this.customs?.get(parent)) ?? NO_CUSTOMS;
        const inherited: Record<string, CssValue> = Object.create(parent === undefined ? this.initial().values : base.inherited) as Record<string, CssValue>;
        const values: Record<string, CssValue> = Object.create(inherited) as Record<string, CssValue>;
        this.metrics.unsettled(values);
        const resolution: Resolution = { node, cascaded, parent: base, values, inherited, parentCustoms, customs: new Map<string, CustomValue | null>(), done: new Set<string>() };
        let customs: Map<string, CustomValue> | undefined;
        for (const property of cascaded.keys()) {
            if (property.startsWith("--")) {
                customs = customs ?? new Map<string, CustomValue>(parentCustoms);
                const value: CustomValue | null = this.customValue(property, resolution);
                if (value === null) {
                    customs.delete(property);
                } else {
                    customs.set(property, value);
                }
            }
        }
        const properties: Array<string> = [...cascaded.keys()].filter((property: string) => !property.startsWith("--"))
            .sort((first: string, second: string) => this.priority(first) - this.priority(second));
        for (const property of properties) {
            this.standard(property, resolution);
        }
        if (parent === undefined && node.element === this.root) {
            this.rootValues = values;
        }
        const style: ComputedStyle = { values, inherited, custom: {} };
        const kept: ReadonlyMap<string, CustomValue> | undefined = customs ?? (parent === undefined ? undefined : this.customs?.get(parent));
        if (kept !== undefined) {
            this.customs = this.customs ?? new WeakMap<ComputedStyle, ReadonlyMap<string, CustomValue>>();
            this.customs.set(style, kept);
        }
        return style;
    }

    private standard(property: string, resolution: Resolution): CssValue | undefined {
        // A property is computed once, in priority order or earlier when a style() query of if() reads it; one that depends on
        // itself is in a cycle, invalid at computed-value time (CSS Values 5 Appendix A), so it is unset.
        const declared: DeclaredValue | undefined = resolution.cascaded.get(property);
        const key: string = "property|" + property;
        if (declared === undefined || (resolution.done.has(property) && resolution.stack?.includes(key) !== true) || !this.enter(key, resolution)) {
            return resolution.values[property];
        }
        resolution.done.add(property);
        const inheriting: boolean = this.table.definition(property)?.inherited === true;
        let computed: CssValue | undefined = this.computeValue(property, this.substituted(property, declared, resolution), inheriting, resolution.parent, resolution.values,
            resolution.node);
        if (this.leave(key, resolution)) {
            computed = this.computeValue(property, UNSET, inheriting, resolution.parent, resolution.values, resolution.node);
        }
        if (computed !== undefined) {
            resolution.values[property] = computed;
            if (inheriting) {
                resolution.inherited[property] = computed;
            }
        }
        return resolution.values[property];
    }

    private customValue(name: string, resolution: Resolution): CustomValue | null {
        // CSS Variables 1 §2 and §3: an unregistered custom property inherits, and its value has its own substitution
        // functions replaced on its element; one that is in a cycle is the guaranteed-invalid value.
        const known: CustomValue | null | undefined = resolution.customs.get(name);
        if (known !== undefined) {
            return known;
        }
        const declared: DeclaredValue | undefined = resolution.cascaded.get(name);
        if (declared === undefined) {
            return this.defaultCustom(name, resolution, this.registrations().get(name));
        }
        const key: string = "property|" + name;
        if (!this.enter(key, resolution)) {
            return null;
        }
        let value: CustomValue | null = this.declaredCustom(name, declared, resolution);
        if (this.leave(key, resolution)) {
            value = null;
        }
        resolution.customs.set(name, value);
        return value;
    }

    private declaredCustom(name: string, declared: DeclaredValue, resolution: Resolution): CustomValue | null {
        // CSS Values 5 Appendix A: a value that is only a CSS-wide keyword after substitution acts as that keyword; an invalid one
        // is the guaranteed-invalid value, and on a property registered with a syntax acts as unset (CSS Properties and Values 1 §2.4).
        const rule: PropertyRule | undefined = this.registrations().get(name);
        const syntax: string | undefined = rule === undefined || rule.syntax === SyntaxDefinition.UNIVERSAL ? undefined : rule.syntax;
        let keyword: string | undefined = declared.kind === "keyword" ? declared.keyword : undefined;
        if (declared.kind === "custom") {
            const value: CustomValue | null = this.substitution().customValue(declared, name, syntax !== undefined, this.hostOf(resolution));
            if (value === null) {
                return syntax === undefined ? null : this.defaultCustom(name, resolution, rule);
            }
            keyword = value.text.toLowerCase();
            if (!DeclarationReader.CSS_WIDE_KEYWORDS.has(keyword)) {
                if (syntax === undefined) {
                    return value;
                }
                const computed: string | undefined = this.typedText(syntax, value.text, declared.baseUrl, resolution);
                if (computed === undefined) {
                    return this.defaultCustom(name, resolution, rule);
                }
                return value.base === undefined ? { text: computed } : { text: computed, base: value.base };
            }
        }
        if (keyword === "inherit" || (keyword === "unset" && (rule === undefined || rule.inherits))) {
            return resolution.parentCustoms.get(name) ?? this.registeredInitial(rule);
        }
        return this.registeredInitial(rule);
    }

    private defaultCustom(name: string, resolution: Resolution, rule?: PropertyRule): CustomValue | null {
        return rule === undefined || rule.inherits ? resolution.parentCustoms.get(name) ?? this.registeredInitial(rule) : this.registeredInitial(rule);
    }

    private registeredInitial(rule?: PropertyRule): CustomValue | null {
        if (rule === undefined || rule.initialValue === undefined) {
            return null;
        }
        this.initials = this.initials ?? new Map<string, CustomValue | null>();
        if (!this.initials.has(rule.name)) {
            const initial: Readonly<Record<string, CssValue>> = this.initial().values;
            const text: string | undefined = rule.syntax === SyntaxDefinition.UNIVERSAL ? rule.initialValue
                : this.computer.typedText(rule.syntax, rule.initialValue, "about:blank", (): ElementUnits => this.units(initial, initial, initial));
            this.initials.set(rule.name, text === undefined ? null : { text });
        }
        return this.initials.get(rule.name) ?? null;
    }

    private typedText(syntax: string, text: string, baseUrl: string, resolution: Resolution): string | undefined {
        // CSS Properties and Values 1 §2.4: a typed value computes as on its element, whose font-relative units need its font.
        return this.computer.typedText(syntax, text, baseUrl, (): ElementUnits => {
            for (const property of FONT_DEPENDENCIES) {
                this.standard(property, resolution);
            }
            return this.units(resolution.values, resolution.values, this.rootValues ?? resolution.values);
        });
    }

    private registrations(): ReadonlyMap<string, PropertyRule> {
        // CSS Properties and Values 1 §3: the last valid @property rule for a name registers it, the document's coming first.
        if (this.registered === undefined) {
            this.loadSheets();
            this.registered = new Map<string, PropertyRule>([...this.hostSheet?.properties ?? [], ...(this.authorSheet as Stylesheet).properties].map((rule: PropertyRule): [string, PropertyRule] =>
                [rule.name, rule]));
        }
        return this.registered;
    }

    private hostOf(resolution: Resolution): SubstitutionHost {
        if (resolution.host === undefined) {
            resolution.host = {
                element: resolution.node.element,
                custom: (name: string): CustomValue | null => this.customValue(name, resolution),
                inherited: (name: string): CustomValue | null => resolution.parentCustoms.get(name) ?? null,
                initialCustom: (name: string): CustomValue | null => this.registeredInitial(this.registrations().get(name)),
                registration: (name: string): string | undefined => {
                    const rule: PropertyRule | undefined = this.registrations().get(name);
                    return rule === undefined || rule.syntax === SyntaxDefinition.UNIVERSAL ? undefined : rule.syntax;
                },
                inherits: (name: string): boolean => this.registrations().get(name)?.inherits ?? true,
                typed: (syntax: string, text: string, baseUrl: string): string | undefined => this.typedText(syntax, text, baseUrl, resolution),
                matches: (property: string, value?: string): TriState => this.styleMatches(property, value, resolution),
                numeric: (text: string): [number, string] | undefined => this.numeric(text, resolution),
                containersHold: (queries: ReadonlyArray<ContainerQuery>): boolean => this.hostHolds?.(queries) === true,
                enter: (key: string): boolean => this.enter(key, resolution),
                leave: (key: string): boolean => this.leave(key, resolution)
            };
        }
        return resolution.host;
    }

    private enter(key: string, resolution: Resolution): boolean {
        // CSS Variables 1 §2.3: what depends on itself is in a cycle, and so is every member.
        const stack: Array<string> | undefined = resolution.stack;
        if (stack === undefined) {
            resolution.stack = [key];
            return true;
        }
        const index: number = stack.indexOf(key);
        if (index !== -1) {
            const cyclic: Set<string> = resolution.cyclic ?? new Set<string>();
            resolution.cyclic = cyclic;
            for (let member: number = index; member < stack.length; member++) {
                cyclic.add(stack[member]);
            }
            return false;
        }
        stack.push(key);
        return true;
    }

    private leave(key: string, resolution: Resolution): boolean {
        resolution.stack?.pop();
        return resolution.cyclic?.delete(key) === true;
    }

    private styleMatches(property: string, value: string | undefined, resolution: Resolution): TriState {
        // CSS Conditional 5 §6.2: a property matches when its computed value equals the given value computed for the same
        // element, a shorthand when each of its longhands does; without a value, when it differs from the initial value.
        const name: string = this.table.canonicalName(property);
        this.expander = this.expander ?? new ShorthandExpander(this.table);
        const shorthand: boolean = this.expander.isShorthand(name);
        if (!shorthand && this.table.definition(name) === undefined) {
            return "unknown";
        }
        if (value === undefined) {
            const initial: Readonly<Record<string, CssValue>> = this.initial().values;
            return (shorthand ? this.expander.longhands(name) : [name]).some((longhand: string) =>
                JSON.stringify(this.standard(longhand, resolution)) !== JSON.stringify(initial[longhand])) ? "true" : "false";
        }
        const declarations: Array<Declaration> = this.declarations(name + ":" + value);
        if (declarations.length === 0) {
            return "false";
        }
        for (const declaration of declarations) {
            const expected: CssValue | undefined = this.computeValue(declaration.property, declaration.value, this.table.definition(declaration.property)?.inherited === true,
                resolution.parent, resolution.values, resolution.node);
            if (JSON.stringify(expected) !== JSON.stringify(this.standard(declaration.property, resolution))) {
                return "false";
            }
        }
        return "true";
    }

    private numeric(text: string, resolution: Resolution): [number, string] | undefined {
        // CSS Conditional 5 §6.2: a <number>, <percentage>, <length>, <angle>, <time>, <frequency> or <resolution>, computed.
        let value: CssValue | undefined;
        try {
            const node: CssNode = parse(text, { context: "value" });
            value = node.type === "Value" ? this.values.parse(node) : undefined;
        } catch {
            return undefined;
        }
        const units: ElementUnits = this.units(resolution.values, resolution.values, this.rootValues ?? resolution.values);
        this.cssUnits = this.cssUnits ?? new CssUnits();
        switch (value?.kind) {
            case "number":
                return [value.value, "number"];
            case "percentage":
                return [value.value, "percentage"];
            case "length":
                return [value.px, "length"];
            case "dimension": {
                const length: CssValue | undefined = this.lengths.compute(value, units);
                if (length !== undefined && length.kind === "length") {
                    return [length.px, "length"];
                }
                const type: BaseType | undefined = this.cssUnits.baseTypeOf(value.unit);
                const converted: number | undefined = this.cssUnits.toCanonical(value.value, value.unit);
                return type === undefined || converted === undefined ? undefined : [converted, type];
            }
            case "calc": {
                const length: CssValue | undefined = this.lengths.compute(value, units);
                if (length !== undefined && length.kind === "length") {
                    return [length.px, "length"];
                }
                const number: number | undefined = this.lengths.computeNumber(value, units);
                return number === undefined ? undefined : [number, "number"];
            }
            default:
                return undefined;
        }
    }

    private substitution(): ValueSubstitution {
        // The functions read the image's @custom-media and @supports-condition rules, and in an svg element of the document the
        // document's rules and custom functions too.
        if (this.substituter === undefined) {
            this.loadSheets();
            const sheet: Stylesheet = this.hostSheet ?? new StylesheetReader(this.table).readLinked([], this.url);
            const own: Stylesheet = this.authorSheet as Stylesheet;
            // CSS Functions and Mixins §2.1.1: the rule in the stronger layer wins, in the one layer order of the document and
            // the image, and the later one within a layer, the image's coming after the document's.
            const after: number = sheet.functions.reduce((last: number, rule: FunctionRule) => Math.max(last, rule.order + 1), 0);
            const functions: Array<FunctionRule> = [
                ...sheet.functions.map((rule: FunctionRule): FunctionRule => ({ ...rule, layer: this.rank(this.hostLayers[rule.layer][0]) })),
                ...own.functions.map((rule: FunctionRule): FunctionRule => ({ ...rule, layer: this.rank(this.imageLayer(own.layers[rule.layer][0])), order: after + rule.order }))
            ];
            this.substituter = new ValueSubstitution(this.table, {
                ...sheet, customMedia: [...sheet.customMedia, ...own.customMedia], supportsConditions: [...sheet.supportsConditions, ...own.supportsConditions],
                functions
            }, this.scopes.get(this.root) ?? this.outer, this.url);
        }
        return this.substituter;
    }

    private priority(property: string): number {
        // CSS Values 4 §6.1.1: the font-relative units read the writing mode, the font and the line height, so those
        // properties are computed first; currentcolor reads color.
        return PRIORITIES.get(property) ?? LATER;
    }

    private substituted(property: string, value: DeclaredValue, resolution: Resolution): DeclaredValue {
        // CSS Values 5 Appendix A: the arbitrary substitution functions are replaced, and a value that becomes invalid is unset;
        // the longhands of a shorthand share one substitution, so that a random value is the same in all.
        if (value.kind !== "pending") {
            return value;
        }
        const replaced: Map<PendingSubstitution, ReadonlyArray<Declaration> | CssWideKeyword | null> = resolution.replaced
            ?? new Map<PendingSubstitution, ReadonlyArray<Declaration> | CssWideKeyword | null>();
        resolution.replaced = replaced;
        const known: ReadonlyArray<Declaration> | CssWideKeyword | null | undefined = replaced.get(value);
        const result: ReadonlyArray<Declaration> | CssWideKeyword | null = known !== undefined ? known
            : this.substitution().replace(value, property, this.hostOf(resolution)) ?? null;
        replaced.set(value, result);
        if (result === null) {
            return UNSET;
        }
        if (typeof result === "string") {
            return { kind: "keyword", keyword: result };
        }
        const found: Declaration | undefined = result.find((declaration: Declaration) => declaration.property === property);
        return found === undefined || !this.inRange(found) ? UNSET : found.value;
    }

    private computeValue(property: string, declared: DeclaredValue, inheriting: boolean, parent: ComputedStyle, values: Record<string, CssValue>, node: SvgNode): CssValue | undefined {
        if (declared.kind === "keyword") {
            return declared.keyword === "inherit" || (declared.keyword === "unset" && inheriting) ? parent.values[property] : this.initial().values[property];
        }
        if (declared.kind === "toggle") {
            // CSS Values 5 §7.4: the value after the first one equal to the inherited value, or the first one.
            const inheritedValue: string = JSON.stringify(parent.values[property] ?? this.initial().values[property]);
            let first: CssValue | undefined;
            let matched: boolean = false;
            for (const [index, alternative] of declared.values.entries()) {
                const value: CssValue | undefined = this.computeValue(property, alternative, inheriting, parent, values, node);
                if (matched) {
                    return value;
                }
                if (index === 0) {
                    first = value;
                }
                matched = JSON.stringify(value) === inheritedValue;
            }
            return first;
        }
        if (declared.kind !== "value") {
            return undefined;
        }
        const value: CssValue = declared.value;
        const root: boolean = parent === this.initial() && node.element === this.root;
        if (property === "font-size") {
            return { kind: "length", px: this.fontSize(value, parent.values, root) };
        }
        if (property === "color" && value.kind === "ident" && value.lower === "currentcolor") {
            return parent.values["color"];
        }
        if (property === "font-weight" && value.kind === "ident") {
            return { kind: "number", value: this.fontWeight(value.lower, parent.values["font-weight"]), integer: true };
        }
        if (property === "font-width" && value.kind === "ident") {
            // CSS Fonts 4 §2.3: the keywords are percentages.
            const width: number | undefined = FontMatcher.WIDTH_KEYWORDS.get(value.lower);
            return width === undefined ? value : { kind: "percentage", value: width };
        }
        if (property === "font-style" && value.kind === "ident" && value.lower === "oblique") {
            // CSS Fonts 4 §2.4: oblique without an angle is 14deg.
            return { kind: "list", separator: "space", items: [value, { kind: "dimension", value: FontMatcher.DEFAULT_OBLIQUE, unit: "deg" }] };
        }
        const lineHeight: Readonly<Record<string, CssValue>> = property === "line-height" ? parent.values : values;
        const computed: CssValue = this.absolute(value, this.units(values, lineHeight, root ? values : this.rootValues ?? values));
        return this.takesColor(property) ? this.colored(computed) : computed;
    }

    private takesColor(property: string): boolean {
        const grammar: string = this.table.definition(property)?.grammar ?? "";
        return grammar.includes("<color>") || grammar.includes("<paint>") || grammar.includes("<'color'>");
    }

    private colored(value: CssValue): CssValue {
        // CSS Color 4 §4.4 and §15.5: a color computes to a color, a system color to the color it stands for, and
        // currentcolor to itself.
        switch (value.kind) {
            case "hash":
            case "ident":
            case "function": {
                this.colors = this.colors ?? new ColorParser(undefined);
                const parsed: ParsedColor | undefined = this.colors.parse(value, this.simplifier.specifiedContext());
                if (parsed === undefined || parsed === "unresolved") {
                    return value.kind === "function" ? { ...value, args: value.args.map((item: CssValue) => this.colored(item)) } : value;
                }
                if (parsed.kind === "ident" && parsed.lower !== "currentcolor") {
                    const hex: string | undefined = this.keywords.systemColorHex(parsed.lower);
                    return (hex === undefined ? undefined : this.colors.parseHex(hex)) ?? parsed;
                }
                return parsed;
            }
            case "list":
                return { ...value, items: value.items.map((item: CssValue) => this.colored(item)) };
            default:
                return value;
        }
    }

    private fontSize(value: CssValue, parent: Readonly<Record<string, CssValue>>, root: boolean): number {
        // CSS Fonts 4 §2.5: the absolute keywords scale medium, and the relative ones, the font-relative units and percentages
        // the parent's font; CSS Values 4 §6.1.1: on the root element the root units refer to the initial values.
        const parentSize: number = this.metrics.fontSize(parent);
        if (value.kind === "ident") {
            if (value.lower === "larger" || value.lower === "smaller") {
                return value.lower === "larger" ? parentSize * RELATIVE_SIZE_RATIO : parentSize / RELATIVE_SIZE_RATIO;
            }
            return MEDIUM * (SIZE_FACTORS.get(value.lower) ?? 1);
        }
        return this.lengths.pixelsOf(value, this.units(parent, parent, root ? parent : this.rootValues ?? parent), parentSize) ?? parentSize;
    }

    private fontWeight(keyword: string, parent: CssValue | undefined): number {
        // CSS Fonts 4 §2.2: bolder and lighter step from the parent's weight.
        const weight: number = parent !== undefined && parent.kind === "number" ? parent.value : 400;
        switch (keyword) {
            case "bold":
                return 700;
            case "bolder":
                return weight < 350 ? 400 : (weight < 550 ? 700 : Math.max(900, weight));
            case "lighter":
                return weight < 100 ? weight : (weight < 550 ? 100 : (weight < 750 ? 400 : 700));
            default:
                return 400;
        }
    }

    private units(local: Readonly<Record<string, CssValue>>, lineHeight: Readonly<Record<string, CssValue>>, root: Readonly<Record<string, CssValue>>): ElementUnits {
        // CSS Values 4 §6.1: the font-relative units from the fonts the values select, which are computed before the
        // values that use them; the viewport is the image's, and an SVG element is no query container.
        const [width, height]: readonly [number, number] = this.viewport;
        return new ElementUnits(this.metrics, {
            local,
            lineHeight,
            root,
            rootLineHeight: root,
            viewport: { width, height },
            horizontal: (): boolean => {
                const mode: CssValue | undefined = local["writing-mode"];
                return mode === undefined || mode.kind !== "ident" || mode.lower === "horizontal-tb";
            },
            container: (): number | null => null,
            require: (): void => {
                // do nothing
            },
            zoom: (): number => 1
        });
    }

    private absolute(value: CssValue, units: ElementUnits): CssValue {
        switch (value.kind) {
            case "dimension":
            case "calc":
                return this.lengths.compute(value, units) ?? value;
            case "list":
                return { ...value, items: value.items.map((item: CssValue) => this.absolute(item, units)) };
            case "function":
                return { ...value, args: value.args.map((item: CssValue) => this.absolute(item, units)) };
            default:
                return value;
        }
    }

    pixels(value: CssValue | undefined, basis: number): number {
        if (value === undefined) {
            return 0;
        }
        const initial: Readonly<Record<string, CssValue>> = this.initial().values;
        return value.kind === "number" ? value.value : this.lengths.pixelsOf(value, this.units(initial, initial, this.rootValues ?? initial), basis) ?? 0;
    }

    length(text: string, style: ComputedStyle, basis: number): number | undefined {
        // SVG 2 §4.2: a length attribute that is not a property takes a number of user units, a length or a percentage.
        try {
            const node: CssNode = parse(text.trim(), { context: "value" });
            const value: CssValue | undefined = node.type === "Value" ? this.values.parse(node) : undefined;
            if (value === undefined) {
                return undefined;
            }
            return value.kind === "number" ? value.value : this.lengths.pixelsOf(value, this.units(style.values, style.values, this.rootValues ?? style.values), basis);
        } catch {
            return undefined;
        }
    }
}
