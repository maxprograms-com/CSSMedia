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

import type { CssNode, DSNode, Lexer, LexerMatchResult, SyntaxConfig } from "css-tree";
import { lexer as defaultLexer, definitionSyntax, fork, tokenTypes } from "css-tree";
import type { CssDescriptorDefinition, CssPropertyDefinition } from "./generated/CssDefinitions.js";
import { CSS_AT_RULES, CSS_DESCRIPTOR_ALIASES, CSS_DESCRIPTORS, CSS_PROPERTIES, CSS_PROPERTY_ALIASES, CSS_TYPES } from "./generated/CssDefinitions.js";
import { ColorKeywords } from "./values/ColorKeywords.js";
import { ColorParser } from "./values/ColorParser.js";
import { ColorSpaces } from "./values/ColorSpaces.js";

export interface PropertyDefinition {
    grammar: string;
    initial?: string;
    inherited: boolean;
    logicalPropertyGroup?: string;
    spec: string;
}

export interface DescriptorDefinition {
    initial?: string;
}

export interface DefinitionOverlay {
    properties: ReadonlyArray<CssPropertyDefinition>;
    types: ReadonlyArray<readonly [string, string]>;
    shorthands: ReadonlyArray<readonly [string, ReadonlyArray<string>]>;
}

interface SharedTables {
    properties: Map<string, PropertyDefinition>;
    descriptors: Map<string, DescriptorDefinition>;
    lexer: Lexer;
    shorthands: ReadonlyMap<string, ReadonlyArray<string>>;
}

const URL_TYPES: Readonly<Record<string, string>> = { "url": "<url-token> | <src()>" };

const LEGACY_TYPES: Readonly<Record<string, string>> = { "uri": "<url>" };

const SIZING_TYPES: Readonly<Record<string, string>> = {
    "box-size": "<length-percentage> | stretch | contain | min-content | max-content | fit-content | <fit-content()> | <calc-size()>",
    "intrinsic-size-keyword": "auto | min-content | max-content | fit-content | stretch | contain",
    "calc-size()": "calc-size( <calc-size-basis> , <calc-size-sum> )",
    "calc-size-sum": "<calc-size-product> [ [ '+' | '-' ] <calc-size-product> ]*",
    "calc-size-product": "<calc-size-value> [ [ '*' | '/' ] <calc-size-value> ]*",
    "calc-size-value": "size | <number> | <dimension> | <percentage> | e | pi | infinity | -infinity | NaN | ( <calc-size-sum> )",
    "maximum-box-size": "<length-percentage> | stretch | contain | min-content | max-content | fit-content | <fit-content()> | <maximum-calc-size()>",
    "maximum-calc-size()": "calc-size( <maximum-calc-size-basis> , <calc-size-sum> )",
    "maximum-calc-size-basis": "min-content | max-content | fit-content | stretch | contain | <maximum-calc-size()> | any | <calc-sum>"
};

const MAXIMUM_SIZES: ReadonlySet<string> = new Set<string>(["max-width", "max-height", "max-inline-size", "max-block-size"]);

const ORIGIN_COLOR: RegExp = /\[\s*from <color>\s*\]\??/;
const COLOR_PARAMETERS: string = "<colorspace-params>";
const DEPRECATED_COLOR: string = "deprecated-color";
const HDR_COLOR: string = "color-hdr()";
const UNKNOWN_SPACE: string = "unknown-color-space";
const UNKNOWN_SPACE_PARAMETERS: string = "<" + UNKNOWN_SPACE + "> [ <number> | <percentage> | none ]+";

export class PropertyTable {

    static readonly PREFIX: string = "-cssmedia-";
    static readonly LINK: string = PropertyTable.PREFIX + "link";
    static readonly LINK_COUNTER: string = PropertyTable.PREFIX + "link-counter";
    static readonly TOC: string = PropertyTable.PREFIX + "toc";
    static readonly TOC_TITLE: string = PropertyTable.PREFIX + "toc-title";
    static readonly TOC_ENTRY: string = PropertyTable.PREFIX + "toc-entry";
    static readonly TOC_DIVIDER: string = PropertyTable.PREFIX + "toc-divider";
    static readonly TOC_DEPTH: string = PropertyTable.PREFIX + "toc-depth";
    static readonly TOC_LABEL: string = PropertyTable.PREFIX + "toc-label";
    static readonly TOC_LEADER: string = PropertyTable.PREFIX + "toc-leader";

    private static readonly CSSMEDIA_TYPES: Readonly<Record<string, string>> = {
        "target": "<target-counter()> | <target-counters()> | <target-text()> | <" + PropertyTable.LINK_COUNTER + "()>",
        [PropertyTable.LINK_COUNTER + "()"]: PropertyTable.LINK_COUNTER + "( <custom-ident> , <counter-style>? )"
    };

    private static readonly CSSMEDIA_PROPERTIES: ReadonlyArray<CssPropertyDefinition> = [
        {
            name: PropertyTable.LINK, value: "none | [ <string> | <url> ]+", initial: "none", appliesTo: "all elements and pseudo-elements", inherited: "no",
            percentages: "N/A", computedValue: "as specified", spec: "cssmedia"
        },
        {
            name: "zoom", value: "<number [0,∞]> | <percentage [0,∞]>", initial: "1", appliesTo: "all <length> property values of all elements", inherited: "no",
            percentages: "Converted to <number>", computedValue: "as specified, but with <percentage> converted to the equivalent <number>", spec: "css-viewport-1"
        },
        {
            name: "content", value: "normal | none | [ <content-replacement> | <content-list> ] [/ [ <string> | <counter> | <attr()> ]+ ]? | <element()> | " + PropertyTable.TOC + "()",
            initial: "normal", appliesTo: "all elements, tree-abiding pseudo-elements, and page margin boxes", inherited: "no", percentages: "n/a",
            computedValue: "See prose below", spec: "cssmedia"
        },
        {
            name: PropertyTable.TOC_TITLE, value: "none | <content-list>", initial: "none", appliesTo: "elements and pseudo-elements whose content is " + PropertyTable.TOC + "()",
            inherited: "no", percentages: "N/A", computedValue: "specified value", spec: "cssmedia"
        },
        {
            name: PropertyTable.TOC_DEPTH, value: "all | <integer [1,∞]>", initial: "all", appliesTo: "elements and pseudo-elements whose content is " + PropertyTable.TOC + "()",
            inherited: "no", percentages: "N/A", computedValue: "as specified", spec: "cssmedia"
        },
        {
            name: PropertyTable.TOC_LABEL, value: "auto | <content-list>", initial: "auto", appliesTo: "elements with a bookmark-level", inherited: "no", percentages: "N/A",
            computedValue: "specified value", spec: "cssmedia"
        },
        {
            name: PropertyTable.TOC_DIVIDER, value: "none | <content-list>", initial: "none", appliesTo: "elements with a bookmark-level", inherited: "no", percentages: "N/A",
            computedValue: "specified value", spec: "cssmedia"
        },
        {
            name: PropertyTable.TOC_LEADER, value: "<leader-type>", initial: "dotted", appliesTo: "table of contents entries", inherited: "no", percentages: "N/A",
            computedValue: "as specified", spec: "cssmedia"
        }
    ];

    private static readonly ALL_PROPERTIES: ReadonlyArray<CssPropertyDefinition> = [...CSS_PROPERTIES, ...PropertyTable.CSSMEDIA_PROPERTIES];

    private static readonly built: Map<DefinitionOverlay | undefined, SharedTables> = new Map<DefinitionOverlay | undefined, SharedTables>();

    private readonly properties: Map<string, PropertyDefinition>;
    private readonly descriptors: Map<string, DescriptorDefinition>;
    private readonly shorthands: ReadonlyMap<string, ReadonlyArray<string>>;
    private readonly aliases: Map<string, string> = new Map<string, string>(CSS_PROPERTY_ALIASES);
    private readonly descriptorAliases: Map<string, string> = new Map<string, string>(
        CSS_DESCRIPTOR_ALIASES.map(([atRule, name, target]: readonly [string, string, string]): [string, string] => [atRule + " " + name, target])
    );
    readonly lexer: Lexer;

    constructor(overlay?: DefinitionOverlay) {
        // The tables and the lexer are built once for each set of definitions and shared, since every stylesheet and element
        // reads them.
        let shared: SharedTables | undefined = PropertyTable.built.get(overlay);
        if (shared === undefined) {
            const replaced: (name: string) => boolean = (name: string): boolean => overlay !== undefined && overlay.properties.some((property: CssPropertyDefinition) => property.name === name);
            const properties: ReadonlyArray<CssPropertyDefinition> = overlay === undefined ? PropertyTable.ALL_PROPERTIES
                : [...PropertyTable.ALL_PROPERTIES.filter((property: CssPropertyDefinition) => !replaced(property.name)), ...overlay.properties];
            const types: ReadonlyArray<readonly [string, string]> = overlay === undefined ? CSS_TYPES
                : [...CSS_TYPES.filter(([name]: readonly [string, string]) => !overlay.types.some((type: readonly [string, string]) => type[0] === name)), ...overlay.types];
            shared = {
                properties: this.buildProperties(properties), descriptors: this.buildDescriptors(), lexer: this.buildLexer(properties, types),
                shorthands: new Map<string, ReadonlyArray<string>>(overlay?.shorthands ?? [])
            };
            PropertyTable.built.set(overlay, shared);
        }
        this.properties = shared.properties;
        this.descriptors = shared.descriptors;
        this.lexer = shared.lexer;
        this.shorthands = shared.shorthands;
    }

    sameValueShorthands(): ReadonlyMap<string, ReadonlyArray<string>> {
        return this.shorthands;
    }

    canonicalName(name: string): string {
        return this.aliases.get(name) ?? name;
    }

    definition(name: string): PropertyDefinition | undefined {
        return this.properties.get(this.canonicalName(name));
    }

    names(): IterableIterator<string> {
        return this.properties.keys();
    }

    descriptorName(atRule: string, name: string): string {
        const key: string = (atRule.startsWith("@") ? atRule : "@" + atRule) + " " + name;
        return this.descriptorAliases.get(key) ?? name;
    }

    descriptor(atRule: string, name: string): DescriptorDefinition | undefined {
        return this.descriptors.get(atRule + " " + this.descriptorName(atRule, name));
    }

    matchProperty(name: string, value: CssNode | string): LexerMatchResult | undefined {
        // A grammar that refers to a production no specification defines cannot be matched; the value then does not match.
        try {
            const result: LexerMatchResult = this.lexer.matchProperty(name, value);
            return result.matched === null ? undefined : result;
        } catch {
            return undefined;
        }
    }

    matchesDescriptor(atRule: string, name: string, value: CssNode | string): boolean {
        // The lexer keeps the descriptors built into css-tree, so the generated inventory decides which ones exist.
        const descriptor: string = this.descriptorName(atRule, name);
        if (!this.descriptors.has((atRule.startsWith("@") ? atRule : "@" + atRule) + " " + descriptor)) {
            return false;
        }
        try {
            return this.lexer.matchAtruleDescriptor(atRule, descriptor, value).matched !== null;
        } catch {
            return false;
        }
    }

    matchesType(type: string, value: CssNode | string): boolean {
        try {
            return this.lexer.matchType(type, value).matched !== null;
        } catch {
            return false;
        }
    }

    private buildProperties(sources: ReadonlyArray<CssPropertyDefinition>): Map<string, PropertyDefinition> {
        const properties: Map<string, PropertyDefinition> = new Map<string, PropertyDefinition>();
        for (const source of sources) {
            const definition: PropertyDefinition = {
                grammar: source.value,
                inherited: this.isInherited(source),
                spec: source.spec
            };
            if (source.initial !== undefined) {
                definition.initial = source.initial;
            }
            if (source.logicalPropertyGroup !== undefined) {
                definition.logicalPropertyGroup = source.logicalPropertyGroup;
            }
            properties.set(source.name, definition);
        }
        return properties;
    }

    private isInherited(source: CssPropertyDefinition): boolean {
        return /^yes/i.test(source.inherited ?? "");
    }

    private buildDescriptors(): Map<string, DescriptorDefinition> {
        const descriptors: Map<string, DescriptorDefinition> = new Map<string, DescriptorDefinition>();
        for (const source of CSS_DESCRIPTORS) {
            const descriptor: CssDescriptorDefinition = source;
            const definition: DescriptorDefinition = {};
            if (descriptor.initial !== undefined) {
                definition.initial = descriptor.initial;
            }
            descriptors.set(descriptor.atRule + " " + descriptor.name, definition);
        }
        return descriptors;
    }

    private buildLexer(sources: ReadonlyArray<CssPropertyDefinition>, typeSources: ReadonlyArray<readonly [string, string]>): Lexer {
        // The grammars of the published specifications replace the built-in ones, except where a spec grammar references a
        // production that no specification defines and a working built-in definition exists.
        const typeNames: Set<string> = new Set<string>([...typeSources.map(([name]: readonly [string, string]) => name.replace(/^<|>$/g, "")), ...Object.keys(LEGACY_TYPES),
            ...Object.keys(SIZING_TYPES), ...Object.keys(PropertyTable.CSSMEDIA_TYPES)]);
        const propertyNames: Set<string> = new Set<string>(sources.map((property: CssPropertyDefinition) => property.name));
        const isDefined: (node: DSNode) => boolean = (node: DSNode): boolean => {
            if (node.type === "Type") {
                return typeNames.has(node.name) || defaultLexer.getType(node.name) !== null;
            }
            if (node.type === "Property") {
                return propertyNames.has(node.name) || defaultLexer.getProperty(node.name) !== null;
            }
            return true;
        };
        const usable: (grammar: string, ownDefinitionExists: boolean) => boolean = (grammar: string, ownDefinitionExists: boolean): boolean => {
            const parsed: DSNode | undefined = this.parseGrammar(grammar);
            return parsed !== undefined && (!ownDefinitionExists || this.allReferencesDefined(parsed, isDefined));
        };
        // CSS 2.1 §4.3.4 names the url() type <uri>, and grammars copied from it still use that name.
        const types: Record<string, string> = { ...LEGACY_TYPES, ...URL_TYPES };
        for (const [typeName, grammar] of typeSources) {
            const name: string = typeName.replace(/^<|>$/g, "");
            // CSS Values 4 §4.5: <url> = <url()> | <src()>; a url() of any form is a url token here, which never matches
            // through the <url()> reference.
            if (URL_TYPES[name] === undefined && usable(grammar, defaultLexer.getType(name) !== null)) {
                types[name] = this.relativeGrammar(name, grammar, typeSources);
            }
        }
        // CSS Sizing 4 §3.2 names fit-content() and calc-size() in <box-size> without arguments; CSS Values 5 §10 gives
        // <intrinsic-size-keyword> and the size keyword of the calculation in prose only.
        Object.assign(types, SIZING_TYPES, PropertyTable.CSSMEDIA_TYPES);
        // CSS Color 4 Appendix A: <deprecated-color> is in no grammar line, and user agents "must map them" to system colors.
        types[DEPRECATED_COLOR] = ColorKeywords.deprecatedNames().join(" | ");
        types["color"] = types["color"] + " | <" + DEPRECATED_COLOR + ">";
        // The lexer finds a function among alternatives by the name of its type, and CSS Color HDR 1 §5 names them differently.
        types[HDR_COLOR] = types["hdr-color()"];
        types["color-function"] = types["color-function"].replace("<hdr-color()>", "<" + HDR_COLOR + ">");
        // A predefined name with the wrong number of components has to stay an invalid declaration, which a grammar cannot say.
        (types as Record<string, unknown>)[UNKNOWN_SPACE] = (token: { type: number; value: string } | null): number =>
            token !== null && token.type === tokenTypes.Ident && !ColorParser.isPredefinedSpace(token.value) ? 1 : 0;
        const properties: Record<string, string> = {};
        for (const property of sources) {
            if (usable(property.value, defaultLexer.getProperty(property.name) !== null)) {
                // CSS Values 5 §10: the basis takes the "intrinsic size keywords allowed in the context", and auto is not
                // a value of the maximum sizes; CSS Sizing 4 §3.2: none "is not usable within calc-size()".
                properties[property.name] = MAXIMUM_SIZES.has(property.name) ? property.value.replace("<box-size>", "<maximum-box-size>") : property.value;
            }
        }
        const atrules: Record<string, { prelude?: string | null; descriptors?: Record<string, string> | null }> = {};
        for (const [atRuleName, prelude] of CSS_AT_RULES) {
            const name: string = atRuleName.replace(/^@/, "");
            const keepPrelude: boolean = prelude !== undefined && usable(prelude, defaultLexer.getAtrulePrelude(name) !== null);
            atrules[name] = { prelude: keepPrelude && prelude !== undefined ? prelude : null, descriptors: {} };
        }
        for (const descriptor of CSS_DESCRIPTORS) {
            const name: string = descriptor.atRule.replace(/^@/, "");
            const atRule: { prelude?: string | null; descriptors?: Record<string, string> | null } | undefined = atrules[name];
            if (atRule !== undefined && atRule.descriptors && usable(descriptor.value, this.hasOwnDescriptor(name, descriptor.name))) {
                atRule.descriptors[descriptor.name] = descriptor.value;
            }
        }
        const config: SyntaxConfig = { types, properties, atrules };
        return fork(config).lexer;
    }

    private relativeGrammar(name: string, grammar: string, typeSources: ReadonlyArray<readonly [string, string]>): string {
        // CSS Color 5 §4.2: with an origin color the arguments can "be specified as a component keyword". The grammars only
        // add "from <color>", so the form with an origin takes the function's keywords wherever it takes none.
        const channels: ReadonlyArray<string> | undefined = ColorSpaces.CHANNELS.get(name.replace(/^modern-|-syntax$|\(\)$/g, ""));
        if (channels === undefined || !ORIGIN_COLOR.test(grammar)) {
            return grammar;
        }
        const withChannels: (text: string, names: ReadonlyArray<string>) => string = (text: string, names: ReadonlyArray<string>): string =>
            text.replace(/\bnone\b/g, "none | " + [...names, ColorSpaces.ALPHA_CHANNEL].join(" | "));
        const origin: string = grammar.replace(ORIGIN_COLOR, "from <color> ");
        const optional: boolean = (ORIGIN_COLOR.exec(grammar) as RegExpExecArray)[0].endsWith("?");
        const absolute: string = optional ? " | " + grammar.replace(ORIGIN_COLOR, "") : "";
        if (!origin.includes(COLOR_PARAMETERS)) {
            return withChannels(origin, channels) + absolute;
        }
        // §5.1: in color() the keywords are r, g and b with a predefined RGB space, x, y and z with an XYZ space, and with
        // a custom space the names of the components descriptor of its profile, which are checked when the color is computed.
        const types: Map<string, string> = new Map<string, string>(typeSources);
        const parameters: (type: string, names: ReadonlyArray<string>) => string = (type: string, names: ReadonlyArray<string>): string =>
            withChannels(origin.replace(COLOR_PARAMETERS, "[ " + (types.get(type) ?? type) + " ]"), names);
        // CSS Color 4 §10.1: "If the <ident> names a non-existent color space", the color is invalid, not the declaration.
        return parameters("<predefined-rgb-params>", channels) + " | " + parameters("<xyz-params>", ColorSpaces.XYZ_CHANNELS) + " | "
            + parameters("<custom-params>", ["<custom-ident>"]) + absolute + " | " + grammar.replace(ORIGIN_COLOR, "").replace(COLOR_PARAMETERS, UNKNOWN_SPACE_PARAMETERS);
    }

    private hasOwnDescriptor(atRule: string, descriptor: string): boolean {
        // getAtruleDescriptor() reads a field that does not exist, so the descriptors are looked up the way the matcher does.
        const descriptors: Record<string, unknown> | null | undefined = defaultLexer.getAtrule(atRule)?.descriptors;
        return descriptors !== null && descriptors !== undefined && descriptors[descriptor] !== undefined && descriptors[descriptor] !== null;
    }

    private parseGrammar(grammar: string): DSNode | undefined {
        try {
            return definitionSyntax.parse(grammar);
        } catch {
            return undefined;
        }
    }

    private allReferencesDefined(grammar: DSNode, isDefined: (node: DSNode) => boolean): boolean {
        let defined: boolean = true;
        definitionSyntax.walk(grammar, (node: DSNode): void => {
            if (defined && !isDefined(node)) {
                defined = false;
            }
        });
        return defined;
    }
}
