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

import type { Atrule, Block, CssNode, Declaration as CssTreeDeclaration, ListItem, MediaQueryList, Rule, Selector, SelectorList, StyleSheet } from "css-tree";
import { clone, generate, List, parse, tokenize, tokenTypes, walk } from "css-tree";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve as resolvePath } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { FileReader } from "typesxml";
import { FontCatalog } from "../fonts/FontCatalog.js";
import { BaseUrls } from "../pdf/BaseUrls.js";
import { FontSupport } from "../fonts/FontSupport.js";
import { RemoteResource } from "../net/RemoteResource.js";
import { AnPlusBParser } from "./AnPlusBParser.js";
import { AsciiCase } from "./AsciiCase.js";
import type { CompiledSelector } from "./CompiledSelector.js";
import type { PageSize } from "./ConditionEvaluator.js";
import { ConditionEvaluator } from "./ConditionEvaluator.js";
import { CssIdentifierEscaping } from "./CssIdentifierEscaping.js";
import { DeclarationReader } from "./DeclarationReader.js";
import { PropertyTable } from "./PropertyTable.js";
import { SelectorCompiler } from "./SelectorCompiler.js";
import { SelectorText } from "./SelectorText.js";
import type { Token } from "./SubstitutionSyntax.js";
import { SubstitutionSyntax } from "./SubstitutionSyntax.js";
import { SyntaxDefinition } from "./SyntaxDefinition.js";
import type {
    AnPlusB, ContainerCondition, ContainerQuery, CounterStyleRule, Declaration, DeclaredValue, DescriptorRule, FontFaceRule, FontFaceSource,
    FontFeatureValuesRule, FunctionDescriptor, FunctionParameter, FunctionRule, MarginBoxName, MarginRule, PageNth, PagePseudoClass, PageRule,
    PageSelector, PositionTryRule, PropertyRule, Scope, StyleRule, Stylesheet, TocRule
} from "./Stylesheet.js";
import { SupportsEvaluator } from "./SupportsEvaluator.js";
import { ColorParser } from "./values/ColorParser.js";
import type { CssValue } from "./values/CssValue.js";
import { CssValueParser } from "./values/CssValueParser.js";

export const DEFAULT_PAGE_SIZE: PageSize = { width: 210 * 96 / 25.4, height: 297 * 96 / 25.4 };

interface Context {
    baseUrl: string;
    namespaces: Map<string, string>;
    layer: string;
    pageSizeConditional: boolean;
    containers: ReadonlyArray<ContainerQuery>;
    scope?: Scope;
    scopeStart?: SelectorList;
}

interface Chain {
    open: boolean;
    satisfied: boolean;
    negated: Array<ContainerQuery>;
}

type Outcome =
    | { kind: "static"; value: boolean; pageSize: boolean }
    | { kind: "container"; query: ContainerQuery };

interface PendingStyleRule {
    selectors: ReadonlyArray<CompiledSelector>;
    declarations: ReadonlyArray<Declaration>;
    containers: ReadonlyArray<ContainerQuery>;
    scope?: Scope;
    layer: string;
    order: number;
}

interface PendingPageRule {
    selectors: ReadonlyArray<PageSelector>;
    declarations: ReadonlyArray<Declaration>;
    marginRules: ReadonlyArray<MarginRule>;
    footnote: ReadonlyArray<Declaration>;
    layer: string;
    order: number;
}

interface PendingLayered<T> {
    rule: T;
    layer: string;
}

interface LayerNode {
    children: Array<string>;
}

const MARGIN_BOXES: ReadonlySet<string> = new Set<string>([
    "top-left-corner", "top-left", "top-center", "top-right", "top-right-corner", "right-top", "right-middle", "right-bottom",
    "bottom-right-corner", "bottom-right", "bottom-center", "bottom-left", "bottom-left-corner", "left-bottom", "left-middle", "left-top"
]);

const FOOTNOTE_RULE: string = "footnote";

const CONDITIONAL_RULES: ReadonlySet<string> = new Set<string>(["media", "supports", "when", "else", "container"]);

const PAGE_PSEUDO_CLASSES: ReadonlySet<string> = new Set<string>(["first", "left", "right", "blank"]);

const FIXED_COUNTER_STYLES: ReadonlySet<string> = new Set<string>(["none", "decimal", "disc", "square", "circle", "disclosure-open", "disclosure-closed"]);

const RELATIVE_UNITS: ReadonlySet<string> = new Set<string>([
    "em", "rem", "ex", "rex", "cap", "rcap", "ch", "rch", "ic", "ric", "lh", "rlh", "vw", "vh", "vi", "vb", "vmin", "vmax",
    "svw", "svh", "svi", "svb", "svmin", "svmax", "lvw", "lvh", "lvi", "lvb", "lvmin", "lvmax", "dvw", "dvh", "dvi", "dvb", "dvmin", "dvmax",
    "cqw", "cqh", "cqi", "cqb", "cqmin", "cqmax"
]);

const CONTAINER_KEYWORDS: ReadonlySet<string> = new Set<string>(["none", "and", "not", "or", "initial", "inherit", "unset", "revert", "revert-layer", "default"]);

const POSITION_TRY_PROPERTIES: RegExp = /^(?:top|right|bottom|left|inset-(?:block|inline)-(?:start|end)|margin-(?:top|right|bottom|left|block-start|block-end|inline-start|inline-end)|(?:min-|max-)?(?:width|height|block-size|inline-size)|align-self|justify-self|position-anchor|position-area)$/;

const TOP_LEVEL_AT_RULES: ReadonlySet<string> = new Set<string>([
    "import", "namespace", "layer", "media", "supports", "supports-condition", "when", "else", "container", "scope", "page", "font-face",
    "font-feature-values", "font-palette-values", "color-profile", "counter-style", "property", "position-try", "function", "custom-media",
    PropertyTable.TOC_TITLE, PropertyTable.TOC_ENTRY, PropertyTable.TOC_DIVIDER, "keyframes", "starting-style", "view-transition"
]);

const LEVEL: RegExp = /^[1-9]\d*$/;

const FONT_FORMATS: ReadonlySet<string> = new Set<string>(["collection", "embedded-opentype", "opentype", "svg", "truetype", "woff", "woff2"]);

const FORMAT_STRINGS: ReadonlySet<string> = new Set<string>(["woff2", "woff", "truetype", "opentype", "collection"]);

const FONT_TECHNOLOGIES: ReadonlySet<string> = new Set<string>([
    "features-opentype", "features-aat", "features-graphite", "color-colrv0", "color-colrv1", "color-svg", "color-sbix", "color-cbdt",
    "variations", "palettes", "incremental", "avar2"
]);

const VARIATIONS_SUFFIX: string = "-variations";

const FEATURE_BLOCKS: ReadonlySet<string> = new Set<string>(["stylistic", "historical-forms", "styleset", "character-variant", "swash", "ornaments", "annotation"]);

const UNLAYERED: string = "";

export class StylesheetReader {

    private readonly table: PropertyTable;
    private readonly diagnostics: Array<string> = [];
    private readonly declarations: DeclarationReader;
    private readonly selectors: SelectorCompiler = new SelectorCompiler();
    private readonly selectorText: SelectorText = new SelectorText();
    private readonly conditions: ConditionEvaluator = new ConditionEvaluator(DEFAULT_PAGE_SIZE);
    private readonly supports: SupportsEvaluator;
    private readonly values: CssValueParser = new CssValueParser();
    private readonly colors: ColorParser = new ColorParser(undefined);
    private readonly asciiCase: AsciiCase = new AsciiCase();
    private readonly escaping: CssIdentifierEscaping = new CssIdentifierEscaping();
    private readonly anPlusB: AnPlusBParser = new AnPlusBParser();
    private readonly remote: RemoteResource = new RemoteResource();
    private readonly fontSupport: FontSupport = new FontSupport();
    private readonly syntaxDefinition: SyntaxDefinition = new SyntaxDefinition();
    private readonly substitutionSyntax: SubstitutionSyntax = new SubstitutionSyntax();
    private readonly customMedia: Array<readonly [string, string | boolean]> = [];
    private readonly sheets: Map<string, StyleSheet> = new Map<string, StyleSheet>();
    private unread?: Set<string>;
    private readonly styleRules: Array<PendingStyleRule> = [];
    private readonly pageRules: Array<PendingPageRule> = [];
    private readonly fontFaces: Array<FontFaceRule> = [];
    private readonly fontFeatureValues: Array<FontFeatureValuesRule> = [];
    private readonly fontPalettes: Array<DescriptorRule> = [];
    private readonly colorProfiles: Array<DescriptorRule> = [];
    private readonly counterStyles: Array<PendingLayered<CounterStyleRule>> = [];
    private readonly properties: Array<PropertyRule> = [];
    private readonly positionTries: Array<PendingLayered<PositionTryRule>> = [];
    private readonly functions: Array<PendingLayered<FunctionRule>> = [];
    private readonly tocRules: Array<TocRule> = [];
    private readonly layers: Map<string, LayerNode> = new Map<string, LayerNode>([[UNLAYERED, { children: [] }]]);
    private readonly loading: Set<string> = new Set<string>();
    private order: number = 0;
    private anonymousLayers: number = 0;

    constructor(table: PropertyTable = new PropertyTable()) {
        this.table = table;
        this.declarations = new DeclarationReader(table);
        this.supports = new SupportsEvaluator(this.declarations, this.selectors, this.conditions);
    }

    read(path: string): Stylesheet {
        const url: string = pathToFileURL(resolvePath(path)).href;
        this.sheets.set(url, parse(this.readFile(path)) as StyleSheet);
        this.defineCustomMedia(url, new Set<string>());
        this.readSheet(url, UNLAYERED);
        return this.result();
    }

    readLinked(instructions: ReadonlyArray<string>, baseUrl: string): Stylesheet {
        // Associating Style Sheets with XML Documents 1.0 §2: the pseudo-attributes of each instruction, whose sheets come in
        // order; an alternate style sheet is not applied.
        for (const data of instructions) {
            const pseudo: Map<string, string> = new Map<string, string>();
            for (const match of data.matchAll(/([A-Za-z_][\w.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
                pseudo.set(match[1], match[2] ?? match[3]);
            }
            const href: string | undefined = pseudo.get("href");
            const type: string | undefined = pseudo.get("type");
            if (href === undefined || (type !== undefined && type.trim().toLowerCase() !== "text/css") || pseudo.get("alternate") === "yes" || !this.linkedMedia(pseudo.get("media"))) {
                continue;
            }
            const url: string | undefined = URL.canParse(href, baseUrl) ? new URL(href, baseUrl).href : undefined;
            if (url === undefined || this.sheet(url) === undefined) {
                this.diagnostics.push("Cannot read the stylesheet " + href + " linked by " + baseUrl + (url === undefined ? "" : this.remote.failure(url)));
                continue;
            }
            this.defineCustomMedia(url, new Set<string>());
            this.readSheet(url, UNLAYERED);
        }
        return this.result();
    }

    private linkedMedia(media?: string): boolean {
        if (media === undefined || media.trim().length === 0) {
            return true;
        }
        const list: MediaQueryList | null = this.mediaListOf(media);
        return list !== null && this.conditions.matchesList(list);
    }

    private defineCustomMedia(url: string, visited: Set<string>): void {
        // Media Queries 5 §10: a custom media query can be used before the rule that defines it, so all of them are read first.
        const sheet: StyleSheet | undefined = this.sheet(url);
        if (sheet === undefined || visited.has(url)) {
            return;
        }
        visited.add(url);
        for (const node of sheet.children) {
            if (node.type !== "Atrule") {
                continue;
            }
            const name: string = this.asciiCase.foldLower(node.name);
            if (name === "custom-media") {
                this.readCustomMedia(node);
            } else if (name === "import") {
                const location: string | undefined = this.importLocation(node);
                const target: string | undefined = location === undefined || !this.importApplies(node, new Map<string, string>()) ? undefined : BaseUrls.resolved(location, url);
                if (target !== undefined) {
                    this.defineCustomMedia(target, visited);
                }
            }
        }
    }

    private readCustomMedia(atrule: Atrule): void {
        // Media Queries 5 §10: @custom-media <extension-name> [ <media-query-list> | true | false ];
        const text: string = this.preludeText(atrule).trim();
        const match: RegExpExecArray | null = /^(--\S+)\s+([\s\S]+)$/.exec(text);
        if (match === null) {
            return;
        }
        const value: string = this.asciiCase.foldLower(match[2].trim());
        if (value === "true" || value === "false") {
            this.conditions.define(match[1], value === "true");
            this.customMedia.push([match[1], value === "true"]);
            return;
        }
        const list: MediaQueryList | null = this.mediaListOf(match[2]);
        if (list !== null) {
            this.conditions.define(match[1], list);
            this.customMedia.push([match[1], match[2]]);
        }
    }

    private readSheet(url: string, layer: string): void {
        // CSS Cascade 5 §2 and §6.4.4.2, Namespaces 3 §3.1, Conditional 5 §8: @import rules, then @namespace rules, then the
        // rest; @layer statements and @supports-condition may come first, and after an @import or @namespace rule they end both.
        const sheet: StyleSheet | undefined = this.sheet(url);
        if (sheet === undefined) {
            return;
        }
        this.loading.add(url);
        const context: Context = { baseUrl: url, namespaces: new Map<string, string>(), layer, pageSizeConditional: false, containers: [] };
        const nodes: Array<CssNode> = sheet.children.toArray();
        let index: number = 0;
        let importsAllowed: boolean = true;
        let prefixed: boolean = false;
        for (; index < nodes.length; index++) {
            const node: CssNode = nodes[index];
            const name: string | undefined = node.type === "Atrule" ? this.asciiCase.foldLower(node.name) : undefined;
            if (name === "charset") {
                continue;
            }
            if ((name === "layer" && (node as Atrule).block === null) || name === "supports-condition") {
                if (prefixed) {
                    break;
                }
                if (name === "layer") {
                    this.readLayerStatement(node as Atrule, context);
                } else {
                    this.readSupportsCondition(node as Atrule, context);
                }
            } else if (name === "import") {
                prefixed = true;
                if (importsAllowed) {
                    this.readImport(node as Atrule, context);
                }
            } else if (name === "namespace") {
                prefixed = true;
                importsAllowed = false;
                this.readNamespace(node as Atrule, context);
            } else if (this.isValidRule(node, context)) {
                break;
            }
        }
        this.readRuleList(nodes.slice(index), context);
        this.loading.delete(url);
    }

    private isValidRule(node: CssNode, context: Context): boolean {
        // An invalid rule is ignored, and so does not end the place where @import and @namespace are allowed.
        if (node.type === "Atrule") {
            return TOP_LEVEL_AT_RULES.has(this.asciiCase.foldLower(node.name));
        }
        if (node.type !== "Rule") {
            return false;
        }
        const prelude: SelectorList | undefined = node.prelude.type === "SelectorList" ? node.prelude
            : (node.prelude.type === "Raw" ? this.selectorText.parseList(node.prelude.value) : undefined);
        return prelude !== undefined && this.compileList(prelude, context) !== undefined;
    }

    private readRuleList(nodes: ReadonlyArray<CssNode>, context: Context): void {
        const chain: Chain = { open: false, satisfied: false, negated: [] };
        for (const node of nodes) {
            if (node.type === "Atrule" && CONDITIONAL_RULES.has(this.asciiCase.foldLower(node.name))) {
                this.readConditional(node, context, chain, (inner: Context) => {
                    if (node.block !== null) {
                        this.readRuleList(node.block.children.toArray(), inner);
                    }
                });
                continue;
            }
            chain.open = false;
            this.readRule(node, context);
        }
    }

    private readRule(node: CssNode, context: Context): void {
        if (node.type === "Rule") {
            this.readStyleRule(node, context);
            return;
        }
        if (node.type !== "Atrule") {
            return;
        }
        switch (this.asciiCase.foldLower(node.name)) {
            case "layer":
                this.readLayerBlock(node, context, (children: ReadonlyArray<CssNode>, inner: Context) => this.readRuleList(children, inner));
                break;
            case "scope":
                this.readScope(node, context);
                break;
            case "page":
                this.readPage(node, context);
                break;
            case "font-face":
                this.readFontFace(node, context.baseUrl);
                break;
            case "font-feature-values":
                this.readFontFeatureValues(node);
                break;
            case "font-palette-values":
                this.readDescriptorRule("font-palette-values", node, context);
                break;
            case "color-profile":
                this.readDescriptorRule("color-profile", node, context);
                break;
            case "counter-style":
                this.readCounterStyle(node, context);
                break;
            case "property":
                this.readProperty(node);
                break;
            case "position-try":
                this.readPositionTry(node, context);
                break;
            case "function":
                this.readFunction(node, context);
                break;
            case "supports-condition":
                this.readSupportsCondition(node, context);
                break;
            case PropertyTable.TOC_TITLE:
            case PropertyTable.TOC_ENTRY:
            case PropertyTable.TOC_DIVIDER:
                this.readTocRule(node, context);
                break;
            default:
                break;
        }
    }

    private readTocRule(atrule: Atrule, context: Context): void {
        const kind: string = this.asciiCase.foldLower(atrule.name);
        const prelude: string = this.preludeText(atrule).trim();
        if (atrule.block === null || (prelude.length > 0 && (kind !== PropertyTable.TOC_ENTRY || !LEVEL.test(prelude)))) {
            return;
        }
        const rule: TocRule = { kind, declarations: this.blockDeclarations(atrule.block, context), order: this.order++ };
        if (prelude.length > 0) {
            rule.level = Number(prelude);
        }
        this.tocRules.push(rule);
    }

    private readConditional(atrule: Atrule, context: Context, chain: Chain, readBlock: (inner: Context) => void): void {
        // CSS Conditional 5 §4: in a chain of conditional group rules only the first whose condition holds applies; a condition
        // that depends on the query container is kept, and the rules after it in the chain require it to be false.
        const name: string = this.asciiCase.foldLower(atrule.name);
        let outcome: Outcome;
        if (name === "else") {
            if (!chain.open) {
                return;
            }
            outcome = atrule.prelude === null ? { kind: "static", value: true, pageSize: false } : { kind: "static", value: this.supports.when(this.preludeText(atrule), context.namespaces), pageSize: false };
        } else {
            chain.open = true;
            chain.satisfied = false;
            chain.negated = [];
            outcome = this.outcomeOf(name, atrule, context);
        }
        if (chain.satisfied) {
            return;
        }
        const containers: Array<ContainerQuery> = [...context.containers, ...chain.negated];
        if (outcome.kind === "static") {
            if (outcome.value) {
                readBlock({ ...context, containers, pageSizeConditional: context.pageSizeConditional || outcome.pageSize });
                chain.satisfied = true;
            }
            return;
        }
        readBlock({ ...context, containers: [...containers, outcome.query] });
        chain.negated = [...chain.negated, { conditions: outcome.query.conditions, negated: true }];
    }

    private outcomeOf(name: string, atrule: Atrule, context: Context): Outcome {
        switch (name) {
            case "media": {
                const list: MediaQueryList | null = this.mediaQueryList(atrule);
                const valid: boolean = atrule.prelude === null || list !== null;
                return { kind: "static", value: valid && this.conditions.matchesList(list), pageSize: this.conditions.mentionsPageSize(list) };
            }
            case "supports": {
                const condition: CssNode | null = atrule.prelude !== null && atrule.prelude.type === "AtrulePrelude" ? atrule.prelude.children.first : null;
                return { kind: "static", value: condition !== null && this.supports.supports(condition, context.namespaces), pageSize: false };
            }
            case "when":
                return { kind: "static", value: atrule.prelude !== null && this.supports.when(this.preludeText(atrule), context.namespaces), pageSize: false };
            default: {
                const query: ContainerQuery | undefined = this.containerQuery(this.preludeText(atrule));
                return query === undefined ? { kind: "static", value: false, pageSize: false } : { kind: "container", query };
            }
        }
    }

    private containerQuery(text: string): ContainerQuery | undefined {
        // CSS Conditional 5 §5.4: <container-condition># where each is [ <container-name>? <container-query>? ]!; the name is a
        // <custom-ident> other than none, and, not and or, and a <query-in-parens> is a parenthesized query or a function.
        const conditions: Array<ContainerCondition> = [];
        for (const part of this.splitTopLevel(text, ",")) {
            const tokens: Array<Token> = this.substitutionSyntax.trim(this.substitutionSyntax.tokens(part));
            const first: Token | undefined = tokens[0];
            const named: boolean = first !== undefined && first.type === tokenTypes.Ident && !CONTAINER_KEYWORDS.has(this.asciiCase.foldLower(this.escaping.unescape(first.text)));
            const query: Array<Token> = named ? this.substitutionSyntax.trim(tokens.slice(1)) : tokens;
            const start: Token | undefined = query[0];
            const queryStart: boolean = start !== undefined && (start.type === tokenTypes.LeftParenthesis || start.type === tokenTypes.Function
                || (start.type === tokenTypes.Ident && this.asciiCase.foldLower(start.text) === "not"));
            if ((!named && !queryStart) || (query.length > 0 && !queryStart)) {
                return undefined;
            }
            const condition: ContainerCondition = {};
            if (named) {
                condition.name = this.escaping.unescape(first.text);
            }
            if (query.length > 0) {
                condition.query = this.substitutionSyntax.serialize(query);
            }
            conditions.push(condition);
        }
        return conditions.length === 0 ? undefined : { conditions, negated: false };
    }

    private readImport(atrule: Atrule, context: Context): void {
        // CSS Cascade 5 §2: @import [ <url> | <string> ] [ layer | layer(<layer-name>) ]? [ supports( ... ) ]? <media-query-list>?;
        // the layer joins the layer order even when the sheet fails to load, but only when the import conditions hold.
        if (atrule.prelude === null || atrule.prelude.type !== "AtrulePrelude") {
            return;
        }
        let layerName: string | null | undefined;
        for (const child of atrule.prelude.children) {
            if (child.type === "Identifier" && this.asciiCase.foldLower(child.name) === "layer") {
                layerName = null;
            } else if (child.type === "Function" && this.asciiCase.foldLower(child.name) === "layer") {
                layerName = this.layerName(child.children.first);
                if (layerName === undefined) {
                    return;
                }
            }
        }
        const location: string | undefined = this.importLocation(atrule);
        if (location === undefined || !this.importApplies(atrule, context.namespaces)) {
            return;
        }
        const layer: string = layerName === undefined ? context.layer
            : (layerName === null ? this.anonymousLayer(context.layer) : this.registerLayer(context.layer, layerName));
        const url: string | undefined = BaseUrls.resolved(location, context.baseUrl);
        if (url === undefined) {
            this.diagnostics.push("Cannot read the stylesheet " + location + " imported by " + context.baseUrl);
            return;
        }
        if (this.loading.has(url)) {
            return;
        }
        if (this.sheet(url) === undefined) {
            this.diagnostics.push("Cannot read the stylesheet " + url + " imported by " + context.baseUrl + this.remote.failure(url));
            return;
        }
        this.readSheet(url, layer);
    }

    private importApplies(atrule: Atrule, namespaces: ReadonlyMap<string, string>): boolean {
        if (atrule.prelude === null || atrule.prelude.type !== "AtrulePrelude") {
            return false;
        }
        let media: MediaQueryList | null = null;
        let supported: boolean = true;
        for (const child of atrule.prelude.children) {
            if (child.type === "Function" && this.asciiCase.foldLower(child.name) === "supports") {
                const condition: CssNode | null = child.children.first;
                supported = condition !== null && this.supports.supports(condition, namespaces);
            } else if (child.type === "MediaQueryList") {
                media = child;
            }
        }
        return supported && this.conditions.matchesList(media);
    }

    private importLocation(atrule: Atrule): string | undefined {
        if (atrule.prelude === null || atrule.prelude.type !== "AtrulePrelude") {
            return undefined;
        }
        for (const child of atrule.prelude.children) {
            if (child.type === "String" || child.type === "Url") {
                return child.value;
            }
        }
        return undefined;
    }

    private readNamespace(atrule: Atrule, context: Context): void {
        // CSS Namespaces 3 §3.1: @namespace <namespace-prefix>? [ <string> | <url> ]; a malformed rule is ignored, and §3.3:
        // a prefix declared again keeps only its last declaration.
        if (atrule.prelude === null || atrule.prelude.type !== "AtrulePrelude") {
            return;
        }
        const parts: Array<CssNode> = atrule.prelude.children.toArray();
        const prefixNode: CssNode | undefined = parts.length === 2 ? parts[0] : undefined;
        const uriNode: CssNode | undefined = parts[parts.length - 1];
        if (parts.length < 1 || parts.length > 2 || (prefixNode !== undefined && prefixNode.type !== "Identifier")
            || uriNode === undefined || (uriNode.type !== "String" && uriNode.type !== "Url")) {
            return;
        }
        context.namespaces.set(prefixNode === undefined ? SelectorCompiler.DEFAULT_NAMESPACE : this.escaping.unescape((prefixNode as { name: string }).name), uriNode.value);
    }

    private readSupportsCondition(atrule: Atrule, context: Context): void {
        const first: CssNode | null = atrule.prelude !== null && atrule.prelude.type === "AtrulePrelude" ? atrule.prelude.children.first : null;
        if (first !== null && first.type === "Identifier" && first.name.startsWith("--") && atrule.block !== null) {
            this.supports.define(first.name, atrule.block, context.namespaces);
        }
    }

    private readLayerStatement(atrule: Atrule, context: Context): void {
        if (atrule.prelude === null || atrule.prelude.type !== "AtrulePrelude") {
            return;
        }
        const list: CssNode | null = atrule.prelude.children.first;
        if (list === null || list.type !== "LayerList") {
            return;
        }
        for (const layer of list.children) {
            const name: string | undefined = this.layerName(layer);
            if (name !== undefined) {
                this.registerLayer(context.layer, name);
            }
        }
    }

    private readLayerBlock(atrule: Atrule, context: Context, readChildren: (children: ReadonlyArray<CssNode>, inner: Context) => void): void {
        if (atrule.block === null) {
            this.readLayerStatement(atrule, context);
            return;
        }
        const list: CssNode | null = atrule.prelude !== null && atrule.prelude.type === "AtrulePrelude" ? atrule.prelude.children.first : null;
        let layer: string;
        if (list === null) {
            layer = this.anonymousLayer(context.layer);
        } else {
            const first: CssNode | null = list.type === "LayerList" ? list.children.first : list;
            const name: string | undefined = list.type === "LayerList" && list.children.size !== 1 ? undefined : this.layerName(first);
            if (name === undefined) {
                return;
            }
            layer = this.registerLayer(context.layer, name);
        }
        readChildren(this.blockItems(atrule.block), { ...context, layer });
    }

    private layerName(node: CssNode | null): string | undefined {
        return node !== null && node.type === "Layer" ? node.name : undefined;
    }

    private registerLayer(parent: string, name: string): string {
        // CSS Cascade 5 §6.4.3: a layer name is relative to the layer it appears in, and "a.b" names b inside a.
        let current: string = parent;
        for (const part of name.split(".")) {
            const key: string = current === UNLAYERED ? part : current + "." + part;
            this.ensureLayer(current, key);
            current = key;
        }
        return current;
    }

    private anonymousLayer(parent: string): string {
        this.anonymousLayers++;
        const key: string = (parent === UNLAYERED ? "" : parent + ".") + "#" + this.anonymousLayers;
        this.ensureLayer(parent, key);
        return key;
    }

    private ensureLayer(parent: string, key: string): void {
        if (!this.layers.has(key)) {
            this.layers.set(key, { children: [] });
            (this.layers.get(parent) as LayerNode).children.push(key);
        }
    }

    private readStyleRule(rule: Rule, context: Context, parent?: SelectorList): void {
        // CSS Nesting 1 §3: a nested rule's selectors are relative to its parent's; CSS Cascade 6 §2.5.3: a scoped rule's to :scope.
        const prelude: SelectorList | undefined = rule.prelude.type === "SelectorList" ? rule.prelude
            : (rule.prelude.type === "Raw" ? this.selectorText.parseList(rule.prelude.value) : undefined);
        if (prelude === undefined) {
            return;
        }
        let list: SelectorList = prelude;
        if (parent !== undefined) {
            list = this.nestedList(prelude, parent);
        } else if (context.scope !== undefined) {
            list = this.scopedList(prelude, context.scopeStart);
        }
        const compiled: Array<CompiledSelector> | undefined = this.compileList(list, context);
        if (compiled !== undefined) {
            this.readStyleBlock(rule.block, compiled, context, list);
        }
    }

    private compileList(list: SelectorList, context: Context): Array<CompiledSelector> | undefined {
        const compiled: Array<CompiledSelector> = [];
        for (const selector of list.children) {
            const result: CompiledSelector | undefined = selector.type === "Selector" ? this.selectors.compile(selector, context.namespaces) : undefined;
            if (result === undefined) {
                return undefined;
            }
            compiled.push(result);
        }
        return compiled;
    }

    private readStyleBlock(block: Block, compiled: ReadonlyArray<CompiledSelector>, context: Context, list?: SelectorList): void {
        // CSS Nesting 1 §3.4 and §5: declarations after a nested rule form a nested declarations rule with the parent's selectors.
        let pending: Array<Declaration> = [];
        let first: boolean = true;
        const flush: () => void = (): void => {
            if (first || pending.length > 0) {
                this.pushStyleRule(compiled, pending, context);
            }
            first = false;
            pending = [];
        };
        const chain: Chain = { open: false, satisfied: false, negated: [] };
        for (const child of this.blockItems(block)) {
            if (child.type === "Declaration") {
                chain.open = false;
                const read: Array<Declaration> | undefined = this.declarations.read(child, context.baseUrl, context.namespaces);
                if (read !== undefined) {
                    pending.push(...read);
                } else {
                    this.reportInvalid(child);
                }
                continue;
            }
            flush();
            if (child.type === "Atrule" && CONDITIONAL_RULES.has(this.asciiCase.foldLower(child.name))) {
                this.readConditional(child, context, chain, (inner: Context) => {
                    if (child.block !== null) {
                        this.readStyleBlock(child.block, compiled, inner, list);
                    }
                });
                continue;
            }
            chain.open = false;
            if (child.type === "Rule") {
                this.readStyleRule(child, context, list);
            } else if (child.type === "Atrule") {
                this.readNestedAtrule(child, compiled, context, list);
            }
        }
        flush();
    }

    private readNestedAtrule(atrule: Atrule, compiled: ReadonlyArray<CompiledSelector>, context: Context, list?: SelectorList): void {
        // CSS Nesting 1 §3.3: @layer and @scope nest inside style rules; declarations directly inside apply to the parent selectors.
        switch (this.asciiCase.foldLower(atrule.name)) {
            case "layer":
                this.readLayerBlock(atrule, context, (children: ReadonlyArray<CssNode>, inner: Context) => {
                    if (atrule.block !== null) {
                        this.readStyleBlock({ type: "Block", children: new List<CssNode>().fromArray([...children]) } as Block, compiled, inner, list);
                    }
                });
                break;
            case "scope":
                this.readScope(atrule, context, list, compiled);
                break;
            default:
                break;
        }
    }

    private pushStyleRule(selectors: ReadonlyArray<CompiledSelector>, declarations: ReadonlyArray<Declaration>, context: Context): void {
        const rule: PendingStyleRule = { selectors, declarations, containers: context.containers, layer: context.layer, order: this.order++ };
        if (context.scope !== undefined) {
            rule.scope = context.scope;
        }
        this.styleRules.push(rule);
    }

    private readScope(atrule: Atrule, context: Context, parent?: SelectorList, parentCompiled?: ReadonlyArray<CompiledSelector>): void {
        // CSS Cascade 6 §2.5.2: @scope [(<scope-start>)]? [to (<scope-end>)]? { <rule-list> }, pseudo-elements invalid in both lists;
        // §2.5.4: without <scope-start> the scoping root is the root of the document; §2.5.5: a start is relative to the outer context.
        if (atrule.block === null) {
            return;
        }
        const bounds: { root: SelectorList | null; limit: SelectorList | null } | undefined = atrule.prelude !== null && atrule.prelude.type === "Raw"
            ? this.rawScope(atrule.prelude.value) : this.parsedScope(atrule);
        if (bounds === undefined) {
            return;
        }
        const root: SelectorList | null = bounds.root;
        const limit: SelectorList | null = bounds.limit;
        const startList: SelectorList | undefined = root === null ? undefined : (parent !== undefined ? this.nestedList(root, parent) : this.withNesting(root, context.scopeStart));
        // CSS Cascade 6 §2.5.3: & stands for :is(<scope-start>); CSS Nesting 1 §3.3.1: in a nested @scope it behaves like :where(:scope).
        const ampersand: SelectorList | undefined = parent !== undefined ? this.selectorList(":where(:scope)") : startList;
        const start: Array<CompiledSelector> | undefined = startList === undefined ? undefined : this.compileList(startList, context);
        const endList: SelectorList | undefined = limit === null ? undefined : this.withNesting(limit, ampersand);
        const end: Array<CompiledSelector> | undefined = endList === undefined ? undefined : this.compileList(endList, context);
        if ((startList !== undefined && start === undefined) || (endList !== undefined && end === undefined)
            || start?.some((selector: CompiledSelector) => selector.pseudoElement !== undefined) === true
            || end?.some((selector: CompiledSelector) => selector.pseudoElement !== undefined) === true) {
            return;
        }
        const scope: Scope = {};
        if (start !== undefined) {
            scope.start = start;
        }
        if (end !== undefined) {
            scope.end = end;
        }
        if (context.scope !== undefined) {
            scope.parent = context.scope;
        }
        const inner: Context = { baseUrl: context.baseUrl, namespaces: context.namespaces, layer: context.layer, pageSizeConditional: context.pageSizeConditional, containers: context.containers, scope };
        if (ampersand !== undefined) {
            inner.scopeStart = ampersand;
        }
        const nodes: Array<CssNode> = this.blockItems(atrule.block);
        if (parentCompiled !== undefined) {
            // CSS Nesting 1 §3.3 and §5: nested in a style rule the block holds <block-contents>, and its declarations form nested
            // declarations rules that match what the parent style rule matches; its style rules are scoped style rules.
            this.readStyleBlock({ type: "Block", children: new List<CssNode>().fromArray(nodes) } as Block, parentCompiled, inner);
        } else {
            this.readRuleList(nodes, inner);
        }
    }

    private parsedScope(atrule: Atrule): { root: SelectorList | null; limit: SelectorList | null } | undefined {
        if (atrule.prelude === null) {
            return { root: null, limit: null };
        }
        const prelude: CssNode | null = atrule.prelude.type === "AtrulePrelude" ? atrule.prelude.children.first : null;
        if (prelude === null || prelude.type !== "Scope") {
            return undefined;
        }
        const root: CssNode | null = prelude.root;
        const limit: CssNode | null = prelude.limit;
        if ((root !== null && root.type !== "SelectorList") || (limit !== null && limit.type !== "SelectorList")) {
            return undefined;
        }
        return { root: root as SelectorList | null, limit: limit as SelectorList | null };
    }

    private rawScope(text: string): { root: SelectorList | null; limit: SelectorList | null } | undefined {
        // A prelude whose selectors use the column or reference combinator of Selectors 5 is read as [(<scope-start>)]? [to (<scope-end>)]?.
        let rest: string = text.trim();
        let root: SelectorList | null = null;
        let limit: SelectorList | null = null;
        if (rest.startsWith("(")) {
            const close: number = this.matchingParenthesis(rest, 0);
            const parsed: SelectorList | undefined = close === -1 ? undefined : this.selectorText.parseList(rest.substring(1, close));
            if (parsed === undefined) {
                return undefined;
            }
            root = parsed;
            rest = rest.substring(close + 1).trim();
        }
        const to: RegExpExecArray | null = /^to\s*\(/i.exec(rest);
        if (to !== null) {
            const open: number = to[0].length - 1;
            const close: number = this.matchingParenthesis(rest, open);
            const parsed: SelectorList | undefined = close === -1 ? undefined : this.selectorText.parseList(rest.substring(open + 1, close));
            if (parsed === undefined) {
                return undefined;
            }
            limit = parsed;
            rest = rest.substring(close + 1).trim();
        }
        return rest.length === 0 ? { root, limit } : undefined;
    }

    private scopedList(list: SelectorList, scopeStart?: SelectorList): SelectorList {
        // CSS Cascade 6 §2.5.3: a scoped selector without & or :scope is relative to the scoping root, which adds no specificity.
        const scoped: Array<CssNode> = [];
        for (const item of list.children) {
            if (item.type !== "Selector") {
                scoped.push(item);
                continue;
            }
            const selector: Selector = this.withNesting({ type: "SelectorList", children: new List<CssNode>().fromArray([item]) } as SelectorList, scopeStart).children.first as Selector;
            let anchored: boolean = false;
            walk(item, (node: CssNode) => {
                anchored = anchored || node.type === "NestingSelector" || (node.type === "PseudoClassSelector" && this.asciiCase.foldLower(node.name) === "scope");
            });
            const first: CssNode | null = selector.children.first;
            const relative: boolean = first !== null && first.type === "Combinator";
            if (relative || !anchored) {
                if (!relative) {
                    selector.children.prependData({ type: "Combinator", name: " " });
                }
                selector.children.prependData((this.selectorList(":where(:scope)").children.first as Selector).children.first as CssNode);
            }
            scoped.push(selector);
        }
        return { type: "SelectorList", children: new List<CssNode>().fromArray(scoped) } as SelectorList;
    }

    private withNesting(list: SelectorList, replacement?: SelectorList): SelectorList {
        // Inside @scope, & stands for :is(<scope-start>), or for :scope when there is no start.
        const copy: SelectorList = clone(list) as SelectorList;
        if (replacement !== undefined) {
            walk(copy, {
                visit: "NestingSelector",
                enter: (node: CssNode, listItem: ListItem<CssNode>, siblings: List<CssNode>) => {
                    siblings.replace(listItem, siblings.createItem(this.isOf(replacement)));
                }
            });
        }
        return copy;
    }

    private selectorList(text: string): SelectorList {
        return parse(text, { context: "selectorList" }) as SelectorList;
    }

    private blockItems(block: Block): Array<CssNode> {
        // A nested rule that does not start with "&" leaves the rest of the block as raw text; CSS Syntax 3 §5.5.5 reads it as
        // declarations and qualified rules.
        const items: Array<CssNode> = [];
        for (const child of block.children) {
            if (child.type === "Raw") {
                items.push(...this.rawItems(child.value));
            } else {
                items.push(child);
            }
        }
        return items;
    }

    private rawItems(text: string): Array<CssNode> {
        const items: Array<CssNode> = [];
        let start: number = 0;
        let depth: number = 0;
        let sawBlock: boolean = false;
        tokenize(text, (type: number, tokenStart: number, tokenEnd: number) => {
            if (type === tokenTypes.LeftCurlyBracket || type === tokenTypes.LeftParenthesis || type === tokenTypes.LeftSquareBracket || type === tokenTypes.Function) {
                depth++;
                sawBlock = sawBlock || (type === tokenTypes.LeftCurlyBracket && depth === 1);
            } else if (type === tokenTypes.RightCurlyBracket || type === tokenTypes.RightParenthesis || type === tokenTypes.RightSquareBracket) {
                depth--;
                if (depth === 0 && type === tokenTypes.RightCurlyBracket && sawBlock) {
                    items.push(...this.parseItem(text.substring(start, tokenEnd), true));
                    start = tokenEnd;
                    sawBlock = false;
                }
            } else if (type === tokenTypes.Semicolon && depth === 0) {
                items.push(...this.parseItem(text.substring(start, tokenStart), false));
                start = tokenEnd;
            }
        });
        if (text.substring(start).trim().length > 0) {
            items.push(...this.parseItem(text.substring(start), sawBlock));
        }
        return items;
    }

    private parseItem(text: string, block: boolean): Array<CssNode> {
        const trimmed: string = text.trim();
        if (trimmed.length === 0) {
            return [];
        }
        try {
            if (block) {
                const parsed: StyleSheet = parse(trimmed) as StyleSheet;
                return parsed.children.toArray();
            }
            return [parse(trimmed, { context: "declaration" })];
        } catch {
            return [];
        }
    }

    private nestedList(list: SelectorList, parent: SelectorList): SelectorList {
        // CSS Nesting 1 §3.1 and §4: & stands for :is(parent selectors); a selector without & is relative to them.
        const nested: Array<CssNode> = [];
        for (const item of list.children) {
            if (item.type !== "Selector") {
                nested.push(item);
                continue;
            }
            const selector: Selector = clone(item) as Selector;
            let hasNesting: boolean = false;
            walk(selector, (node: CssNode) => {
                hasNesting = hasNesting || node.type === "NestingSelector";
            });
            if (hasNesting) {
                walk(selector, {
                    visit: "NestingSelector",
                    enter: (node: CssNode, listItem: ListItem<CssNode>, siblings: List<CssNode>) => {
                        siblings.replace(listItem, siblings.createItem(this.isOf(parent)));
                    }
                });
            } else {
                const first: CssNode | null = selector.children.first;
                if (first === null || first.type !== "Combinator") {
                    selector.children.prependData({ type: "Combinator", name: " " });
                }
                selector.children.prependData(this.isOf(parent));
            }
            nested.push(selector);
        }
        return { type: "SelectorList", children: new List<CssNode>().fromArray(nested) } as SelectorList;
    }

    private isOf(parent: SelectorList): CssNode {
        return { type: "PseudoClassSelector", name: "is", children: new List<CssNode>().fromArray([clone(parent)]) } as CssNode;
    }

    private readPage(atrule: Atrule, context: Context): void {
        // CSS Paged Media 3 §4.3: @page <page-selector-list>? { ... }; an invalid page selector invalidates the whole @page rule.
        const selectors: Array<PageSelector> = [];
        const prelude: CssNode | null = atrule.prelude !== null && atrule.prelude.type === "AtrulePrelude" ? atrule.prelude.children.first : null;
        if (prelude !== null) {
            if (prelude.type !== "SelectorList") {
                return;
            }
            for (const selector of prelude.children) {
                const pageSelector: PageSelector | undefined = selector.type === "Selector" ? this.pageSelector(selector) : undefined;
                if (pageSelector === undefined) {
                    return;
                }
                selectors.push(pageSelector);
            }
        }
        const declarations: Array<Declaration> = [];
        const marginRules: Array<MarginRule> = [];
        const footnote: Array<Declaration> = [];
        const items: Array<CssNode> | undefined = atrule.block === null ? undefined : this.blockItems(atrule.block);
        for (let index: number = 0; items !== undefined && index < items.length; index++) {
            const child: CssNode = items[index];
            if (child.type === "Declaration") {
                const read: Array<Declaration> | undefined = this.declarations.readDescriptor("page", child, context.baseUrl) ?? this.declarations.read(child, context.baseUrl, context.namespaces);
                if (read !== undefined && read.length > 0) {
                    declarations.push(...read.filter((declaration: Declaration) => !(context.pageSizeConditional && declaration.property === "size")));
                } else {
                    this.reportInvalid(child);
                }
                continue;
            }
            if (child.type !== "Atrule" || child.block === null) {
                continue;
            }
            const name: string = this.asciiCase.foldLower(child.name);
            if (MARGIN_BOXES.has(name)) {
                marginRules.push({ name: name as MarginBoxName, declarations: this.blockDeclarations(child.block, context) });
            } else if (name === FOOTNOTE_RULE) {
                // GCPM 3 §2.4: the footnote area "is described in the page context using an @footnote rule"; the rules of one
                // page rule apply in order, so their declarations follow each other.
                footnote.push(...this.blockDeclarations(child.block, context));
            }
        }
        this.pageRules.push({ selectors, declarations, marginRules, footnote, layer: context.layer, order: this.order++ });
    }

    private blockDeclarations(block: Block, context: Context): Array<Declaration> {
        const declarations: Array<Declaration> = [];
        for (const item of this.blockItems(block)) {
            const read: Array<Declaration> | undefined = item.type === "Declaration" ? this.declarations.read(item, context.baseUrl, context.namespaces) : undefined;
            if (read !== undefined) {
                declarations.push(...read);
            } else if (item.type === "Declaration") {
                this.reportInvalid(item);
            }
        }
        return declarations;
    }

    private reportInvalid(declaration: CssTreeDeclaration): void {
        if (this.declarations.ignores(declaration)) {
            return;
        }
        const value: string = (declaration.value.type === "Raw" ? declaration.value.value : generate(declaration.value)).trim();
        const message: string = "The declaration " + declaration.property + ": " + value + (declaration.important !== false ? " !important" : "") + " is not valid, so it is ignored";
        if (!this.diagnostics.includes(message)) {
            this.diagnostics.push(message);
        }
    }

    private pageSelector(selector: Selector): PageSelector | undefined {
        // CSS Paged Media 3 §4.4: a page name counts first in the specificity, :first and :blank second, :left and :right third;
        // GCPM 3 §3.1 gives :nth() no specificity.
        let name: string | undefined;
        const pseudoClasses: Array<PagePseudoClass> = [];
        const nth: Array<PageNth> = [];
        const specificity: [number, number, number] = [0, 0, 0];
        for (const component of selector.children) {
            if (component.type === "TypeSelector" && component.name !== "*" && name === undefined && pseudoClasses.length === 0 && nth.length === 0) {
                name = this.escaping.unescape(component.name);
                specificity[0]++;
            } else if (component.type === "PseudoClassSelector") {
                const pseudo: string = this.asciiCase.foldLower(component.name);
                if (pseudo === "nth") {
                    const argument: CssNode | null = component.children === null ? null : component.children.first;
                    const parsed: PageNth | undefined = argument !== null && argument.type === "Raw" ? this.pageNth(argument.value) : undefined;
                    if (parsed === undefined) {
                        return undefined;
                    }
                    nth.push(parsed);
                } else if (component.children === null && PAGE_PSEUDO_CLASSES.has(pseudo)) {
                    pseudoClasses.push(pseudo as PagePseudoClass);
                    specificity[pseudo === "left" || pseudo === "right" ? 2 : 1]++;
                } else {
                    return undefined;
                }
            } else {
                return undefined;
            }
        }
        return name === undefined ? { pseudoClasses, nth, specificity } : { name, pseudoClasses, nth, specificity };
    }

    private pageNth(text: string): PageNth | undefined {
        // GCPM 3 §3.1: :nth( An+B [of <custom-ident>]? ).
        const match: RegExpExecArray | null = /^(.*?)(?:\s+of\s+(\S+))?\s*$/is.exec(text.trim());
        if (match === null) {
            return undefined;
        }
        const expression: AnPlusB | undefined = this.anPlusB.parse(match[1]);
        if (expression === undefined) {
            return undefined;
        }
        return match[2] === undefined ? { expression } : { expression, group: this.escaping.unescape(match[2]) };
    }

    fontFace(atrule: Atrule, baseUrl: string): FontFaceRule | undefined {
        this.readFontFace(atrule, baseUrl);
        return this.fontFaces.pop();
    }

    fontFeatureValuesRule(atrule: Atrule): FontFeatureValuesRule | undefined {
        this.readFontFeatureValues(atrule);
        return this.fontFeatureValues.pop();
    }

    propertyRule(atrule: Atrule): PropertyRule | undefined {
        this.readProperty(atrule);
        return this.properties.pop();
    }

    functionRule(atrule: Atrule, baseUrl: string, namespaces: Map<string, string>): FunctionRule | undefined {
        this.readFunction(atrule, { baseUrl, namespaces, layer: UNLAYERED, pageSizeConditional: false, containers: [] });
        return this.functions.pop()?.rule;
    }

    fontPaletteValues(atrule: Atrule, baseUrl: string, namespaces: Map<string, string>): DescriptorRule | undefined {
        this.readDescriptorRule("font-palette-values", atrule, { baseUrl, namespaces, layer: UNLAYERED, pageSizeConditional: false, containers: [] });
        return this.fontPalettes.pop();
    }

    private readFontFace(atrule: Atrule, baseUrl: string): void {
        // CSS Fonts 4 §4.1: a @font-face rule without a valid font-family and src is ignored.
        let family: string | undefined;
        let sources: Array<FontFaceSource> | undefined;
        const descriptors: Record<string, CssValue> = {};
        if (atrule.block === null) {
            return;
        }
        for (const child of this.blockItems(atrule.block)) {
            if (child.type !== "Declaration" || child.value.type !== "Value") {
                continue;
            }
            const name: string = this.table.descriptorName("font-face", this.asciiCase.foldLower(child.property));
            if (name === "src") {
                // CSS Fonts 4 §4.1: of several src descriptors the last valid one counts.
                const list: Array<FontFaceSource> = this.fontSources(child.value.children.toArray(), baseUrl);
                sources = list.length > 0 ? list : sources;
                continue;
            }
            if (!this.table.matchesDescriptor("font-face", name, child.value)) {
                continue;
            }
            if (name === "font-family") {
                family = this.familyName(child.value.children.toArray());
                continue;
            }
            const value: CssValue | undefined = this.values.parse(child.value);
            if (value !== undefined) {
                descriptors[name] = value;
            }
        }
        if (family !== undefined && sources !== undefined) {
            this.fontFaces.push({ kind: "font-face", family, sources, descriptors, order: this.order++ });
        }
    }

    private fontSources(nodes: ReadonlyArray<CssNode>, baseUrl: string): Array<FontFaceSource> {
        // CSS Fonts 4 §4.3.1 and CSS Fonts 5 §4.2.1: only entries that parse and whose format and techs are supported are kept;
        // with none left, the src descriptor is a parse error.
        const sources: Array<FontFaceSource> = [];
        for (const entry of this.splitNodes(nodes, ",")) {
            const source: FontFaceSource | undefined = this.fontSource(entry, baseUrl);
            if (source !== undefined) {
                sources.push(source);
            }
        }
        return sources;
    }

    private fontSource(entry: ReadonlyArray<CssNode>, baseUrl: string): FontFaceSource | undefined {
        const first: CssNode | undefined = entry[0];
        if (first === undefined) {
            return undefined;
        }
        if (first.type === "Function" && this.asciiCase.foldLower(first.name) === "local") {
            const name: string | undefined = this.familyName(first.children.toArray());
            return entry.length === 1 && name !== undefined ? { kind: "local", location: name } : undefined;
        }
        const location: string | undefined = first.type === "Url" ? first.value
            : (first.type === "Function" && this.asciiCase.foldLower(first.name) === "url" && first.children.first?.type === "String" ? first.children.first.value : undefined);
        if (location === undefined) {
            return undefined;
        }
        // <url> [ format( <font-format> ) ]? [ tech( <font-tech># ) ]?, in that order.
        let format: string | undefined;
        const technologies: Array<string> = [];
        let index: number = 1;
        let next: CssNode | undefined = entry[index];
        if (next !== undefined && next.type === "Function" && this.asciiCase.foldLower(next.name) === "format") {
            const items: Array<CssNode> = next.children.toArray().filter((item: CssNode) => item.type !== "WhiteSpace");
            const item: CssNode | undefined = items.length === 1 ? items[0] : undefined;
            if (item !== undefined && item.type === "String") {
                // CSS Fonts 4 §4.3.1: a format string stands for its keyword, and "<format>-variations" also adds tech(variations).
                const variations: boolean = item.value.endsWith(VARIATIONS_SUFFIX) && FORMAT_STRINGS.has(item.value.substring(0, item.value.length - VARIATIONS_SUFFIX.length))
                    && item.value !== "collection" + VARIATIONS_SUFFIX;
                format = variations ? item.value.substring(0, item.value.length - VARIATIONS_SUFFIX.length) : (FORMAT_STRINGS.has(item.value) ? item.value : undefined);
                if (variations) {
                    technologies.push("variations");
                }
            } else if (item !== undefined && item.type === "Identifier" && FONT_FORMATS.has(this.asciiCase.foldLower(item.name))) {
                format = this.asciiCase.foldLower(item.name);
            }
            if (format === undefined) {
                return undefined;
            }
            next = entry[++index];
        }
        if (next !== undefined && next.type === "Function" && this.asciiCase.foldLower(next.name) === "tech") {
            for (const group of this.splitNodes(next.children.toArray().filter((item: CssNode) => item.type !== "WhiteSpace"), ",")) {
                const technology: string | undefined = group.length === 1 && group[0].type === "Identifier" ? this.asciiCase.foldLower(group[0].name) : undefined;
                if (technology === undefined || !FONT_TECHNOLOGIES.has(technology)) {
                    return undefined;
                }
                technologies.push(technology);
            }
            next = entry[++index];
        }
        if (next !== undefined || (format !== undefined && !this.fontSupport.format(format))
            || !technologies.every((technology: string) => this.fontSupport.technology(technology))) {
            return undefined;
        }
        // A relative URL has nothing to resolve against in a sheet of an image given as a data URL.
        const resolved: string | undefined = BaseUrls.resolved(location, baseUrl);
        if (resolved === undefined) {
            this.diagnostics.push("Cannot read the font " + location + " named by " + baseUrl);
            return undefined;
        }
        const source: FontFaceSource = { kind: "url", location: resolved };
        if (format !== undefined) {
            source.format = format;
        }
        if (technologies.length > 0) {
            source.technologies = technologies;
        }
        return source;
    }

    private familyName(nodes: ReadonlyArray<CssNode>): string | undefined {
        // CSS Fonts 4 §2.1.1: a family name is a string or a sequence of identifiers joined by single spaces.
        if (nodes.length === 1 && nodes[0].type === "String") {
            return nodes[0].value;
        }
        if (nodes.length === 0 || !nodes.every((node: CssNode) => node.type === "Identifier")) {
            return undefined;
        }
        return nodes.map((node: CssNode) => this.escaping.unescape((node as { name: string }).name)).join(" ");
    }

    private readFontFeatureValues(atrule: Atrule): void {
        // CSS Fonts 4 §6.9.1: a list of named families, then feature value blocks mapping names to non-negative integers.
        if (atrule.prelude === null || atrule.prelude.type !== "AtrulePrelude") {
            return;
        }
        const prelude: Array<CssNode> = atrule.prelude.children.toArray();
        const families: Array<string> = [];
        for (const group of this.splitNodes(prelude, ",")) {
            const family: string | undefined = this.familyName(group);
            if (family === undefined || (group.length === 1 && group[0].type === "Identifier" && FontCatalog.GENERIC_FAMILIES.has(this.asciiCase.foldLower(family)))) {
                return;
            }
            families.push(family);
        }
        if (families.length === 0 || atrule.block === null) {
            return;
        }
        const features: Record<string, Record<string, Array<number>>> = {};
        for (const child of this.blockItems(atrule.block)) {
            if (child.type === "Atrule" && FEATURE_BLOCKS.has(this.asciiCase.foldLower(child.name)) && child.block !== null) {
                const type: string = this.asciiCase.foldLower(child.name);
                const block: Record<string, Array<number>> = features[type] ?? {};
                for (const item of this.blockItems(child.block)) {
                    const indexes: Array<number> | undefined = item.type === "Declaration" ? this.featureIndexes(type, item) : undefined;
                    if (item.type === "Declaration" && indexes !== undefined) {
                        block[item.property] = indexes;
                    }
                }
                features[type] = block;
            }
        }
        this.fontFeatureValues.push({ kind: "font-feature-values", families, features, order: this.order++ });
    }

    private featureIndexes(type: string, declaration: CssTreeDeclaration): Array<number> | undefined {
        // CSS Fonts 4 §6.9.1 and §6.9.2: one index for @annotation, @ornaments, @stylistic and @swash, one or two for
        // @character-variant, one or more for @styleset and @historical-forms; an index out of range is not a syntax error.
        if (declaration.value.type !== "Value") {
            return undefined;
        }
        const nodes: Array<CssNode> = declaration.value.children.toArray();
        if (nodes.length === 0 || !nodes.every((node: CssNode) => node.type === "Number" && /^\d+$/.test(node.value))) {
            return undefined;
        }
        const indexes: Array<number> = nodes.map((node: CssNode) => Number((node as { value: string }).value));
        switch (type) {
            case "character-variant":
                return indexes.length <= 2 ? indexes : undefined;
            case "styleset":
            case "historical-forms":
                return indexes;
            default:
                return indexes.length === 1 ? indexes : undefined;
        }
    }

    private readDescriptorRule(kind: "font-palette-values" | "color-profile", atrule: Atrule, context: Context): void {
        // CSS Fonts 4 §9.2 and CSS Color 5 §5.3: a dashed-ident name (or device-cmyk for a color profile) and descriptors;
        // @font-palette-values descriptors may use var() and env(), and the rule is ignored without a font-family.
        const first: CssNode | null = atrule.prelude !== null && atrule.prelude.type === "AtrulePrelude" ? atrule.prelude.children.first : null;
        const name: string | undefined = first !== null && first.type === "Identifier" ? first.name : undefined;
        if (name === undefined || atrule.block === null || !(name.startsWith("--") || (kind === "color-profile" && this.asciiCase.foldLower(name) === "device-cmyk"))) {
            return;
        }
        const descriptors: Record<string, DeclaredValue> = {};
        for (const child of this.blockItems(atrule.block)) {
            if (child.type !== "Declaration") {
                continue;
            }
            const value: DeclaredValue | undefined = this.declarations.descriptorValue(kind, child, context.baseUrl, context.namespaces, kind === "font-palette-values");
            const descriptor: string = this.table.descriptorName(kind, this.asciiCase.foldLower(child.property));
            if (kind === "font-palette-values" && descriptor === "override-colors" && value?.kind === "value" && !this.colors.isAbsolute(value.value)) {
                // CSS Fonts 4 §9.2.3: "Each specified <color> must be an absolute color, otherwise the descriptor is invalid."
                continue;
            }
            if (value !== undefined) {
                descriptors[descriptor] = value;
            }
        }
        if (kind === "font-palette-values" && descriptors["font-family"] === undefined) {
            return;
        }
        (kind === "font-palette-values" ? this.fontPalettes : this.colorProfiles).push({ kind, name, descriptors, order: this.order++ });
    }

    private readPositionTry(atrule: Atrule, context: Context): void {
        // CSS Anchor Positioning 1 §6.4: only the inset, margin, sizing and self-alignment properties, position-anchor and
        // position-area, and never !important.
        const first: CssNode | null = atrule.prelude !== null && atrule.prelude.type === "AtrulePrelude" ? atrule.prelude.children.first : null;
        if (first === null || first.type !== "Identifier" || !first.name.startsWith("--") || atrule.block === null) {
            return;
        }
        const declarations: Array<Declaration> = [];
        for (const child of this.blockItems(atrule.block)) {
            if (child.type !== "Declaration") {
                continue;
            }
            const read: Array<Declaration> | undefined = child.important !== false ? undefined : this.declarations.read(child, context.baseUrl, context.namespaces);
            if (read !== undefined && read.every((declaration: Declaration) => POSITION_TRY_PROPERTIES.test(declaration.property))) {
                declarations.push(...read);
            } else {
                this.reportInvalid(child);
            }
        }
        this.positionTries.push({ rule: { kind: "position-try", name: first.name, declarations, layer: 0, order: this.order++ }, layer: context.layer });
    }

    private readFunction(atrule: Atrule, context: Context): void {
        // CSS Functions and Mixins §2.1: @function <function-token> <function-parameter>#? ) [ returns <css-type> ]? { ... },
        // where a parameter is a custom property name, an optional type and an optional default value.
        const text: string = this.preludeText(atrule).trim();
        const open: number = text.indexOf("(");
        const close: number = this.matchingParenthesis(text, open);
        if (open === -1 || close === -1 || !text.startsWith("--") || atrule.block === null) {
            return;
        }
        const name: string = text.substring(0, open);
        if (/\s/.test(name)) {
            return;
        }
        const parameters: Array<FunctionParameter> = [];
        for (const part of this.splitTopLevel(text.substring(open + 1, close), ",").filter((item: string) => item.trim().length > 0)) {
            const parameter: FunctionParameter | undefined = this.functionParameter(part.trim());
            if (parameter === undefined || parameters.some((known: FunctionParameter) => known.name === parameter.name)) {
                return;
            }
            parameters.push(parameter);
        }
        const rest: RegExpExecArray | null = /^\s*(?:returns\s+([\s\S]+))?$/i.exec(text.substring(close + 1));
        const returnType: string | undefined = rest === null ? undefined : (rest[1] === undefined ? "*" : this.cssType(rest[1].trim()));
        if (returnType === undefined) {
            return;
        }
        const body: Array<FunctionDescriptor> = [];
        const nodes: Array<CssNode> | undefined = this.functionBody(atrule.block);
        if (nodes !== undefined) {
            this.readFunctionBody(nodes, context, body);
        }
        this.functions.push({
            rule: { kind: "function", name, parameters, returnType, body, baseUrl: context.baseUrl, namespaces: context.namespaces, layer: 0, order: this.order++ },
            layer: context.layer
        });
    }

    private functionBody(block: Block): Array<CssNode> | undefined {
        // The body comes parsed as a list of rules, which breaks its declarations, so it is read again as declarations.
        const text: string = generate(block);
        try {
            const parsed: CssNode = parse(text.substring(1, text.length - 1), { context: "declarationList" });
            return parsed.type === "DeclarationList" ? parsed.children.toArray() : undefined;
        } catch {
            return undefined;
        }
    }

    private readFunctionBody(nodes: ReadonlyArray<CssNode>, context: Context, body: Array<FunctionDescriptor>): void {
        // CSS Functions and Mixins §2.1.2: the body holds the result descriptor, local custom properties and conditional group rules.
        const chain: Chain = { open: false, satisfied: false, negated: [] };
        for (const node of nodes) {
            if (node.type === "Atrule" && CONDITIONAL_RULES.has(this.asciiCase.foldLower(node.name))) {
                this.readConditional(node, context, chain, (inner: Context) => {
                    const nested: Array<CssNode> | undefined = node.block === null ? undefined : this.functionBody(node.block);
                    if (nested !== undefined) {
                        this.readFunctionBody(nested, inner, body);
                    }
                });
                continue;
            }
            chain.open = false;
            if (node.type === "Declaration" && (this.asciiCase.foldLower(node.property) === "result" || node.property.startsWith("--"))) {
                const text: string = (node.value.type === "Raw" ? node.value.value : generate(node.value)).trim();
                body.push({ name: node.property.startsWith("--") ? node.property : "result", text, containers: context.containers });
            }
        }
    }

    private functionParameter(text: string): FunctionParameter | undefined {
        const colon: number = this.splitTopLevel(text, ":")[0].length;
        const head: string = text.substring(0, colon).trim();
        const defaultValue: string | undefined = colon < text.length ? text.substring(colon + 1).trim() : undefined;
        const match: RegExpExecArray | null = /^(--[^\s]+)(?:\s+([\s\S]+))?$/.exec(head);
        if (match === null) {
            return undefined;
        }
        // CSS Functions and Mixins §2.1: <custom-property-name> <css-type>? [ : <declaration-value> ]?; the default value is
        // checked against the type only when the function is evaluated (§3.1).
        const type: string | undefined = match[2] === undefined ? SyntaxDefinition.UNIVERSAL : this.cssType(match[2].trim());
        if (type === undefined || (defaultValue !== undefined && defaultValue.length === 0)) {
            return undefined;
        }
        return defaultValue === undefined ? { name: match[1], type } : { name: match[1], type, defaultValue };
    }

    private cssType(text: string): string | undefined {
        // CSS Functions and Mixins §2.1: <css-type> is a <syntax-component> or type( <syntax> ).
        const typed: RegExpExecArray | null = /^type\(([\s\S]*)\)$/i.exec(text);
        if (typed !== null) {
            return this.syntaxDefinition.parse(typed[1]);
        }
        const grammar: string | undefined = this.syntaxDefinition.parse(text);
        return grammar !== undefined && !grammar.includes("|") ? grammar : undefined;
    }

    private readCounterStyle(atrule: Atrule, context: Context): void {
        // CSS Counter Styles 3 §3: the name is a <custom-ident> (so not a CSS-wide keyword or default) other than none, and
        // other than the predefined styles that cannot be overridden.
        const first: CssNode | null = atrule.prelude !== null && atrule.prelude.type === "AtrulePrelude" ? atrule.prelude.children.first : null;
        if (first === null || first.type !== "Identifier" || atrule.block === null) {
            return;
        }
        const name: string = this.escaping.unescape(first.name);
        const lower: string = this.asciiCase.foldLower(name);
        if (FIXED_COUNTER_STYLES.has(lower) || DeclarationReader.CSS_WIDE_KEYWORDS.has(lower) || lower === "default") {
            return;
        }
        const descriptors: Record<string, CssValue> = {};
        for (const child of this.blockItems(atrule.block)) {
            if (child.type !== "Declaration" || child.value.type !== "Value") {
                continue;
            }
            const descriptor: string = this.table.descriptorName("counter-style", this.asciiCase.foldLower(child.property));
            if (!this.table.matchesDescriptor("counter-style", descriptor, child.value)) {
                continue;
            }
            const value: CssValue | undefined = this.values.parse(child.value);
            if (value !== undefined) {
                descriptors[descriptor] = value;
            }
        }
        // CSS Counter Styles 3 §3: rules of the same name win by the standard cascade rules, layers included.
        this.counterStyles.push({ rule: { kind: "counter-style", name, descriptors, layer: 0, order: this.order++ }, layer: context.layer });
    }

    private readProperty(atrule: Atrule): void {
        // CSS Properties and Values 1 §3: syntax and inherits are required, and initial-value unless the syntax is "*";
        // an initial value must match the syntax and be computationally independent.
        const first: CssNode | null = atrule.prelude !== null && atrule.prelude.type === "AtrulePrelude" ? atrule.prelude.children.first : null;
        if (first === null || first.type !== "Identifier" || !first.name.startsWith("--") || atrule.block === null) {
            return;
        }
        // §3.1: a syntax string that is not a valid syntax definition makes that descriptor invalid and ignored.
        let grammar: string | undefined;
        let inherits: boolean | undefined;
        let initial: string | undefined;
        for (const child of this.blockItems(atrule.block)) {
            if (child.type !== "Declaration") {
                continue;
            }
            const descriptor: string = this.asciiCase.foldLower(child.property);
            const value: CssNode | null = child.value.type === "Value" ? child.value.children.first : null;
            if (descriptor === "syntax" && value !== null && value.type === "String" && child.value.type === "Value" && child.value.children.size === 1) {
                grammar = this.syntaxDefinition.parse(value.value) ?? grammar;
            } else if (descriptor === "inherits" && value !== null && value.type === "Identifier" && ["true", "false"].includes(this.asciiCase.foldLower(value.name))) {
                inherits = this.asciiCase.foldLower(value.name) === "true";
            } else if (descriptor === "initial-value") {
                initial = (child.value.type === "Raw" ? child.value.value : generate(child.value)).trim();
            }
        }
        if (inherits === undefined || grammar === undefined) {
            return;
        }
        if (grammar !== SyntaxDefinition.UNIVERSAL && (initial === undefined || !this.matchesSyntax(grammar, initial) || !this.computationallyIndependent(initial))) {
            return;
        }
        const registered: PropertyRule = { kind: "property", name: first.name, syntax: grammar, inherits, order: this.order++ };
        if (initial !== undefined) {
            registered.initialValue = initial;
        }
        this.properties.push(registered);
    }

    private matchesSyntax(grammar: string, value: string): boolean {
        try {
            return this.table.lexer.match(grammar, value).matched !== null;
        } catch {
            return false;
        }
    }

    private computationallyIndependent(value: string): boolean {
        // CSS Properties and Values 1 §4.1: a value computes with only "global" information that CSS cannot change, so not with
        // relative units or an arbitrary substitution function that reads the element; env() reads only global values.
        let independent: boolean = true;
        for (const token of this.substitutionSyntax.tokens(value)) {
            if (token.type === tokenTypes.Dimension) {
                const unit: string = this.asciiCase.foldLower(token.text.replace(/^[+-]?(?:\d*\.)?\d+(?:e[+-]?\d+)?/i, ""));
                independent = independent && !RELATIVE_UNITS.has(unit);
            } else if (this.substitutionSyntax.isSubstitution(token)) {
                independent = independent && this.substitutionSyntax.functionName(token) === "env";
            }
        }
        return independent;
    }

    private mediaQueryList(atrule: Atrule): MediaQueryList | null {
        if (atrule.prelude === null) {
            return null;
        }
        if (atrule.prelude.type === "Raw") {
            // Media Queries 5 §3.2: a bad query is replaced by not all at the next top-level comma, and the others still count.
            const kept: Array<string> = this.splitTopLevel(atrule.prelude.value, ",").filter((part: string) => this.mediaListOf(part) !== null);
            return this.mediaListOf(kept.length === 0 ? "not all" : kept.join(","));
        }
        const first: CssNode | null = atrule.prelude.children.first;
        return first !== null && first.type === "MediaQueryList" ? first : null;
    }

    private mediaListOf(text: string): MediaQueryList | null {
        try {
            const list: CssNode = parse(text, { context: "mediaQueryList" });
            return list.type === "MediaQueryList" ? list : null;
        } catch {
            return null;
        }
    }

    private preludeText(atrule: Atrule): string {
        if (atrule.prelude === null) {
            return "";
        }
        return atrule.prelude.type === "Raw" ? atrule.prelude.value : generate(atrule.prelude);
    }

    private splitNodes(nodes: ReadonlyArray<CssNode>, separator: string): Array<Array<CssNode>> {
        const groups: Array<Array<CssNode>> = [[]];
        for (const node of nodes) {
            if (node.type === "Operator" && node.value === separator) {
                groups.push([]);
            } else {
                groups[groups.length - 1].push(node);
            }
        }
        return groups;
    }

    private splitTopLevel(text: string, separator: string): Array<string> {
        const parts: Array<string> = [];
        let depth: number = 0;
        let start: number = 0;
        tokenize(text, (type: number, tokenStart: number, tokenEnd: number) => {
            if (type === tokenTypes.LeftParenthesis || type === tokenTypes.LeftSquareBracket || type === tokenTypes.LeftCurlyBracket || type === tokenTypes.Function) {
                depth++;
            } else if (type === tokenTypes.RightParenthesis || type === tokenTypes.RightSquareBracket || type === tokenTypes.RightCurlyBracket) {
                depth--;
            } else if (depth === 0 && text.substring(tokenStart, tokenEnd) === separator) {
                parts.push(text.substring(start, tokenStart));
                start = tokenEnd;
            }
        });
        parts.push(text.substring(start));
        return parts;
    }

    private matchingParenthesis(text: string, open: number): number {
        // Read as tokens, since a parenthesis inside a string or a comment does not count.
        let depth: number = 0;
        let found: number = -1;
        if (open === -1) {
            return found;
        }
        tokenize(text, (type: number, start: number, end: number) => {
            if (found !== -1 || end <= open) {
                return;
            }
            if (type === tokenTypes.LeftParenthesis || type === tokenTypes.Function) {
                depth++;
            } else if (type === tokenTypes.RightParenthesis && --depth === 0) {
                found = start;
            }
        });
        return found;
    }

    private sheet(url: string): StyleSheet | undefined {
        let sheet: StyleSheet | undefined = this.sheets.get(url);
        if (sheet === undefined && this.unread?.has(url) !== true) {
            const text: string | undefined = this.fetch(url);
            if (text === undefined) {
                this.unread = this.unread ?? new Set<string>();
                this.unread.add(url);
            } else {
                sheet = parse(text) as StyleSheet;
                this.sheets.set(url, sheet);
            }
        }
        return sheet;
    }

    private fetch(url: string): string | undefined {
        if (url.startsWith("file:")) {
            const path: string = fileURLToPath(url);
            return existsSync(path) ? this.readFile(path) : undefined;
        }
        const bytes: Buffer | undefined = this.remote.retrieveBytes(url);
        if (bytes === undefined) {
            return undefined;
        }
        const folder: string = mkdtempSync(join(tmpdir(), "cssmedia-"));
        try {
            const path: string = join(folder, "stylesheet.css");
            writeFileSync(path, bytes);
            return this.readFile(path);
        } finally {
            rmSync(folder, { recursive: true, force: true });
        }
    }

    private readFile(path: string): string {
        // CSS Syntax 3 §3.2: without a byte order mark, an @charset rule at the very start gives the fallback encoding;
        // a UTF-16 label or an unknown one gives none. A byte order mark stays in the text, and the tokenizer skips it.
        const text: string = readFileSync(path, FileReader.detectEncoding(path));
        const charset: RegExpExecArray | null = /^@charset "([\x00-\x21\x23-\x7F]*)";/.exec(text);
        const label: string | undefined = charset === null ? undefined : charset[1].toLowerCase();
        if (label === undefined || label === "utf-16be" || label === "utf-16le") {
            return text;
        }
        try {
            return new TextDecoder(label).decode(readFileSync(path));
        } catch {
            return text;
        }
    }

    private result(): Stylesheet {
        const ranks: Map<string, number> = this.layerRanks();
        return {
            styleRules: this.styleRules.map((rule: PendingStyleRule): StyleRule => {
                const style: StyleRule = {
                    kind: "style", selectors: rule.selectors, declarations: rule.declarations, containers: rule.containers,
                    layer: ranks.get(rule.layer) as number, order: rule.order
                };
                if (rule.scope !== undefined) {
                    style.scope = rule.scope;
                }
                return style;
            }),
            pageRules: this.pageRules.map((rule: PendingPageRule): PageRule => ({
                kind: "page", selectors: rule.selectors, declarations: rule.declarations, marginRules: rule.marginRules, footnote: rule.footnote,
                layer: ranks.get(rule.layer) as number, order: rule.order
            })),
            fontFaces: this.fontFaces,
            fontFeatureValues: this.fontFeatureValues,
            fontPalettes: this.fontPalettes,
            colorProfiles: this.colorProfiles,
            counterStyles: this.counterStyles.map((pending: PendingLayered<CounterStyleRule>): CounterStyleRule => ({ ...pending.rule, layer: ranks.get(pending.layer) as number })),
            properties: this.properties,
            positionTries: this.positionTries.map((pending: PendingLayered<PositionTryRule>): PositionTryRule => ({ ...pending.rule, layer: ranks.get(pending.layer) as number })),
            functions: this.functions.map((pending: PendingLayered<FunctionRule>): FunctionRule => ({ ...pending.rule, layer: ranks.get(pending.layer) as number })),
            customMedia: this.customMedia,
            supportsConditions: this.supports.definitions(),
            tocRules: this.tocRules,
            layers: [...ranks.keys()].map((key: string): readonly [string, ReadonlyArray<string>] => [key, (this.layers.get(key) as LayerNode).children]),
            diagnostics: this.diagnostics
        };
    }

    private layerRanks(): Map<string, number> {
        // CSS Cascade 5 §6.4.3: layers rank in the order they are first declared, a layer's sublayers before its own
        // declarations, and the declarations outside every layer last.
        const ranks: Map<string, number> = new Map<string, number>();
        const visit: (key: string) => void = (key: string): void => {
            for (const child of (this.layers.get(key) as LayerNode).children) {
                visit(child);
            }
            ranks.set(key, ranks.size);
        };
        visit(UNLAYERED);
        return ranks;
    }
}
