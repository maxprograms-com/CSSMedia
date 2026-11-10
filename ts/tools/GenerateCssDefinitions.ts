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

import type { DSNode, DSNodeGroup } from "css-tree";
import { definitionSyntax } from "css-tree";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";

const WEBREF_LIST: string = "https://api.github.com/repos/w3c/webref/contents/tr/css";
const WEBREF_RAW: string = "https://raw.githubusercontent.com/w3c/webref/main/tr/css/";
const W3C_INDEX: string = "https://www.w3.org/Style/CSS/all-properties.en.json";
const DATED_URL: RegExp = /\/TR\/\d{4}\/[A-Z]+-([A-Za-z0-9-]+?)-(\d{8})\//;
const TR_BASE: string = "https://www.w3.org/TR/";
const DEFINITION_TABLE: RegExp = /<table class="?(?:def )?(propdef|descdef)[^>]*>([\s\S]*?)<\/table>/g;
const DEFINITION_NAME: RegExp = /<dfn[^>]*>([\s\S]*?)<\/dfn>/g;
const TABLE_ROW: RegExp = /<tr[^>]*>/;
const TABLE_CELL: RegExp = /<t[hd][^>]*>/;
const AT_RULE_HEADING: RegExp = /<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/g;
const DETACHED_MULTIPLIER: RegExp = /([\]>])\s+([#+*?]|\{\d)/g;
const PRODUCTION_BLOCK: RegExp = /<pre class="?(?:[^">]*\s)?prod(?:\s[^">]*)?"?[^>]*>([\s\S]*?)<\/pre>/g;
const PRODUCTION: RegExp = /(<[a-z0-9()-]+>|\b[a-z][a-z0-9-]*\(\))\s*=\s*([\s\S]*?)(?=\s*(?:<[a-z0-9()-]+>|\b[a-z][a-z0-9-]*\(\))\s*=|$)/g;
const BARE_FUNCTION: RegExp = /^[a-z][a-z0-9-]*\(\s*\)$/;
const ENTITIES: Readonly<Record<string, string>> = { "lt": "<", "gt": ">", "amp": "&", "quot": "\"", "apos": "'", "nbsp": " " };
const SPEC_URL: RegExp = /\/TR\/([A-Za-z0-9-]+)\/?$/;
const LEVEL: RegExp = /-(\d+)$/;
const CSS2_SHORTNAME: string = "CSS2";
const BATCH_SIZE: number = 8;
const LEFT_SINGLE_QUOTE: string = '\u2018';
const RIGHT_SINGLE_QUOTE: string = '\u2019';
const INVISIBLE: RegExp = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Zs}]/u;
const DEFINITION_LIST: RegExp = /<dl class="?propdef-svg2"?[^>]*>([\s\S]*?)<\/dl>/;
const LIST_ENTRY: RegExp = /<dt[^>]*>([\s\S]*?)<\/dt>\s*<dd[^>]*>([\s\S]*?)<\/dd>/g;
const PROPERTY_TITLE: string = "propdef-title";
const SVG_SPECIFICATIONS: ReadonlySet<string> = new Set<string>(["SVG2", "svg-strokes", "svg-markers"]);
const FILL_STROKE: string = "fill-stroke-3";
const MATCH_TEXT: string = "match-text";
const MATCH_TEXT_PREFIXES: ReadonlyArray<string> = ["text-decoration-", "text-emphasis-"];
const DECORATION_PREFIX: string = "text-decoration-";
const SHORTHAND_INITIAL: RegExp = /^see individual properties$/i;
const PROPERTY_REFERENCE: RegExp = /<'([a-z-]+)'>/g;

interface ListEntry {
    name: string;
}

interface IndexEntry {
    url: string;
}

interface Supersession {
    by: string;
    replaces: string;
    names?: ReadonlyArray<string>;
}

const SUPERSESSIONS: ReadonlyArray<Supersession> = [
    { by: "css-align-3", replaces: "css-flexbox-1", names: ["justify-content", "align-items", "align-self", "align-content"] },
    { by: "css-text-decor-4", replaces: "css-text-decor-3" },
    { by: "css-gaps-1", replaces: "css-multicol-1", names: ["column-rule", "column-rule-color", "column-rule-style", "column-rule-width"] },
    { by: "css-ui-4", replaces: "css-ui-3" },
    { by: "css-sizing-3", replaces: "css-ui-3", names: ["box-sizing"] },
    { by: "css-position-3", replaces: "css-logical-1", names: ["inset", "inset-block", "inset-inline", "inset-block-start", "inset-block-end", "inset-inline-start", "inset-inline-end"] },
    { by: "mediaqueries-5", replaces: "mediaqueries-4" },
    {
        by: "SVG2", replaces: "fill-stroke-3", names: ["fill", "fill-opacity", "fill-rule", "stroke", "stroke-dasharray", "stroke-dashoffset", "stroke-linecap",
            "stroke-linejoin", "stroke-miterlimit", "stroke-opacity", "stroke-width", "<paint>"]
    },
    { by: "SVG2", replaces: "svg-strokes" },
    { by: "SVG2", replaces: "svg-markers" }
];

interface DescriptorAlias {
    atRule: string;
    name: string;
    target: string;
    spec: string;
}

const DESCRIPTOR_ALIASES: ReadonlyArray<DescriptorAlias> = [
    { atRule: "@font-face", name: "font-stretch", target: "font-width", spec: "css-fonts-4" }
];

const PROSE_ALIASES: ReadonlyArray<readonly [string, string, string]> = [["-webkit-user-select", "user-select", "css-ui-4"]];

const SCREEN_ONLY_DESCRIPTORS: ReadonlySet<string> = new Set<string>(["@font-face font-display", "@font-feature-values font-display"]);

const PDF_INITIALS: ReadonlyMap<string, string> = new Map<string, string>([["background-attachment", "fixed"]]);

const PROSE_GRAMMARS: ReadonlyMap<string, readonly [string, string]> = new Map<string, readonly [string, string]>([
    ["css-content-3 string-set", ["none | [ <custom-ident> <string>+ ]#",
        "none | [ <custom-ident> [ <string> | <counter()> | <counters()> | <content()> | <attr()> | contents ]+ ]#"]],
    ["css-page-floats-3 float", ["block-start | block-end | inline-start | inline-end | snap-block | snap-inline | left | right | top | bottom | none",
        "block-start | block-end | inline-start | inline-end | snap-block | snap-block( <length>{1,2} [ , [ start | end | near ] ]? ) | snap-inline"
        + " | snap-inline( <length>{1,2} [ , [ left | right | near ] ]? ) | left | right | top | bottom | none"]],
    ["SVG2 path-length", ["none | <length> [0,\u221E]", "none | <length [0,\u221E]>"]],
    ["css-shapes-1 shape()", ["shape( <'fill-rule'>? from <position> <shape-command># )", "shape( <'fill-rule'>? from <position> , <shape-command># )"]],
    ["css-round-display-1 shape-inside", ["auto | outside-shape | [ <basic-shape> || shape-box ] | <image> | display",
        "auto | outside-shape | [ <basic-shape> || <shape-box> ] | <image> | display"]],
    ["css-images-3 image-rendering", ["auto | smooth | high-quality | pixelated | crisp-edges",
        "auto | smooth | high-quality | pixelated | crisp-edges | optimizeSpeed | optimizeQuality"]],
    ["fill-stroke-3 fill", ["<background> with modifications",
        "[ <paint> || <position> [ / <bg-size> ]? || <repeat-style> || <'fill-origin'> ]#? , [ <paint> || <position> [ / <bg-size> ]? || <repeat-style> || <'fill-origin'> || <'fill-color'> ]"]],
    ["fill-stroke-3 stroke", ["<background> with modifications", "[ <paint> || <position> [ / <bg-size> ]? || <repeat-style> || <'stroke-origin'> || <color> ]#"]],
    ["fill-stroke-3 stroke-width", ["<length-percentage>#", "<length-percentage [0,\u221E]>#"]],
    ["fill-stroke-3 stroke-linejoin", ["[ crop | arcs | miter ] || [ bevel | round | stupid ]", "[ crop | arcs | miter ] || [ bevel | round | fallback ]"]],
    ["fill-stroke-3 stroke-miterlimit", ["<number>", "<number [1,\u221E]>"]],
    ["fill-stroke-3 stroke-dasharray", ["none | <length-percentage>+#", "none | <length-percentage [0,\u221E]>+#"]]
]);

const PROSE_TYPES: ReadonlyArray<readonly [string, string, string]> = [
    ["css-shapes-1", "<basic-shape>", "<basic-shape-rect> | <circle()> | <ellipse()> | <polygon()> | <path()> | <shape()>"],
    ["css-images-4", "<radial-size>", "<radial-extent>{1,2} | <length-percentage [0,\u221E]>{1,2}"]
];

interface WebrefValue {
    name: string;
    type?: string;
    value?: string;
    values?: Array<WebrefValue>;
}

interface WebrefProperty {
    name: string;
    value?: string;
    newValues?: string;
    initial?: string;
    appliesTo?: string;
    inherited?: string;
    percentages?: string;
    computedValue?: string;
    logicalPropertyGroup?: string;
    legacyAliasOf?: string;
    href?: string;
    values?: Array<WebrefValue>;
}

interface Unextracted {
    name: string;
    href: string;
    source: Source;
}

interface WebrefDescriptor {
    name: string;
    value?: string;
    initial?: string;
    computedValue?: string;
    values?: Array<WebrefValue>;
}

interface WebrefAtRule {
    name: string;
    value?: string;
    descriptors?: Array<WebrefDescriptor>;
    values?: Array<WebrefValue>;
}

interface WebrefSpec {
    spec: { title: string; url: string };
    properties?: Array<WebrefProperty>;
    atrules?: Array<WebrefAtRule>;
    values?: Array<WebrefValue>;
}

interface Source {
    shortname: string;
    family: string;
    css2: boolean;
    level: number;
    date: number;
}

interface Alias {
    target: string;
    source: Source;
}

interface UnreadType {
    name: string;
    source: Source;
}

interface Candidate<T> {
    item: T;
    grammar?: string;
    source: Source;
}

class CssDefinitionsGenerator {

    private readonly outputFile: string;
    private readonly svgFile: string;
    private readonly properties: Map<string, Array<Candidate<WebrefProperty>>> = new Map<string, Array<Candidate<WebrefProperty>>>();
    private readonly extensions: Map<string, Array<string>> = new Map<string, Array<string>>();
    private readonly aliases: Map<string, Alias> = new Map<string, Alias>();
    private readonly descriptorAliases: Map<string, Alias> = new Map<string, Alias>();
    private readonly atRules: Map<string, Array<Candidate<WebrefAtRule>>> = new Map<string, Array<Candidate<WebrefAtRule>>>();
    private readonly descriptors: Map<string, Array<Candidate<WebrefDescriptor>>> = new Map<string, Array<Candidate<WebrefDescriptor>>>();
    private readonly types: Map<string, Array<Candidate<string>>> = new Map<string, Array<Candidate<string>>>();
    private readonly unextracted: Array<Unextracted> = [];
    private readonly unreadTypes: Map<string, Array<UnreadType>> = new Map<string, Array<UnreadType>>();

    constructor(outputFile: string, svgFile: string) {
        this.outputFile = outputFile;
        this.svgFile = svgFile;
    }

    async run(): Promise<void> {
        const publications: Map<string, number> = await this.publications();
        const list: Array<ListEntry> = await (await this.fetchOk(WEBREF_LIST)).json() as Array<ListEntry>;
        const names: Array<string> = list.map((entry: ListEntry) => entry.name).filter((name: string) => name.endsWith(".json")).sort();
        const extracted: Array<Source> = [];
        for (let start: number = 0; start < names.length; start += BATCH_SIZE) {
            const batch: Array<string> = names.slice(start, start + BATCH_SIZE);
            const specs: Array<WebrefSpec> = await Promise.all(batch.map(async (name: string) => await (await this.fetchOk(WEBREF_RAW + name)).json() as WebrefSpec));
            for (const spec of specs) {
                const source: Source = this.sourceOf(spec.spec.url, publications);
                extracted.push(source);
                this.collect(spec, source);
            }
            console.log("Read " + Math.min(start + BATCH_SIZE, names.length) + " of " + names.length + " specifications");
        }
        for (const [url, entries] of this.unreadTypes) {
            const productions: Map<string, string> = this.productions(await (await this.fetchOk(url)).text());
            for (const entry of entries) {
                const grammar: string | undefined = productions.get(entry.name);
                if (grammar === undefined) {
                    console.log("No production of " + entry.name + " is found at " + url);
                    continue;
                }
                const value: string = this.proseGrammar(entry.name, entry.source.shortname, this.plainQuotes(grammar));
                this.add(this.types, entry.name, { item: value, grammar: value, source: entry.source });
            }
            console.log("Read the productions of " + url);
        }
        for (const shortname of this.missingLevels(publications, extracted)) {
            const url: string = TR_BASE + shortname + "/";
            this.collect(this.definitionTables(await (await this.fetchOk(url)).text(), url), this.sourceOf(url, publications));
            console.log("Read the definition tables of " + url);
        }
        // CSS UI 4 §6.1 makes -webkit-user-select an alias of user-select in its text, which webref does not record.
        for (const [name, target, spec] of PROSE_ALIASES) {
            this.aliases.set(name, { target, source: this.sourceOf(TR_BASE + spec + "/", publications) });
        }
        const pages: Map<string, string> = new Map<string, string>();
        for (const entry of this.unextracted) {
            if (this.aliases.has(entry.name)) {
                continue;
            }
            const hash: number = entry.href.indexOf("#");
            const address: string = hash < 0 ? entry.href : entry.href.substring(0, hash);
            let page: string | undefined = pages.get(address);
            if (page === undefined) {
                page = await (await this.fetchOk(address)).text();
                pages.set(address, page);
            }
            const property: WebrefProperty | undefined = hash < 0 ? undefined : this.definitionList(page, entry.name, entry.href.substring(hash + 1));
            if (property?.value === undefined) {
                console.log("No definition of " + entry.name + " is found at " + entry.href);
                continue;
            }
            this.add(this.properties, property.name, { item: property, grammar: this.plainQuotes(property.value), source: entry.source });
            console.log("Read the definition of " + entry.name + " at " + entry.href);
        }
        // Webref records legacy aliases of properties only; CSS Fonts 4 §4.4.1 also makes the font-stretch descriptor one.
        for (const alias of DESCRIPTOR_ALIASES) {
            this.descriptorAliases.set(alias.atRule + " " + alias.name, { target: alias.target, source: this.sourceOf(TR_BASE + alias.spec + "/", publications) });
        }
        const [css, svg]: readonly [string, string] = this.render();
        mkdirSync(dirname(this.outputFile), { recursive: true });
        writeFileSync(this.outputFile, css, "utf8");
        mkdirSync(dirname(this.svgFile), { recursive: true });
        writeFileSync(this.svgFile, svg, "utf8");
    }

    private async publications(): Promise<Map<string, number>> {
        // The dated URLs of the W3C index give the date of each specification's latest publication.
        const index: Array<IndexEntry> = await (await this.fetchOk(W3C_INDEX)).json() as Array<IndexEntry>;
        const publications: Map<string, number> = new Map<string, number>();
        for (const entry of index) {
            const match: RegExpExecArray | null = DATED_URL.exec(entry.url);
            const date: number = match === null ? 0 : Number(match[2]);
            if (match !== null && date > (publications.get(match[1]) ?? 0)) {
                publications.set(match[1], date);
            }
        }
        return publications;
    }

    private missingLevels(publications: Map<string, number>, extracted: ReadonlyArray<Source>): Array<string> {
        // Webref extracts only the latest level of each family; an earlier level is read from its own W3C page, for the
        // definitions that the latest level does not state clearly.
        const missing: Array<string> = [];
        for (const shortname of publications.keys()) {
            const source: Source = this.sourceOf(TR_BASE + shortname + "/", publications);
            if (!source.css2 && !extracted.some((known: Source) => known.shortname === shortname)) {
                missing.push(shortname);
            }
        }
        return missing.sort();
    }

    private definitionTables(page: string, url: string): WebrefSpec {
        // Every CSS specification writes its definitions as propdef and descdef tables of "Label:" rows.
        // Older publications write the labels in td cells and name the at-rule of their descriptors only in a heading.
        const properties: Array<WebrefProperty> = [];
        const atRules: Map<string, WebrefAtRule> = new Map<string, WebrefAtRule>();
        const headings: Array<{ position: number; atRule: string }> = [...page.matchAll(AT_RULE_HEADING)]
            .map((match: RegExpMatchArray) => ({ position: match.index ?? 0, atRule: /@[a-z-]+/.exec(this.plainText(match[1]))?.[0] ?? "" }))
            .filter((heading: { position: number; atRule: string }) => heading.atRule.length > 0);
        for (const table of page.matchAll(DEFINITION_TABLE)) {
            const rows: Map<string, string> = new Map<string, string>();
            let names: Array<string> = [];
            for (const row of table[2].split(TABLE_ROW).slice(1)) {
                const cells: Array<string> = row.split(TABLE_CELL);
                if (cells.length < 3) {
                    continue;
                }
                const label: string = this.plainText(cells[1]).replace(/:$/, "").toLowerCase();
                if (label === "name") {
                    names = [...cells[2].matchAll(DEFINITION_NAME)].map((match: RegExpMatchArray) => this.plainText(match[1]));
                } else {
                    rows.set(label, this.plainText(cells[2]));
                }
            }
            const value: string | undefined = rows.get("value")?.replace(DETACHED_MULTIPLIER, "$1$2");
            const newValues: string | undefined = rows.get("new values")?.replace(DETACHED_MULTIPLIER, "$1$2");
            for (const name of names) {
                const heading: string | undefined = headings.filter((item: { position: number; atRule: string }) => item.position < (table.index ?? 0)).pop()?.atRule;
                const atRule: string | undefined = rows.get("for") ?? heading;
                const fields: Array<readonly ["value" | "newValues" | "initial" | "appliesTo" | "inherited" | "percentages" | "computedValue" | "logicalPropertyGroup", string]> = [];
                const field: (key: "value" | "newValues" | "initial" | "appliesTo" | "inherited" | "percentages" | "computedValue" | "logicalPropertyGroup", text?: string) => void =
                    (key: "value" | "newValues" | "initial" | "appliesTo" | "inherited" | "percentages" | "computedValue" | "logicalPropertyGroup", text?: string): void => {
                        if (text !== undefined) {
                            fields.push([key, text]);
                        }
                    };
                field("value", value);
                field("newValues", newValues);
                field("initial", rows.get("initial"));
                field("appliesTo", rows.get("applies to"));
                field("inherited", rows.get("inherited"));
                field("percentages", rows.get("percentages"));
                field("computedValue", rows.get("computed value"));
                field("logicalPropertyGroup", rows.get("logical property group"));
                if (table[1] === "propdef") {
                    const property: WebrefProperty = { name };
                    for (const [key, text] of fields) {
                        property[key] = text;
                    }
                    properties.push(property);
                } else if (atRule !== undefined) {
                    const known: WebrefAtRule = atRules.get(atRule) ?? { name: atRule, descriptors: [] };
                    const descriptor: WebrefDescriptor = { name };
                    for (const [key, text] of fields) {
                        if (key === "value" || key === "initial" || key === "computedValue") {
                            descriptor[key] = text;
                        }
                    }
                    known.descriptors?.push(descriptor);
                    atRules.set(atRule, known);
                }
            }
        }
        const values: Array<WebrefValue> = [...this.productions(page)].map(([name, value]: [string, string]): WebrefValue =>
            ({ name, type: name.endsWith("()>") || name.endsWith("()") ? "function" : "type", value }));
        return { spec: { title: this.plainText(/<title>([\s\S]*?)<\/title>/.exec(page)?.[1] ?? url), url }, properties, atrules: [...atRules.values()], values };
    }

    private productions(page: string): Map<string, string> {
        // The production blocks of a specification; a function may be written without angle brackets, as rgb() is in CSS Color 4 §5.1.
        const productions: Map<string, string> = new Map<string, string>();
        for (const block of page.matchAll(PRODUCTION_BLOCK)) {
            for (const production of this.plainText(block[1]).matchAll(PRODUCTION)) {
                productions.set(production[1], production[2].replace(DETACHED_MULTIPLIER, "$1$2"));
            }
        }
        return productions;
    }

    private definitionList(page: string, name: string, fragment: string): WebrefProperty | undefined {
        const start: number = page.indexOf("id=\"" + fragment + "\"");
        if (start < 0) {
            return undefined;
        }
        const next: number = page.indexOf(PROPERTY_TITLE, page.indexOf(PROPERTY_TITLE, start) + PROPERTY_TITLE.length);
        const list: RegExpExecArray | null = DEFINITION_LIST.exec(next < 0 ? page.substring(start) : page.substring(start, next));
        if (list === null) {
            return undefined;
        }
        const property: WebrefProperty = { name };
        for (const entry of list[1].matchAll(LIST_ENTRY)) {
            const label: string = this.plainText(entry[1]).replace(/:$/, "").toLowerCase();
            const text: string = this.plainText(entry[2]);
            if (label === "value") {
                property.value = text.replace(DETACHED_MULTIPLIER, "$1$2");
            } else if (label === "initial") {
                property.initial = text;
            } else if (label === "applies to") {
                property.appliesTo = text;
            } else if (label === "inherited") {
                property.inherited = text;
            } else if (label === "percentages") {
                property.percentages = text;
            } else if (label === "computed value") {
                property.computedValue = text;
            }
        }
        return property;
    }

    private plainText(markup: string): string {
        const text: string = markup.replace(/<!--[\s\S]*?-->/g, "").replace(/<[^>]*>/g, "").replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (entity: string, name: string): string => {
            if (name.startsWith("#x") || name.startsWith("#X")) {
                return String.fromCodePoint(Number.parseInt(name.substring(2), 16));
            }
            if (name.startsWith("#")) {
                return String.fromCodePoint(Number(name.substring(1)));
            }
            return ENTITIES[name.toLowerCase()] ?? entity;
        });
        return text.replace(/\s+/g, " ").trim();
    }

    private sourceOf(url: string, publications: Map<string, number>): Source {
        const match: RegExpExecArray | null = SPEC_URL.exec(url);
        const shortname: string = match === null ? url : match[1];
        const level: RegExpExecArray | null = LEVEL.exec(shortname);
        return {
            shortname,
            family: level === null ? shortname : shortname.substring(0, shortname.length - level[0].length),
            css2: shortname === CSS2_SHORTNAME,
            level: level === null ? 1 : Number(level[1]),
            date: publications.get(shortname) ?? 0
        };
    }

    private collect(spec: WebrefSpec, source: Source): void {
        if (spec.properties !== undefined) {
            for (const property of spec.properties) {
                if (property.value !== undefined) {
                    this.add(this.properties, property.name, { item: property, grammar: this.plainQuotes(property.value), source });
                } else if (property.newValues !== undefined) {
                    const known: Array<string> | undefined = this.extensions.get(property.name);
                    if (known === undefined) {
                        this.extensions.set(property.name, [this.plainQuotes(property.newValues)]);
                    } else {
                        known.push(this.plainQuotes(property.newValues));
                    }
                } else if (property.legacyAliasOf !== undefined) {
                    const known: Alias | undefined = this.aliases.get(property.name);
                    if (known === undefined || this.newer(source, known.source)) {
                        this.aliases.set(property.name, { target: property.legacyAliasOf, source });
                    }
                } else if (property.href !== undefined) {
                    this.unextracted.push({ name: property.name, href: property.href, source });
                }
                this.collectTypes(source, spec.spec.url, property.values);
            }
        }
        if (spec.atrules !== undefined) {
            for (const atRule of spec.atrules) {
                this.add(this.atRules, atRule.name, atRule.value === undefined ? { item: atRule, source } : { item: atRule, grammar: this.plainQuotes(atRule.value), source });
                if (atRule.descriptors !== undefined) {
                    for (const descriptor of atRule.descriptors) {
                        // CSS Fonts 4 §4.9 and §4.9.1: font-display chooses what is shown while a font downloads, which a PDF never shows.
                        if (descriptor.value !== undefined && !SCREEN_ONLY_DESCRIPTORS.has(atRule.name + " " + descriptor.name)) {
                            this.add(this.descriptors, atRule.name + " " + descriptor.name, { item: descriptor, grammar: this.plainQuotes(descriptor.value), source });
                        }
                        this.collectTypes(source, spec.spec.url, descriptor.values);
                    }
                }
                this.collectTypes(source, spec.spec.url, atRule.values);
            }
        }
        this.collectTypes(source, spec.spec.url, spec.values);
        // Types given in the text without a production: CSS Shapes 1 §3.1 lists the <basic-shape> functions, and CSS Images 4
        // §3.2.2 extends <radial-size> with them.
        for (const [shortname, name, grammar] of PROSE_TYPES) {
            if (shortname === source.shortname) {
                this.add(this.types, name, { item: grammar, grammar, source });
            }
        }
    }

    private collectTypes(source: Source, url: string, values?: Array<WebrefValue>): void {
        if (values === undefined) {
            return;
        }
        for (const value of values) {
            if (value.type === "type" || value.type === "function") {
                // Webref can give a production no value, or a function only its own name, where the specification defines it in
                // a production block, as CSS Color 4 §5.1 does rgb() and <legacy-rgb-syntax>; those are read from its page.
                if (value.value === undefined || BARE_FUNCTION.test(value.value.trim())) {
                    const unread: Array<UnreadType> = this.unreadTypes.get(url) ?? [];
                    unread.push({ name: value.name, source });
                    this.unreadTypes.set(url, unread);
                } else {
                    const grammar: string = this.proseGrammar(value.name, source.shortname, this.plainQuotes(value.value));
                    this.add(this.types, value.name, { item: grammar, grammar, source });
                }
            }
            this.collectTypes(source, url, value.values);
        }
    }

    private plainQuotes(grammar: string): string {
        // Spec renderings write a property reference <'name'> with typographic quotes, which the value definition syntax does not accept.
        return grammar.split(LEFT_SINGLE_QUOTE).join("'").split(RIGHT_SINGLE_QUOTE).join("'");
    }

    private add<T>(map: Map<string, Array<Candidate<T>>>, key: string, candidate: Candidate<T>): void {
        const known: Array<Candidate<T>> | undefined = map.get(key);
        if (known === undefined) {
            map.set(key, [candidate]);
        } else {
            known.push(candidate);
        }
    }

    private familyWinners<T>(candidates: ReadonlyArray<Candidate<T>>): Array<Candidate<T>> {
        // Within one family the newest level wins, then the later publication.
        const winners: Map<string, Candidate<T>> = new Map<string, Candidate<T>>();
        for (const candidate of candidates) {
            const current: Candidate<T> | undefined = winners.get(candidate.source.family);
            if (current === undefined || this.compareWithinFamily(candidate.source, current.source) > 0) {
                winners.set(candidate.source.family, candidate);
            }
        }
        return [...winners.values()];
    }

    private compareWithinFamily(a: Source, b: Source): number {
        return (a.level - b.level) || (a.date - b.date);
    }

    private newer(a: Source, b: Source): boolean {
        if (a.css2 !== b.css2) {
            return b.css2;
        }
        return a.family === b.family ? this.compareWithinFamily(a, b) > 0 : a.date > b.date;
    }

    private isClear(grammar?: string): boolean {
        if (grammar === undefined) {
            return true;
        }
        try {
            definitionSyntax.parse(grammar);
            return true;
        } catch {
            return false;
        }
    }

    private current<T>(name: string, candidates: ReadonlyArray<Candidate<T>>): Array<Candidate<T>> {
        // A definition that another specification normatively supersedes gives way to it.
        return candidates.filter((candidate: Candidate<T>) => !SUPERSESSIONS.some((supersession: Supersession) =>
            supersession.replaces === candidate.source.shortname && (supersession.names === undefined || supersession.names.includes(name))
            && candidates.some((other: Candidate<T>) => other.source.shortname === supersession.by)));
    }

    private best<T>(name: string, candidates: ReadonlyArray<Candidate<T>>): Candidate<T> {
        // The newest specification applies; when its definition is not clear, the latest one with a clear definition does.
        // A module replaces the CSS 2 definition it revises.
        const current: Array<Candidate<T>> = this.current(name, candidates);
        const clear: Array<Candidate<T>> = current.filter((candidate: Candidate<T>) => this.isClear(candidate.grammar));
        const ordered: Array<Candidate<T>> = this.familyWinners(clear.length > 0 ? clear : current).sort((a: Candidate<T>, b: Candidate<T>) =>
            (a.source.css2 === b.source.css2 ? 0 : (a.source.css2 ? 1 : -1)) || b.source.date - a.source.date || a.source.shortname.localeCompare(b.source.shortname));
        if (ordered.length > 1 && !ordered[0].source.css2 && !ordered[1].source.css2
            && ordered[0].source.date === ordered[1].source.date && ordered[0].grammar !== ordered[1].grammar) {
            console.log("No publication date decides " + name + " between " + ordered.map((candidate: Candidate<T>) => candidate.source.shortname).join(", ")
                + "; " + ordered[0].source.shortname + " is used");
        }
        return ordered[0];
    }

    private alternatives(grammar: string): Array<string> | undefined {
        // The top-level alternatives of a grammar, written the same way however the specification wrote them.
        let parsed: DSNodeGroup;
        try {
            parsed = definitionSyntax.parse(grammar);
        } catch {
            return undefined;
        }
        if (parsed.combinator === "|" && !parsed.explicit) {
            return parsed.terms.map((term: DSNode) => definitionSyntax.generate(term));
        }
        return [definitionSyntax.generate(parsed)];
    }

    private withAlternatives(base: string, additions: ReadonlyArray<string>): string {
        // An addition contributes only the alternatives the grammar does not have yet.
        const known: Set<string> = new Set<string>(this.alternatives(base) ?? [base]);
        const added: Array<string> = [];
        for (const addition of additions) {
            for (const alternative of this.alternatives(addition) ?? [addition]) {
                if (!known.has(alternative)) {
                    known.add(alternative);
                    added.push(alternative);
                }
            }
        }
        return added.length === 0 ? base : base + " | " + added.join(" | ");
    }

    private typeGrammar(name: string, candidates: ReadonlyArray<Candidate<string>>): string {
        // Different specifications can define different functions with the same name, such as element() in CSS Images and in GCPM,
        // and a single name can only hold all of them as alternatives; any other type is one production that later specifications revise.
        if (!name.endsWith("()")) {
            return this.best(name, candidates).item;
        }
        const winners: Array<Candidate<string>> = this.familyWinners(this.current(name, candidates)).sort((a: Candidate<string>, b: Candidate<string>) => a.source.shortname.localeCompare(b.source.shortname));
        return this.withAlternatives(winners[0].item, winners.slice(1).map((candidate: Candidate<string>) => candidate.item));
    }

    private split<T>(name: string, candidates: ReadonlyArray<Candidate<T>>): readonly [Candidate<T> | undefined, Candidate<T> | undefined] {
        // A definition of an SVG specification that wins goes to the table of SVG images, which the SVG code lays over the
        // document's table; the document's table takes the best of the others.
        const chosen: Candidate<T> = this.best(name, candidates);
        if (!SVG_SPECIFICATIONS.has(chosen.source.shortname)) {
            return [chosen, undefined];
        }
        const others: Array<Candidate<T>> = candidates.filter((candidate: Candidate<T>) => !SVG_SPECIFICATIONS.has(candidate.source.shortname));
        return [others.length === 0 ? undefined : this.best(name, others), chosen];
    }

    private propertyEntry(name: string, chosen: Candidate<WebrefProperty>, all: ReadonlyMap<string, Candidate<WebrefProperty>>): string {
        const property: WebrefProperty = chosen.item;
        const value: string = this.withAlternatives(this.proseGrammar(name, chosen.source.shortname, chosen.grammar as string), this.extensionsOf(name, chosen, all));
        // A background in a PDF is attached to the page box, so background-attachment starts as fixed and not as scroll.
        return "    { name: " + this.literal(name) + ", value: " + this.literal(value) + this.field("initial", PDF_INITIALS.get(name) ?? property.initial)
            + this.field("appliesTo", property.appliesTo) + this.field("inherited", property.inherited) + this.field("percentages", property.percentages)
            + this.field("computedValue", property.computedValue) + this.field("logicalPropertyGroup", property.logicalPropertyGroup)
            + ", spec: " + this.literal(chosen.source.shortname) + " }";
    }

    private render(): readonly [string, string] {
        let text: string = this.header();
        text += "export interface CssPropertyDefinition {\n    name: string;\n    value: string;\n    initial?: string;\n    appliesTo?: string;\n"
            + "    inherited?: string;\n    percentages?: string;\n    computedValue?: string;\n    logicalPropertyGroup?: string;\n    spec: string;\n}\n\n";
        text += "export interface CssDescriptorDefinition {\n    atRule: string;\n    name: string;\n    value: string;\n    initial?: string;\n    computedValue?: string;\n    spec: string;\n}\n\n";
        const aliasNames: Array<string> = [];
        const chosenProperties: Map<string, Candidate<WebrefProperty>> = new Map<string, Candidate<WebrefProperty>>();
        const svgProperties: Map<string, Candidate<WebrefProperty>> = new Map<string, Candidate<WebrefProperty>>();
        for (const name of [...new Set<string>([...this.properties.keys(), ...this.aliases.keys()])].sort()) {
            const candidates: Array<Candidate<WebrefProperty>> | undefined = this.properties.get(name);
            const [chosen, svg]: readonly [Candidate<WebrefProperty> | undefined, Candidate<WebrefProperty> | undefined] = candidates === undefined ? [undefined, undefined]
                : this.split(name, candidates);
            if (svg !== undefined) {
                svgProperties.set(name, svg);
            }
            const alias: Alias | undefined = this.aliases.get(name);
            // A name that a newer specification turns into a legacy alias, as font-stretch in CSS Fonts 4, is an alias.
            if (alias !== undefined && (chosen === undefined || this.newer(alias.source, chosen.source))) {
                aliasNames.push(name);
                continue;
            }
            if (chosen !== undefined) {
                chosenProperties.set(name, chosen);
            }
        }
        this.addMatchText(chosenProperties);
        const propertyEntries: Array<string> = [...chosenProperties.keys()].sort()
            .map((name: string) => this.propertyEntry(name, chosenProperties.get(name) as Candidate<WebrefProperty>, chosenProperties));
        text += "export const CSS_PROPERTIES: ReadonlyArray<CssPropertyDefinition> = [\n" + propertyEntries.join(",\n") + "\n];\n\n";
        const aliasEntries: Array<string> = aliasNames.map((name: string) => "    [" + this.literal(name) + ", " + this.literal((this.aliases.get(name) as Alias).target) + "]");
        text += "export const CSS_PROPERTY_ALIASES: ReadonlyArray<readonly [string, string]> = [\n" + aliasEntries.join(",\n") + "\n];\n\n";
        const atRuleEntries: Array<string> = [...this.atRules.keys()].sort().map((name: string) => {
            const prelude: string | undefined = this.best(name, this.atRules.get(name) as Array<Candidate<WebrefAtRule>>).grammar;
            return "    [" + this.literal(name) + (prelude === undefined ? "" : ", " + this.literal(prelude)) + "]";
        });
        text += "export const CSS_AT_RULES: ReadonlyArray<readonly [string, string?]> = [\n" + atRuleEntries.join(",\n") + "\n];\n\n";
        const descriptorEntries: Array<string> = [];
        const descriptorAliasEntries: Array<string> = [];
        for (const key of [...new Set<string>([...this.descriptors.keys(), ...this.descriptorAliases.keys()])].sort()) {
            const candidates: Array<Candidate<WebrefDescriptor>> | undefined = this.descriptors.get(key);
            const chosen: Candidate<WebrefDescriptor> | undefined = candidates === undefined ? undefined : this.best(key, candidates);
            const alias: Alias | undefined = this.descriptorAliases.get(key);
            const atRule: string = key.substring(0, key.indexOf(" "));
            if (alias !== undefined && (chosen === undefined || this.newer(alias.source, chosen.source))) {
                descriptorAliasEntries.push("    [" + this.literal(atRule) + ", " + this.literal(key.substring(key.indexOf(" ") + 1)) + ", " + this.literal(alias.target) + "]");
                continue;
            }
            if (chosen === undefined) {
                continue;
            }
            descriptorEntries.push("    { atRule: " + this.literal(atRule) + ", name: " + this.literal(chosen.item.name) + ", value: " + this.literal(chosen.grammar as string)
                + this.field("initial", chosen.item.initial) + this.field("computedValue", chosen.item.computedValue) + ", spec: " + this.literal(chosen.source.shortname) + " }");
        }
        text += "export const CSS_DESCRIPTORS: ReadonlyArray<CssDescriptorDefinition> = [\n" + descriptorEntries.join(",\n") + "\n];\n\n";
        text += "export const CSS_DESCRIPTOR_ALIASES: ReadonlyArray<readonly [string, string, string]> = [\n" + descriptorAliasEntries.join(",\n") + "\n];\n\n";
        const typeEntries: Array<string> = [];
        const svgTypeEntries: Array<string> = [];
        for (const name of [...this.types.keys()].sort()) {
            const candidates: Array<Candidate<string>> = this.types.get(name) as Array<Candidate<string>>;
            const [chosen, svg]: readonly [Candidate<string> | undefined, Candidate<string> | undefined] = this.split(name, candidates);
            if (svg !== undefined) {
                const own: Array<Candidate<string>> = candidates.filter((candidate: Candidate<string>) => SVG_SPECIFICATIONS.has(candidate.source.shortname));
                svgTypeEntries.push("    [" + this.literal(name) + ", " + this.literal(this.typeGrammar(name, own)) + "]");
            }
            if (chosen !== undefined) {
                const others: Array<Candidate<string>> = candidates.filter((candidate: Candidate<string>) => !SVG_SPECIFICATIONS.has(candidate.source.shortname));
                typeEntries.push("    [" + this.literal(name) + ", " + this.literal(this.typeGrammar(name, others)) + "]");
            }
        }
        text += "export const CSS_TYPES: ReadonlyArray<readonly [string, string]> = [\n" + typeEntries.join(",\n") + "\n];\n";
        let svgText: string = this.header() + "import type { CssPropertyDefinition } from \"../../css/generated/CssDefinitions.js\";\n\n";
        const svgEntries: Array<string> = [...svgProperties].map(([name, chosen]: [string, Candidate<WebrefProperty>]) => this.propertyEntry(name, chosen, svgProperties));
        svgText += "export const SVG_PROPERTIES: ReadonlyArray<CssPropertyDefinition> = [\n" + svgEntries.join(",\n") + "\n];\n\n";
        svgText += "export const SVG_TYPES: ReadonlyArray<readonly [string, string]> = [\n" + svgTypeEntries.join(",\n") + "\n];\n";
        return [text, svgText];
    }

    private addMatchText(chosen: Map<string, Candidate<WebrefProperty>>): void {
        // Fill and Stroke 3 §5 defines in its text, without definition tables, a text-decoration-* and a text-emphasis-* copy of
        // every fill and stroke property, "exactly analogous" but with match-text as initial value and text-decoration-* not inherited.
        const originals: Array<[string, Candidate<WebrefProperty>]> = [...chosen].filter(([, candidate]: [string, Candidate<WebrefProperty>]) => candidate.source.shortname === FILL_STROKE);
        const names: Set<string> = new Set<string>(originals.map(([name]: [string, Candidate<WebrefProperty>]) => name));
        for (const prefix of MATCH_TEXT_PREFIXES) {
            for (const [name, candidate] of originals) {
                if (chosen.has(prefix + name)) {
                    continue;
                }
                const value: string = this.withAlternatives(this.proseGrammar(name, FILL_STROKE, candidate.grammar as string), this.extensionsOf(name, candidate, chosen));
                const renamed: string = value.replace(PROPERTY_REFERENCE, (reference: string, target: string): string => names.has(target) ? "<'" + prefix + target + "'>" : reference);
                const shorthand: boolean = SHORTHAND_INITIAL.test(candidate.item.initial ?? "");
                const grammar: string = shorthand ? renamed : MATCH_TEXT + " | " + renamed;
                const item: WebrefProperty = { ...candidate.item, name: prefix + name, value: grammar, initial: shorthand ? candidate.item.initial as string : MATCH_TEXT };
                if (!shorthand && prefix === DECORATION_PREFIX) {
                    item.inherited = "no";
                }
                chosen.set(prefix + name, { item, grammar, source: candidate.source });
            }
        }
    }

    private proseGrammar(name: string, shortname: string, line: string): string {
        // Where the grammar line does not say what the text does: CSS Content 3 §2.7.1 with GCPM 3 §1.1.1, CSS Page Floats 3 §3.2, SVG 2 §9.6.2, CSS Shapes 1
        // §3.1.1, CSS Round Display 1 §5.1, CSS Images 3 §5.2, Fill and Stroke 3 §3.3.7, §4.2.1, §4.2.4, §4.2.5, §4.3.1 and §4.4.7. A changed line is read again.
        const prose: readonly [string, string] | undefined = PROSE_GRAMMARS.get(shortname + " " + name);
        if (prose === undefined) {
            return line;
        }
        if (prose[0] !== line) {
            console.log("The grammar line of " + name + " in " + shortname + " changed to \"" + line
                + "\"; the grammar read from its text is not used until the section is read again");
            return line;
        }
        return prose[1];
    }

    private extensionsOf(name: string, chosen: Candidate<WebrefProperty>, all: ReadonlyMap<string, Candidate<WebrefProperty>>): Array<string> {
        // A specification names the physical properties when it adds values, as CSS Anchor Positioning 1 does for top and
        // width; the properties of the same logical property group that share their definition take the same values.
        const extensions: Array<string> = [];
        const own: ReadonlyArray<string> | undefined = this.extensions.get(name);
        if (own !== undefined) {
            extensions.push(...own);
        }
        const group: string | undefined = chosen.item.logicalPropertyGroup;
        if (group === undefined) {
            return extensions;
        }
        for (const [other, candidate] of all) {
            const shared: ReadonlyArray<string> | undefined = other !== name && candidate.item.logicalPropertyGroup === group && candidate.grammar === chosen.grammar
                ? this.extensions.get(other) : undefined;
            if (shared !== undefined) {
                extensions.push(...shared);
            }
        }
        return extensions;
    }

    private field(name: string, text?: string): string {
        return text === undefined ? "" : ", " + name + ": " + this.literal(text);
    }

    private literal(text: string): string {
        // Invisible characters (control, format and space characters other than the plain space) are written as escapes.
        let escaped: string = "";
        for (const character of JSON.stringify(text)) {
            if (character !== " " && INVISIBLE.test(character)) {
                for (let index: number = 0; index < character.length; index++) {
                    escaped += "\\u" + character.charCodeAt(index).toString(16).toUpperCase().padStart(4, "0");
                }
            } else {
                escaped += character;
            }
        }
        return escaped;
    }

    private header(): string {
        return "/*******************************************************************************\n" +
            " * Copyright (c) 2026 Maxprograms. All rights reserved.\n" +
            " *\n" +
            " * Licensed under the Business Source License 1.1 (the \"License\");\n" +
            " * you may not use this file except in compliance with the License.\n" +
            " *\n" +
            " * Change Date: 2030-11-01\n" +
            " * Change License: Mozilla Public License, v. 2.0\n" +
            " *\n" +
            " * Additional Use Grant:\n" +
            " * You may make production use of the Licensed Work for personal use,\n" +
            " * educational use, and academic research. \"Personal use\" means use by an\n" +
            " * individual for their own purposes, and not on behalf of an employer, client\n" +
            " * or other organization. You may also make production use of the Licensed Work\n" +
            " * for trial purposes for a period of up to 30 days.\n" +
            " *\n" +
            " * You may obtain a copy of the License at https://spdx.org/licenses/BUSL-1.1.html\n" +
            " * or in the LICENSE file provided in the root of this repository.\n" +
            " *******************************************************************************/\n\n";
    }

    private async fetchOk(url: string): Promise<Response> {
        const response: Response = await fetch(url);
        if (!response.ok) {
            throw new Error("Failed to fetch " + url + ": " + response.status + " " + response.statusText);
        }
        return response;
    }
}

const PACKAGE_ROOT: string = resolvePath(dirname(fileURLToPath(import.meta.url)), "..", "..");
try {
    await new CssDefinitionsGenerator(join(PACKAGE_ROOT, "ts", "css", "generated", "CssDefinitions.ts"), join(PACKAGE_ROOT, "ts", "svg", "generated", "SvgDefinitions.ts")).run();
    console.log("Generated ts/css/generated/CssDefinitions.ts and ts/svg/generated/SvgDefinitions.ts");
} catch (error) {
    console.error("Error generating the CSS definitions:", error);
    process.exitCode = 1;
}
