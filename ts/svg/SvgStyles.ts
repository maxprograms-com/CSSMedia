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

import type { Atrule, CssNode, Declaration as CssTreeDeclaration, MediaQueryList, Rule, Selector, StyleSheet } from "css-tree";
import { parse, tokenize, tokenTypes } from "css-tree";
import type { XMLAttribute, XMLDocument, XMLNode } from "typesxml";
import { ProcessingInstruction, TextNode, XMLElement } from "typesxml";
import { AnPlusBParser } from "../css/AnPlusBParser.js";
import type { AttributeMatcher, CompiledSelector, CompiledSelectorStep, CompoundSelector, NthMatcher, RelativeSelector } from "../css/CompiledSelector.js";
import { ConditionEvaluator } from "../css/ConditionEvaluator.js";
import { DeclarationReader } from "../css/DeclarationReader.js";
import type { PropertyTable } from "../css/PropertyTable.js";
import { SelectorCompiler } from "../css/SelectorCompiler.js";
import { ShorthandExpander } from "../css/ShorthandExpander.js";
import { SupportsEvaluator } from "../css/SupportsEvaluator.js";
import type { ContainerQuery, Declaration, DeclaredValue, FontFaceRule, Scope, StyleRule } from "../css/Stylesheet.js";
import { DEFAULT_PAGE_SIZE, StylesheetReader } from "../css/StylesheetReader.js";
import { CalcSimplifier } from "../css/values/CalcSimplifier.js";
import { ColorKeywords } from "../css/values/ColorKeywords.js";
import type { ParsedColor } from "../css/values/ColorParser.js";
import { ColorParser } from "../css/values/ColorParser.js";
import type { CssValue } from "../css/values/CssValue.js";
import { CssValueParser } from "../css/values/CssValueParser.js";
import { SourceElement } from "../parse/SourceElement.js";
import { BaseUrls } from "../pdf/BaseUrls.js";
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

type CompiledRule = readonly [ReadonlyArray<CompiledSelector>, ReadonlyArray<Declaration>, string];

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
const NO_CUSTOMS: ReadonlyMap<string, string> = new Map<string, string>();
const NON_NEGATIVE: ReadonlySet<string> = new Set<string>(["stroke-width", "stroke-miterlimit", "rx", "ry", "r", "width", "height", "path-length"]);
const BOX_HINTS: ReadonlySet<string> = new Set<string>(["display", "width", "height", "overflow"]);
const UNSCOPED: number = Number.NEGATIVE_INFINITY;
const NO_LAYER: string = "";
const SHEET_AT_RULES: ReadonlySet<string> = new Set<string>(["import", "namespace", "layer", "media", "supports", "font-face"]);
const CSS_WIDE_KEYWORDS: ReadonlySet<string> = new Set<string>(["initial", "inherit", "unset", "revert", "revert-layer"]);
const NO_SCOPE: ReadonlyArray<readonly [SvgNode | undefined, number]> = [[undefined, Number.POSITIVE_INFINITY]];

export class SvgStyles {

    readonly root: XMLElement;
    readonly url: string;
    readonly diagnostics: Array<string> = [];
    private readonly table: PropertyTable;
    private readonly reader: DeclarationReader;
    private readonly compiler: SelectorCompiler = new SelectorCompiler();
    private readonly values: CssValueParser = new CssValueParser();
    private readonly lengths: LengthResolver = new LengthResolver();
    private readonly load: (url: string) => Buffer | undefined;
    private readonly fontsFor: (rules: ReadonlyArray<FontFaceRule>) => DocumentFonts;
    private readonly fontFaces: Array<FontFaceRule> = [];
    private fontReader?: StylesheetReader;
    private ownFonts?: DocumentFonts;
    private readonly scopes: Map<XMLElement, ReadonlyMap<string, string>> = new Map<XMLElement, ReadonlyMap<string, string>>();
    private readonly parents: Map<XMLElement, XMLElement> = new Map<XMLElement, XMLElement>();
    private readonly ids: Map<string, XMLElement> = new Map<string, XMLElement>();
    private readonly agentRules: Array<CompiledRule> = [];
    private readonly authorRules: Array<CompiledRule> = [];
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
    private customs?: WeakMap<ComputedStyle, ReadonlyMap<string, string>>;
    private loading?: Set<string>;
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
    private readonly layers: Map<string, Array<string>> = new Map<string, Array<string>>([[NO_LAYER, []]]);
    private anonymousLayers: number = 0;
    private layerRanks?: Map<string, number>;
    private supporter?: SupportsEvaluator;
    private rootPlace?: SvgNode;
    private scopeNode?: SvgNode;

    constructor(source: XMLDocument | XMLElement, url: string, table: PropertyTable, fontsFor: (rules: ReadonlyArray<FontFaceRule>) => DocumentFonts, load: (url: string) => Buffer | undefined,
        outer: ReadonlyMap<string, string> = new Map<string, string>([["xml", XML_NAMESPACE]])) {
        this.source = source;
        this.root = source instanceof XMLElement ? source : source.getRoot() as XMLElement;
        this.url = url;
        this.table = table;
        this.reader = new DeclarationReader(table);
        this.fontsFor = fontsFor;
        this.load = load;
        this.outer = outer;
        this.index(this.root, outer);
    }

    fonts(): DocumentFonts {
        // The fonts of the image depend on the @font-face rules of its style sheets, so those are read first.
        if (this.ownFonts === undefined) {
            this.loadSheets();
            this.ownFonts = this.fontsFor(this.fontFaces);
        }
        return this.ownFonts;
    }

    private get metrics(): FontMetrics {
        return this.fonts()[0];
    }

    embed(rules: ReadonlyArray<StyleRule>, layers: ReadonlyArray<readonly [string, ReadonlyArray<string>]>, box: ComputedStyle, rootValues: Readonly<Record<string, CssValue>>,
        hostRoot: SourceElement, holds: (queries: ReadonlyArray<ContainerQuery>) => boolean): void {
        this.hostRules = rules;
        this.hostLayers = layers;
        this.rootValues = rootValues;
        this.hostRoot = hostRoot;
        this.hostHolds = holds;
        const values: Record<string, CssValue> = Object.create(this.initial().values) as Record<string, CssValue>;
        for (const property of this.table.names()) {
            const inherited: CssValue | undefined = box.inherited[property];
            if (inherited !== undefined && this.table.definition(property)?.inherited === true) {
                values[property] = inherited;
            }
        }
        this.hostStyle = { values, inherited: values, custom: {} };
        const customs: Map<string, string> = new Map<string, string>(Object.entries(box.custom).map(([name, value]): [string, string] => [name, value.text]));
        if (customs.size > 0) {
            this.customs = this.customs ?? new WeakMap<ComputedStyle, ReadonlyMap<string, string>>();
            this.customs.set(this.hostStyle, customs);
        }
    }

    loadSheets(): void {
        if (this.sheetsRead) {
            return;
        }
        this.sheetsRead = true;
        this.readSheet(USER_AGENT_SHEET, this.url, this.agentRules, NO_LAYER);
        // SVG 2 §6.3 and §6.9: the xml-stylesheet processing instructions, then the style sheets in the document; Associating
        // Style Sheets with XML Documents 1.0 puts the instructions "in the document's prolog".
        if (!(this.source instanceof XMLElement)) {
            for (const node of this.source.contentIterator() as IterableIterator<XMLNode>) {
                if (node === this.root) {
                    break;
                }
                if (node instanceof ProcessingInstruction && node.getTarget() === "xml-stylesheet") {
                    this.instruction(node.getData());
                }
            }
        }
        this.sheets(this.root);
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

    private instruction(data: string): void {
        // Associating Style Sheets with XML documents 1.0 §2: an alternate style sheet is not applied.
        const pseudo: Map<string, string> = new Map<string, string>();
        for (const match of data.matchAll(/([A-Za-z_][\w.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
            pseudo.set(match[1], match[2] ?? match[3]);
        }
        const href: string | undefined = pseudo.get("href");
        const type: string | undefined = pseudo.get("type");
        if (href !== undefined && (type === undefined || type.trim().toLowerCase() === "text/css") && pseudo.get("alternate") !== "yes" && this.mediaHolds(pseudo.get("media"))) {
            this.importSheet(this.resolve(href), NO_LAYER);
        }
    }

    private sheets(element: XMLElement): void {
        // SVG 2 §6.2 and §6.3, HTML §4.2.4 and §4.2.6: style elements of type text/css, and stylesheet links.
        const namespace: string | undefined = this.namespaceOf(element);
        const name: string = this.localName(element);
        if ((namespace === SVG_NAMESPACE || namespace === XHTML_NAMESPACE) && name === "style") {
            const type: string = (this.attribute(element, "type") ?? "").trim().toLowerCase();
            if ((type.length === 0 || type === "text/css") && this.mediaHolds(this.attribute(element, "media"))) {
                this.readSheet(this.text(element), this.url, this.authorRules, NO_LAYER);
            }
            return;
        }
        if (namespace === XHTML_NAMESPACE && name === "link") {
            const relations: Array<string> = (this.attribute(element, "rel") ?? "").toLowerCase().split(WHITE_SPACE);
            const href: string | undefined = this.attribute(element, "href");
            if (relations.includes("stylesheet") && !relations.includes("alternate") && href !== undefined && this.mediaHolds(this.attribute(element, "media"))) {
                this.importSheet(this.resolve(href), NO_LAYER);
            }
            return;
        }
        for (const child of element.getChildren()) {
            this.sheets(child);
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

    private importSheet(url: string, layer: string): void {
        this.loading = this.loading ?? new Set<string>();
        if (this.loading.has(url)) {
            return;
        }
        const bytes: Buffer | undefined = this.load(url);
        if (bytes === undefined) {
            this.diagnostics.push("Cannot read the style sheet " + url + " of the SVG image " + this.url);
            return;
        }
        // CSS Syntax 3 §3.2: an @charset rule at the very start gives the encoding, and UTF-8 otherwise.
        const charset: RegExpExecArray | null = /^@charset "([\x00-\x21\x23-\x7F]*)";/.exec(bytes.toString("latin1", 0, Math.min(bytes.length, 1024)));
        let text: string;
        try {
            text = new TextDecoder(charset === null || charset[1].toLowerCase().startsWith("utf-16") ? "utf-8" : charset[1].toLowerCase()).decode(bytes);
        } catch {
            text = new TextDecoder("utf-8").decode(bytes);
        }
        this.loading.add(url);
        this.readSheet(text, url, this.authorRules, layer);
        this.loading.delete(url);
    }

    private readSheet(text: string, baseUrl: string, rules: Array<CompiledRule>, layer: string): void {
        // CSS Cascade 5 §2 and §6.4.4.2, Namespaces 3 §3.1: @import rules, then @namespace rules, then the rest; an @layer
        // statement may come first, and after an @import or @namespace rule it ends both.
        let sheet: StyleSheet;
        try {
            sheet = parse(text) as StyleSheet;
        } catch {
            return;
        }
        const namespaces: Map<string, string> = new Map<string, string>();
        const nodes: Array<CssNode> = sheet.children.toArray();
        let index: number = 0;
        let importsAllowed: boolean = true;
        let prefixed: boolean = false;
        for (; index < nodes.length; index++) {
            const node: CssNode = nodes[index];
            const name: string | undefined = node.type === "Atrule" ? node.name.toLowerCase() : undefined;
            if (name === "charset") {
                continue;
            }
            if (node.type === "Atrule" && name === "layer" && node.block === null) {
                if (prefixed) {
                    break;
                }
                this.layerStatement(this.preludeOf(node), layer);
            } else if (node.type === "Atrule" && name === "import") {
                prefixed = true;
                if (importsAllowed) {
                    this.readImport(this.preludeOf(node), baseUrl, namespaces, layer);
                }
            } else if (node.type === "Atrule" && name === "namespace") {
                prefixed = true;
                importsAllowed = false;
                this.readNamespace(this.preludeOf(node), namespaces);
            } else if (this.validRule(node, namespaces)) {
                break;
            }
        }
        this.readRules(nodes.slice(index), baseUrl, namespaces, rules, layer);
    }

    private preludeOf(atrule: Atrule): Array<CssNode> {
        return atrule.prelude !== null && atrule.prelude.type === "AtrulePrelude" ? atrule.prelude.children.toArray() : [];
    }

    private validRule(node: CssNode, namespaces: ReadonlyMap<string, string>): boolean {
        // An invalid rule is ignored, and so does not end the place where @import and @namespace are allowed.
        if (node.type === "Atrule") {
            return SHEET_AT_RULES.has(node.name.toLowerCase());
        }
        return node.type === "Rule" && node.prelude.type === "SelectorList"
            && node.prelude.children.toArray().every((selector: CssNode) => selector.type === "Selector" && this.compiler.compile(selector as Selector, namespaces) !== undefined);
    }

    private readNamespace(prelude: ReadonlyArray<CssNode>, namespaces: Map<string, string>): void {
        const parts: Array<CssNode> = prelude.filter((part: CssNode) => part.type !== "WhiteSpace");
        const uri: CssNode | undefined = parts[parts.length - 1];
        const prefix: CssNode | undefined = parts.length === 2 ? parts[0] : undefined;
        if (uri !== undefined && (uri.type === "String" || uri.type === "Url") && (prefix === undefined || prefix.type === "Identifier")) {
            namespaces.set(prefix === undefined ? SelectorCompiler.DEFAULT_NAMESPACE : (prefix as { name: string }).name, uri.value);
        }
    }

    private readImport(prelude: ReadonlyArray<CssNode>, baseUrl: string, namespaces: ReadonlyMap<string, string>, parent: string): void {
        // CSS Cascade 5 §2: the layer of an import joins the layer order even when the style sheet fails to load.
        let layerName: string | null | undefined;
        let location: string | undefined;
        let media: MediaQueryList | undefined;
        let supported: boolean = true;
        for (const part of prelude) {
            if ((part.type === "String" || part.type === "Url") && location === undefined) {
                location = part.value;
            } else if (part.type === "Identifier" && part.name.toLowerCase() === "layer") {
                layerName = null;
            } else if (part.type === "Function" && part.name.toLowerCase() === "layer") {
                const first: CssNode | null = part.children.first;
                layerName = first === null ? null : this.layerName(first);
                if (layerName === undefined) {
                    return;
                }
            } else if (part.type === "Function" && part.name.toLowerCase() === "supports") {
                const condition: CssNode | null = part.children.first;
                supported = condition !== null && this.supportsEvaluator().supports(condition, namespaces);
            } else if (part.type === "MediaQueryList") {
                media = part;
            }
        }
        if (location === undefined || !supported || (media !== undefined && !this.media(media))) {
            return;
        }
        const layer: string = layerName === undefined ? parent : (layerName === null ? this.anonymousLayer(parent) : this.registerLayer(parent, layerName));
        const sheet: string | undefined = BaseUrls.resolved(location, baseUrl);
        if (sheet !== undefined) {
            this.importSheet(sheet, layer);
        } else {
            this.diagnostics.push("Cannot read the style sheet " + location + " of the SVG image " + this.url);
        }
    }

    private supportsEvaluator(): SupportsEvaluator {
        this.conditions = this.conditions ?? new ConditionEvaluator(DEFAULT_PAGE_SIZE);
        this.supporter = this.supporter ?? new SupportsEvaluator(this.reader, this.compiler, this.conditions);
        return this.supporter;
    }

    private layerStatement(prelude: ReadonlyArray<CssNode>, parent: string): void {
        const list: CssNode | undefined = prelude[0];
        if (list === undefined || list.type !== "LayerList") {
            return;
        }
        const names: Array<string | undefined> = list.children.toArray().map((layer: CssNode) => this.layerName(layer));
        if (names.every((name: string | undefined): name is string => name !== undefined)) {
            for (const name of names) {
                this.registerLayer(parent, name as string);
            }
        }
    }

    private layerBlock(prelude: ReadonlyArray<CssNode>, parent: string): string | undefined {
        const list: CssNode | undefined = prelude[0];
        if (list === undefined) {
            return this.anonymousLayer(parent);
        }
        const name: string | undefined = list.type === "LayerList" ? (list.children.size === 1 ? this.layerName(list.children.first) : undefined) : this.layerName(list);
        return name === undefined ? undefined : this.registerLayer(parent, name);
    }

    private layerName(node: CssNode | null): string | undefined {
        // CSS Cascade 5 §6.4.2: a CSS-wide keyword in a layer name makes the rule invalid.
        if (node === null || node.type !== "Layer") {
            return undefined;
        }
        return node.name.split(".").some((part: string) => CSS_WIDE_KEYWORDS.has(part.toLowerCase())) ? undefined : node.name;
    }

    private registerLayer(parent: string, name: string): string {
        let current: string = parent;
        for (const part of name.split(".")) {
            const key: string = current === NO_LAYER ? part : current + "." + part;
            this.ensureLayer(current, key);
            current = key;
        }
        return current;
    }

    private anonymousLayer(parent: string): string {
        this.anonymousLayers++;
        const key: string = (parent === NO_LAYER ? "" : parent + ".") + "#image" + this.anonymousLayers;
        this.ensureLayer(parent, key);
        return key;
    }

    private ensureLayer(parent: string, key: string): void {
        if (!this.layers.has(key)) {
            this.layers.set(key, []);
            (this.layers.get(parent) as Array<string>).push(key);
        }
    }

    private rank(key: string): number {
        // CSS Cascade 5 §6.4.2 and §6.4.3: the document's layers and the image's share one order, and a layer of the same name is one layer.
        if (this.layerRanks === undefined) {
            const merged: Map<string, Array<string>> = new Map<string, Array<string>>();
            for (const [name, children] of this.hostLayers) {
                merged.set(name, [...children]);
            }
            const add: (name: string) => void = (name: string): void => {
                if (!merged.has(name)) {
                    merged.set(name, []);
                }
                for (const child of this.layers.get(name) as Array<string>) {
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

    private readRules(nodes: ReadonlyArray<CssNode>, baseUrl: string, namespaces: Map<string, string>, rules: Array<CompiledRule>, layer: string): void {
        for (const node of nodes) {
            if (node.type === "Rule") {
                this.readRule(node, baseUrl, namespaces, rules, layer);
                continue;
            }
            if (node.type !== "Atrule") {
                continue;
            }
            const atrule: Atrule = node;
            const name: string = atrule.name.toLowerCase();
            const prelude: Array<CssNode> = this.preludeOf(atrule);
            if (name === "media") {
                const list: CssNode | undefined = prelude[0];
                if (atrule.block !== null && (list === undefined || (list.type === "MediaQueryList" && this.media(list)))) {
                    this.readRules(atrule.block.children.toArray(), baseUrl, namespaces, rules, layer);
                }
            } else if (name === "supports") {
                const condition: CssNode | undefined = prelude[0];
                if (atrule.block !== null && condition !== undefined && this.supportsEvaluator().supports(condition, namespaces)) {
                    this.readRules(atrule.block.children.toArray(), baseUrl, namespaces, rules, layer);
                }
            } else if (name === "layer") {
                if (atrule.block === null) {
                    this.layerStatement(prelude, layer);
                } else {
                    const inner: string | undefined = this.layerBlock(prelude, layer);
                    if (inner !== undefined) {
                        this.readRules(atrule.block.children.toArray(), baseUrl, namespaces, rules, inner);
                    }
                }
            } else if (name === "font-face") {
                this.fontReader = this.fontReader ?? new StylesheetReader(this.table);
                const face: FontFaceRule | undefined = this.fontReader.fontFace(atrule, baseUrl);
                if (face !== undefined) {
                    this.fontFaces.push(face);
                }
            }
        }
    }

    private readRule(rule: Rule, baseUrl: string, namespaces: ReadonlyMap<string, string>, rules: Array<CompiledRule>, layer: string): void {
        if (rule.prelude.type !== "SelectorList") {
            return;
        }
        const selectors: Array<CompiledSelector> = [];
        for (const selector of rule.prelude.children) {
            const compiled: CompiledSelector | undefined = selector.type === "Selector" ? this.compiler.compile(selector as Selector, namespaces) : undefined;
            if (compiled === undefined) {
                return;
            }
            if (compiled.pseudoElement === undefined) {
                selectors.push(compiled);
            }
        }
        const declarations: Array<Declaration> = [];
        for (const child of rule.block.children) {
            const read: Array<Declaration> | undefined = child.type === "Declaration" ? this.reader.read(child, baseUrl, namespaces) : undefined;
            if (read !== undefined) {
                declarations.push(...read.filter((declaration: Declaration) => this.inRange(declaration)));
            }
        }
        if (selectors.length > 0 && declarations.length > 0) {
            rules.push([selectors, declarations, layer]);
        }
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
        for (const [rules, agent] of [[this.agentRules, true], [this.authorRules, false]] as Array<[ReadonlyArray<CompiledRule>, boolean]>) {
            rules.forEach((rule: CompiledRule, order: number) => {
                const specificity: readonly [number, number, number] | undefined = this.specificity(node, rule[0]);
                if (specificity !== undefined) {
                    const rank: number = agent ? 0 : this.rank(rule[2]);
                    rule[1].forEach((declaration: Declaration, position: number) => {
                        const layer: number = declaration.important ? -rank : rank;
                        add(declaration, [declaration.important ? (agent ? 4 : 3) : (agent ? 0 : 2), 0, layer, ...specificity, UNSCOPED, agent ? order : hostCount + order, position]);
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
            let specificity: readonly [number, number, number] | undefined;
            let proximity: number = Number.POSITIVE_INFINITY;
            for (const [root, distance] of rule.scope === undefined ? NO_SCOPE : this.scopeMatches(node, rule.scope)) {
                const found: readonly [number, number, number] | undefined = this.inScopeOf(root, () => this.specificity(node, rule.selectors));
                const difference: number = found === undefined ? -1 : (specificity === undefined ? 1 : this.compare(found, specificity));
                if (found !== undefined && (difference > 0 || (difference === 0 && distance < proximity))) {
                    specificity = found;
                    proximity = distance;
                }
            }
            const own: readonly [number, number, number] | undefined = specificity;
            if (own !== undefined) {
                const rank: number = this.rank(this.hostLayers[rule.layer][0]);
                rule.declarations.forEach((declaration: Declaration, position: number) => {
                    add(declaration, [declaration.important ? 3 : 2, 0, declaration.important ? -rank : rank, ...own, -proximity, order, position]);
                });
            }
        });
    }

    private scopeMatches(node: SvgNode, scope: Scope): Array<readonly [SvgNode | undefined, number]> {
        // CSS Cascade 6 §2.5: the subject must be in scope of a scoping root, and proximity counts the generations between them.
        const matches: Array<readonly [SvgNode | undefined, number]> = [];
        const outerRoots: ReadonlyArray<SvgNode | undefined> = scope.parent === undefined ? [undefined]
            : this.scopeMatches(node, scope.parent).map((match: readonly [SvgNode | undefined, number]) => match[0]);
        let generations: number = 0;
        for (let candidate: SvgNode | undefined = node; candidate !== undefined; candidate = candidate.parent) {
            const current: SvgNode = candidate;
            if (scope.start !== undefined && outerRoots.some((outer: SvgNode | undefined) => this.matchesAny(current, scope.start as ReadonlyArray<CompiledSelector>, outer))
                && this.inScope(node, current, scope)) {
                matches.push([current, generations]);
            }
            generations++;
        }
        if (scope.start === undefined && this.inScope(node, undefined, scope)) {
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
        const parentCustom: ReadonlyMap<string, string> | undefined = parent === undefined ? undefined : this.customs?.get(parent);
        let customs: Map<string, string> | undefined;
        for (const [property, value] of cascaded) {
            if (property.startsWith("--") && value.kind === "custom") {
                customs = customs ?? new Map<string, string>(parentCustom);
                customs.set(property, value.text);
            }
        }
        const inherited: Record<string, CssValue> = Object.create(parent === undefined ? this.initial().values : base.inherited) as Record<string, CssValue>;
        const values: Record<string, CssValue> = Object.create(inherited) as Record<string, CssValue>;
        this.metrics.unsettled(values);
        const properties: Array<string> = [...cascaded.keys()].filter((property: string) => !property.startsWith("--"))
            .sort((first: string, second: string) => this.priority(first) - this.priority(second));
        for (const property of properties) {
            const declared: DeclaredValue = this.substituted(property, cascaded.get(property) as DeclaredValue, customs ?? parentCustom ?? NO_CUSTOMS);
            const inheriting: boolean = this.table.definition(property)?.inherited === true;
            const computed: CssValue | undefined = this.computeValue(property, declared, inheriting, base, values, node);
            if (computed !== undefined) {
                values[property] = computed;
                if (inheriting) {
                    inherited[property] = computed;
                }
            }
        }
        if (parent === undefined && node.element === this.root) {
            this.rootValues = values;
        }
        const style: ComputedStyle = { values, inherited, custom: {} };
        const kept: ReadonlyMap<string, string> | undefined = customs ?? parentCustom;
        if (kept !== undefined) {
            this.customs = this.customs ?? new WeakMap<ComputedStyle, ReadonlyMap<string, string>>();
            this.customs.set(style, kept);
        }
        return style;
    }

    private priority(property: string): number {
        // CSS Values 4 §6.1.1: the font-relative units read the writing mode, the font and the line height, so those
        // properties are computed first; currentcolor reads color.
        return PRIORITIES.get(property) ?? LATER;
    }

    private substituted(property: string, value: DeclaredValue, customs: ReadonlyMap<string, string>): DeclaredValue {
        // CSS Variables 1 §3: var() takes the custom property or its fallback; a value that becomes invalid is unset.
        if (value.kind !== "pending") {
            return value;
        }
        const text: string | undefined = this.replaceVariables(value.text, customs, new Set<string>());
        const read: Array<Declaration> = text === undefined ? [] : this.declarations((value.shorthand ?? property) + ":" + text);
        return read.find((declaration: Declaration) => declaration.property === property)?.value ?? UNSET;
    }

    private replaceVariables(text: string, customs: ReadonlyMap<string, string>, seen: ReadonlySet<string>): string | undefined {
        const start: number = text.search(/var\(/i);
        if (start < 0) {
            return /\b(?:env|attr|if|inherit|random-item)\(/i.test(text) ? undefined : text;
        }
        let depth: number = 0;
        let end: number = start + 3;
        for (; end < text.length; end++) {
            if (text[end] === "(") {
                depth++;
            } else if (text[end] === ")" && --depth === 0) {
                break;
            }
        }
        const inner: string = text.substring(start + 4, end);
        const comma: number = inner.indexOf(",");
        const name: string = (comma < 0 ? inner : inner.substring(0, comma)).trim();
        const known: string | undefined = seen.has(name) ? undefined : customs.get(name);
        let replacement: string | undefined = known === undefined ? undefined : this.replaceVariables(known, customs, new Set<string>([...seen, name]));
        if (replacement === undefined && comma >= 0) {
            replacement = this.replaceVariables(inner.substring(comma + 1), customs, seen);
        }
        return replacement === undefined ? undefined : this.replaceVariables(text.substring(0, start) + replacement + text.substring(end + 1), customs, seen);
    }

    private computeValue(property: string, declared: DeclaredValue, inheriting: boolean, parent: ComputedStyle, values: Record<string, CssValue>, node: SvgNode): CssValue | undefined {
        if (declared.kind === "keyword") {
            return declared.keyword === "inherit" || (declared.keyword === "unset" && inheriting) ? parent.values[property] : this.initial().values[property];
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
