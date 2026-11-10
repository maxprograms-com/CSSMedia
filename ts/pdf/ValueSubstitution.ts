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
import { string as cssString, url as cssUrl, parse, tokenTypes } from "css-tree";
import type { XMLElement } from "typesxml";
import { AsciiCase } from "../css/AsciiCase.js";
import type { TriState } from "../css/ConditionEvaluator.js";
import { ConditionEvaluator } from "../css/ConditionEvaluator.js";
import { CssIdentifierEscaping } from "../css/CssIdentifierEscaping.js";
import { DeclarationReader } from "../css/DeclarationReader.js";
import type { PropertyTable } from "../css/PropertyTable.js";
import { SelectorCompiler } from "../css/SelectorCompiler.js";
import type {
    ContainerQuery, CssWideKeyword, CustomPropertyValue, Declaration, FunctionDescriptor, FunctionParameter, FunctionRule, PendingSubstitution, Stylesheet
} from "../css/Stylesheet.js";
import { DEFAULT_PAGE_SIZE } from "../css/StylesheetReader.js";
import type { Token } from "../css/SubstitutionSyntax.js";
import { SubstitutionSyntax } from "../css/SubstitutionSyntax.js";
import { SupportsEvaluator } from "../css/SupportsEvaluator.js";
import { SyntaxDefinition } from "../css/SyntaxDefinition.js";
import { CssUnits } from "../css/values/CssUnits.js";
import type { BaseType } from "../css/values/CssValue.js";
import { SourceElement } from "../parse/SourceElement.js";
import { BaseUrls } from "./BaseUrls.js";
import type { ContainerAxis } from "./ElementUnits.js";
import type { Size } from "./PageCanvas.js";

export interface CustomValue {
    text: string;
    base?: string;
}

export interface SubstitutionHost {
    element?: XMLElement;
    pseudoElement?: string;
    custom(name: string): CustomValue | null;
    inherited(name: string): CustomValue | null;
    initialCustom(name: string): CustomValue | null;
    registration(name: string): string | undefined;
    inherits(name: string): boolean;
    typed(syntax: string, text: string, baseUrl: string): string | undefined;
    matches(property: string, value?: string): TriState;
    numeric(text: string): [number, string] | undefined;
    containersHold(queries: ReadonlyArray<ContainerQuery>): boolean;
    enter(key: string): boolean;
    leave(key: string): boolean;
}

interface Substituted {
    tokens: Array<Token>;
    base?: string;
}

interface Resolved {
    result?: Array<Token>;
    fallback?: ReadonlyArray<Token>;
    base?: string;
}

interface Frame {
    rule: FunctionRule;
    parent?: Frame;
    callingProperty: string;
    parameters: Map<string, CustomValue | null>;
    locals: Map<string, FunctionDescriptor>;
    computed: Map<string, CustomValue | null>;
}

interface Scope {
    host: SubstitutionHost;
    frame?: Frame;
    property: string;
    baseUrl: string;
    namespaces: ReadonlyMap<string, string>;
    random: boolean;
}

const ENVIRONMENT: ReadonlyMap<string, string> = new Map<string, string>([
    ["safe-area-inset-top", "0px"], ["safe-area-inset-right", "0px"], ["safe-area-inset-bottom", "0px"], ["safe-area-inset-left", "0px"],
    ["safe-area-max-inset-top", "0px"], ["safe-area-max-inset-right", "0px"], ["safe-area-max-inset-bottom", "0px"], ["safe-area-max-inset-left", "0px"],
    ["preferred-text-scale", "1"]
]);
const URL_FUNCTIONS: ReadonlySet<string> = new Set<string>(["url", "src", "image", "image-set"]);
const OPENERS: ReadonlySet<number> = new Set<number>([tokenTypes.Function, tokenTypes.LeftParenthesis, tokenTypes.LeftSquareBracket, tokenTypes.LeftCurlyBracket]);
const CLOSERS: ReadonlySet<number> = new Set<number>([tokenTypes.RightParenthesis, tokenTypes.RightSquareBracket, tokenTypes.RightCurlyBracket]);
const COMPARISONS: ReadonlySet<string> = new Set<string>(["<", ">", "="]);
const SIZE_FEATURES: ReadonlyMap<string, ReadonlyArray<ContainerAxis>> = new Map<string, ReadonlyArray<ContainerAxis>>([
    ["width", ["width"]], ["height", ["height"]], ["inline-size", ["inline"]], ["block-size", ["block"]],
    ["aspect-ratio", ["width", "height"]], ["orientation", ["width", "height"]]
]);
const MAXIMUM_TOKENS: number = 1000000;
const URL_TYPE: string = "url";

export class ValueSubstitution {

    private readonly table: PropertyTable;
    private readonly reader: DeclarationReader;
    private readonly syntax: SubstitutionSyntax = new SubstitutionSyntax();
    private readonly conditions: ConditionEvaluator = new ConditionEvaluator(DEFAULT_PAGE_SIZE);
    private readonly supports: SupportsEvaluator;
    private readonly functions: Map<string, FunctionRule> = new Map<string, FunctionRule>();
    private readonly prefixes: ReadonlyMap<string, string>;
    private readonly bases: BaseUrls;
    private readonly randomValues: Map<string, number> = new Map<string, number>();
    private readonly elementKeys: WeakMap<XMLElement, number> = new WeakMap<XMLElement, number>();
    private readonly asciiCase: AsciiCase = new AsciiCase();
    private readonly escaping: CssIdentifierEscaping = new CssIdentifierEscaping();
    private readonly units: CssUnits = new CssUnits();
    private nextElementKey: number = 0;

    constructor(table: PropertyTable, stylesheet: Stylesheet, prefixes: ReadonlyMap<string, string>, documentUri: string) {
        this.table = table;
        this.reader = new DeclarationReader(table);
        this.prefixes = prefixes;
        this.bases = new BaseUrls(documentUri);
        this.supports = new SupportsEvaluator(new DeclarationReader(table), new SelectorCompiler(), this.conditions);
        for (const [name, definition] of stylesheet.customMedia) {
            const list: MediaQueryList | undefined = typeof definition === "boolean" ? undefined : this.mediaList(definition);
            if (typeof definition === "boolean" || list !== undefined) {
                this.conditions.define(name, list ?? definition as boolean);
            }
        }
        for (const [name, supported] of stylesheet.supportsConditions) {
            this.supports.defineResult(name, supported);
        }
        for (const rule of stylesheet.functions) {
            // CSS Functions and Mixins §2.1.1: the rule in the stronger cascade layer wins, and the later one within a layer.
            const known: FunctionRule | undefined = this.functions.get(rule.name);
            if (known === undefined || rule.layer > known.layer || (rule.layer === known.layer && rule.order > known.order)) {
                this.functions.set(rule.name, rule);
            }
        }
    }

    replace(pending: PendingSubstitution, property: string, host: SubstitutionHost, atRule?: string): ReadonlyArray<Declaration> | CssWideKeyword | undefined {
        // CSS Values 5 Appendix A: after substitution the value is parsed with the grammar of the declared property, the
        // shorthand when the declaration was one, or of the descriptor of its at-rule.
        const target: string = pending.shorthand ?? property;
        const scope: Scope = { host, property:target, baseUrl: pending.baseUrl, namespaces: pending.namespaces, random: true };
        const result: Substituted | undefined = this.substitute(this.syntax.tokens(pending.text), scope);
        if (result === undefined) {
            return undefined;
        }
        const text: string = this.syntax.serialize(result.tokens).trim();
        const keyword: string = this.asciiCase.foldLower(text);
        if (DeclarationReader.CSS_WIDE_KEYWORDS.has(keyword)) {
            return keyword as CssWideKeyword;
        }
        let parsed: CssTreeDeclaration;
        try {
            parsed = parse(target + ": " + text, { context: "declaration" }) as CssTreeDeclaration;
        } catch {
            return undefined;
        }
        const read: ReadonlyArray<Declaration> | undefined = atRule === undefined ? this.reader.read(parsed, pending.baseUrl, pending.namespaces)
            : this.reader.readDescriptor(atRule.startsWith("@") ? atRule.substring(1) : atRule, parsed, pending.baseUrl);
        return read?.filter((declaration: Declaration) => declaration.value.kind !== "pending" && declaration.value.kind !== "custom");
    }

    customValue(declared: CustomPropertyValue, name: string, typed: boolean, host: SubstitutionHost): CustomValue | null {
        // CSS Values 5 §8.1: random() is a math function, resolved where the value is parsed as a property or by a registered syntax.
        const scope: Scope = { host, property:name, baseUrl: declared.baseUrl, namespaces: declared.namespaces, random: typed };
        const result: Substituted | undefined = this.substitute(this.syntax.tokens(declared.text), scope);
        return result === undefined ? null : this.makeValue(this.syntax.serialize(this.syntax.trim(result.tokens)), result.base);
    }

    containerQuery(query: string, host: SubstitutionHost, horizontal: boolean, size?: Size): TriState {
        // CSS Conditional 5 §5.4: a <container-query> evaluated against the selected query container, whose content box and
        // writing mode the size features need.
        const scope: Scope = { host, property:"", baseUrl: "about:blank", namespaces: DeclarationReader.NO_NAMESPACES, random: true };
        return this.booleanExpression(this.syntax.trim(this.syntax.tokens(query)), (unit: ReadonlyArray<Token>) => this.containerTest(unit, scope, horizontal, size)) ?? "unknown";
    }

    sizeAxes(query: string): Array<ContainerAxis> {
        // CSS Conditional 5 §5.4: the query container must accept size queries on every axis that the size features of
        // the query measure; what is inside style() is not a size feature.
        const axes: Array<ContainerAxis> = [];
        const tokens: Array<Token> = this.syntax.tokens(query);
        for (let index: number = 0; index < tokens.length; index++) {
            if (tokens[index].type === tokenTypes.Function) {
                index = this.syntax.closing(tokens, index);
            } else if (tokens[index].type === tokenTypes.Ident) {
                const feature: ReadonlyArray<ContainerAxis> | undefined = SIZE_FEATURES.get(this.asciiCase.foldLower(tokens[index].text).replace(/^(?:min|max)-/, ""));
                if (feature !== undefined) {
                    axes.push(...feature);
                }
            }
        }
        return axes;
    }

    private containerTest(unit: ReadonlyArray<Token>, scope: Scope, horizontal: boolean, size?: Size): TriState {
        if (unit[0].type === tokenTypes.LeftParenthesis) {
            const inner: Array<Token> = this.syntax.trim(unit.slice(1, unit.length - 1));
            const first: Token | undefined = inner[0];
            if (first !== undefined && (first.type === tokenTypes.LeftParenthesis || first.type === tokenTypes.Function
                || (first.type === tokenTypes.Ident && this.asciiCase.foldLower(first.text) === "not"))) {
                return this.booleanExpression(inner, (nested: ReadonlyArray<Token>) => this.containerTest(nested, scope, horizontal, size)) ?? "unknown";
            }
            return this.sizeFeature(inner, scope, horizontal, size);
        }
        if (unit[0].type !== tokenTypes.Function) {
            return "unknown";
        }
        // A scroll-state() query is unknown, like every query about scrolling: a page does not scroll.
        return this.syntax.functionName(unit[0]) === "style" ? this.styleQuery(this.syntax.trim(unit.slice(1, unit.length - 1)), scope) : "unknown";
    }

    private sizeFeature(tokens: ReadonlyArray<Token>, scope: Scope, horizontal: boolean, size?: Size): TriState {
        // CSS Conditional 5 §6.1: "The syntax of a <size-feature> is the same as for a media feature", and the features
        // measure the content box of the query container; without that box the result is unknown.
        if (size === undefined) {
            return "unknown";
        }
        const measure: (name: string) => [number, string] | undefined = (name: string): [number, string] | undefined => {
            switch (name) {
                case "width":
                    return [size.width, "length"];
                case "height":
                    return [size.height, "length"];
                case "inline-size":
                    return [horizontal ? size.width : size.height, "length"];
                case "block-size":
                    return [horizontal ? size.height : size.width, "length"];
                case "aspect-ratio":
                    return [size.width / size.height, "number"];
                default:
                    return undefined;
            }
        };
        const range: [Array<Array<Token>>, Array<string>] | undefined = this.rangeParts(tokens);
        if (range !== undefined) {
            const numbers: Array<[number, string]> = [];
            for (const value of range[0]) {
                const trimmed: Array<Token> = this.syntax.trim(value);
                const name: string | undefined = trimmed.length === 1 && trimmed[0].type === tokenTypes.Ident ? this.asciiCase.foldLower(trimmed[0].text) : undefined;
                const number: [number, string] | undefined = (name === undefined ? undefined : measure(name)) ?? this.featureValue(trimmed, scope);
                if (number === undefined || (numbers.length > 0 && !this.comparable(numbers[0], number))) {
                    return "unknown";
                }
                numbers.push(number);
            }
            return range[1].every((comparison: string, index: number) => this.compare(numbers[index][0], comparison, numbers[index + 1][0])) ? "true" : "false";
        }
        const parts: Array<Array<Token>> = this.syntax.split(tokens, tokenTypes.Colon);
        const head: Array<Token> = this.syntax.trim(parts[0]);
        const feature: string | undefined = head.length === 1 && head[0].type === tokenTypes.Ident ? this.asciiCase.foldLower(head[0].text) : undefined;
        const value: Array<Token> | undefined = parts.length > 1 ? this.syntax.trim(tokens.slice(parts[0].length + 1)) : undefined;
        if (feature === "orientation") {
            // §6.1.6: portrait "when the value of the height container feature is greater than or equal to" the width.
            const keyword: string | undefined = value !== undefined && value.length === 1 && value[0].type === tokenTypes.Ident ? this.asciiCase.foldLower(value[0].text) : undefined;
            if (value === undefined) {
                return "true";
            }
            return keyword !== "portrait" && keyword !== "landscape" ? "unknown" : ((keyword === "portrait") === (size.height >= size.width) ? "true" : "false");
        }
        const limit: string = feature === undefined ? "" : (feature.startsWith("min-") ? ">=" : (feature.startsWith("max-") ? "<=" : "="));
        const actual: [number, string] | undefined = feature === undefined ? undefined : measure(limit === "=" ? feature : feature.substring(4));
        if (actual === undefined) {
            return "unknown";
        }
        if (value === undefined) {
            // Media Queries 5 §2.4.2: in a boolean context a feature is true when its value is not zero.
            return limit !== "=" ? "unknown" : (actual[0] !== 0 ? "true" : "false");
        }
        const expected: [number, string] | undefined = this.featureValue(value, scope);
        if (expected === undefined || !this.comparable(actual, expected)) {
            return "unknown";
        }
        return this.compare(actual[0], limit, expected[0]) ? "true" : "false";
    }

    private featureValue(tokens: ReadonlyArray<Token>, scope: Scope): [number, string] | undefined {
        // CSS Conditional 5 §6.1: relative units and custom properties in the condition "are evaluated based on the computed
        // values of the query container"; a <ratio> is one number, or two with a solidus between them.
        const substituted: Substituted | undefined = this.substitute(tokens, { ...scope, random: true });
        if (substituted === undefined) {
            return undefined;
        }
        const terms: Array<Array<Token>> = this.ratioTerms(substituted.tokens);
        if (terms.length > 2) {
            return undefined;
        }
        const first: [number, string] | undefined = scope.host.numeric(this.syntax.serialize(this.syntax.trim(terms[0])));
        if (terms.length === 1) {
            return first;
        }
        const second: [number, string] | undefined = scope.host.numeric(this.syntax.serialize(this.syntax.trim(terms[1])));
        return first === undefined || second === undefined || first[1] !== "number" || second[1] !== "number" ? undefined : [first[0] / second[0], "number"];
    }

    private ratioTerms(tokens: ReadonlyArray<Token>): Array<Array<Token>> {
        const terms: Array<Array<Token>> = [[]];
        let depth: number = 0;
        for (const token of tokens) {
            depth += OPENERS.has(token.type) ? 1 : (CLOSERS.has(token.type) ? -1 : 0);
            if (depth === 0 && token.type === tokenTypes.Delim && token.text === "/") {
                terms.push([]);
            } else {
                terms[terms.length - 1].push(token);
            }
        }
        return terms;
    }

    private comparable(first: [number, string], second: [number, string]): boolean {
        // CSS Values 4 §6: "For zero lengths the unit identifier is optional".
        return first[1] === second[1] || (first[1] === "length" && second[1] === "number" && second[0] === 0)
            || (second[1] === "length" && first[1] === "number" && first[0] === 0);
    }

    private substitute(tokens: ReadonlyArray<Token>, scope: Scope): Substituted | undefined {
        // CSS Values 5 Appendix A: each arbitrary substitution function is replaced by its result, or by its fallback when the
        // result is the guaranteed-invalid value, until none is left; a UA-defined limit stops a value that grows without bound.
        let current: Array<Token> = [...tokens];
        let bases: Map<number, string> | undefined;
        let found: boolean = true;
        while (found) {
            found = false;
            const output: Array<Token> = [];
            let outputBases: Map<number, string> | undefined;
            for (let index: number = 0; index < current.length; index++) {
                const token: Token = current[index];
                if (!this.syntax.isSubstitution(token)) {
                    const kept: string | undefined = bases?.get(index);
                    if (kept !== undefined) {
                        outputBases = outputBases ?? new Map<number, string>();
                        outputBases.set(output.length, kept);
                    }
                    output.push(token);
                    continue;
                }
                found = true;
                const close: number = this.syntax.closing(current, index);
                const resolved: Resolved | undefined = this.resolve(this.syntax.functionName(token), current.slice(index + 1, close), scope);
                const replacement: ReadonlyArray<Token> | undefined = resolved === undefined ? undefined : (resolved.result ?? resolved.fallback);
                if (resolved === undefined || replacement === undefined) {
                    return undefined;
                }
                // A fallback is text of the stylesheet, whatever function it belongs to.
                const base: string | undefined = resolved.result === undefined ? undefined : resolved.base;
                for (const item of replacement) {
                    if (base !== undefined) {
                        outputBases = outputBases ?? new Map<number, string>();
                        outputBases.set(output.length, base);
                    }
                    output.push(item);
                }
                index = close;
            }
            if (output.length > MAXIMUM_TOKENS) {
                return undefined;
            }
            current = output;
            bases = outputBases;
        }
        let base: string | undefined;
        if (bases !== undefined) {
            // The map is filled in the order of the tokens, so its first value is the base of the first token that has one.
            for (const value of bases.values()) {
                base = value;
                break;
            }
            this.resolveDocumentUrls(current, bases);
        }
        if (!scope.random) {
            return this.makeSubstituted(current, base);
        }
        const resolved: Array<Token> | undefined = this.resolveRandom(current, scope);
        return resolved === undefined ? undefined : this.makeSubstituted(resolved, base);
    }

    private resolveDocumentUrls(tokens: Array<Token>, bases: ReadonlyMap<number, string>): void {
        // CSS Values 5 §7.7.2 keeps attr() out of URLs so that a third-party stylesheet cannot send page data away; a PDF is made
        // from the author's own files, so the URL is taken, relative to the base of the element that has the attribute.
        const urlFunctions: Array<boolean> = [];
        for (let index: number = 0; index < tokens.length; index++) {
            const token: Token = tokens[index];
            const base: string | undefined = bases.get(index);
            if (OPENERS.has(token.type)) {
                urlFunctions.push(token.type === tokenTypes.Function && URL_FUNCTIONS.has(this.syntax.functionName(token)));
            } else if (CLOSERS.has(token.type)) {
                urlFunctions.pop();
            } else if (base !== undefined && token.type === tokenTypes.Url) {
                tokens[index] = { type: token.type, text: cssUrl.encode(this.absolute(cssUrl.decode(token.text), base)) };
            } else if (base !== undefined && token.type === tokenTypes.String && urlFunctions[urlFunctions.length - 1] === true) {
                tokens[index] = { type: token.type, text: cssString.encode(this.absolute(cssString.decode(token.text), base)) };
            }
        }
    }

    private absolute(reference: string, base: string): string {
        // CSS Values 4 §4.5.1: a fragment-only URL stays as it is.
        if (reference.length === 0 || reference.startsWith("#")) {
            return reference;
        }
        return BaseUrls.resolved(reference, base) ?? reference;
    }

    private resolve(name: string, contents: ReadonlyArray<Token>, scope: Scope): Resolved | undefined {
        const args: Array<Array<Token>> | undefined = this.syntax.arguments(name, contents);
        if (args === undefined) {
            return undefined;
        }
        switch (name) {
            case "var":
                return this.resolveVar(args, scope);
            case "env":
                return this.resolveEnv(args);
            case "inherit":
                return this.resolveInherit(args, scope);
            case "attr":
                return this.resolveAttr(args, scope);
            case "if":
                return this.resolveIf(args, scope);
            case "random-item":
                return this.resolveRandomItem(args, scope);
            default:
                return this.resolveDashed(name, args, scope);
        }
    }

    private resolveVar(args: ReadonlyArray<ReadonlyArray<Token>>, scope: Scope): Resolved {
        // CSS Variables 1 §3: the computed value of the custom property, and the fallback if one is given.
        const value: CustomValue | null = this.lookup(args[0][0].text, scope);
        return this.makeResolved(value === null ? undefined : this.syntax.tokens(value.text), args[1], value?.base);
    }

    private resolveEnv(args: ReadonlyArray<ReadonlyArray<Token>>): Resolved {
        // CSS Environment Variables 1 §3: a variable not recognized, or with indices it does not have, takes the fallback.
        const value: string | undefined = args[0].length === 1 ? ENVIRONMENT.get(args[0][0].text) : undefined;
        return this.makeResolved(value === undefined ? undefined : this.syntax.tokens(value), args[1]);
    }

    private resolveInherit(args: ReadonlyArray<ReadonlyArray<Token>>, scope: Scope): Resolved {
        // CSS Values 5 §7.6: the inherited value of the custom property, and the fallback if one is given.
        const name: string = args[0][0].text;
        const value: CustomValue | null = scope.frame === undefined ? scope.host.inherited(name) : this.frameInherited(scope.frame, name, scope);
        return this.makeResolved(value === null ? undefined : this.syntax.tokens(value.text), args[1], value?.base);
    }

    private resolveAttr(args: ReadonlyArray<ReadonlyArray<Token>>, scope: Scope): Resolved | undefined {
        // CSS Values 5 §7.7.1: the attribute as a <string> without a syntax, or parsed with the syntax; without a syntax the
        // fallback defaults to the empty string. What attr() produces carries the base of its element, for the URLs made of it.
        const parsed: { local: string; prefix?: string; syntax?: string } | undefined = this.syntax.attrName(args[0]);
        if (parsed === undefined) {
            return undefined;
        }
        const namespace: string | undefined = parsed.prefix === undefined ? undefined : scope.namespaces.get(this.escaping.unescape(parsed.prefix));
        if (parsed.prefix !== undefined && namespace === undefined) {
            return undefined;
        }
        const syntax: string | undefined = parsed.syntax;
        const fallback: ReadonlyArray<Token> | undefined = args[1] ?? (syntax === undefined ? [{ type: tokenTypes.String, text: "\"\"" }] : undefined);
        const element: XMLElement | undefined = scope.host.element;
        const value: string | undefined = this.attributeValue(this.escaping.unescape(parsed.local), element, namespace);
        // SVG 2 has no xml:base, so an element of an SVG file has the base of its file.
        const base: string = this.bases.of(element instanceof SourceElement ? element : undefined);
        if (value === undefined) {
            return this.makeResolved(undefined, fallback, base);
        }
        if (syntax === undefined) {
            return this.makeResolved([{ type: tokenTypes.String, text: cssString.encode(value) }], fallback, base);
        }
        if (syntax === URL_TYPE) {
            return this.makeResolved([{ type: tokenTypes.Url, text: cssUrl.encode(value) }], fallback, base);
        }
        return this.makeResolved(this.parseWithSyntax(value, syntax, parsed.local, scope), fallback, base);
    }

    private parseWithSyntax(value: string, syntax: string, attribute: string, scope: Scope): Array<Token> | undefined {
        // CSS Values 5 §3.3.1, "parse with a <syntax>": arbitrary substitution functions in the value are substituted first,
        // and the first component of the syntax that matches gives the result.
        const key: string = "attribute|" + attribute;
        if (!scope.host.enter(key)) {
            return undefined;
        }
        const substituted: Substituted | undefined = this.substitute(this.syntax.tokens(value), { ...scope, random: false });
        if (scope.host.leave(key) || substituted === undefined) {
            return undefined;
        }
        const tokens: Array<Token> = this.syntax.trim(substituted.tokens);
        return this.matchesSyntax(syntax, this.syntax.serialize(tokens)) ? tokens : undefined;
    }

    private attributeValue(local: string, element?: XMLElement, namespace?: string): string | undefined {
        // Namespaces in XML 1.0 §6.2: an unprefixed attribute is in no namespace, a prefixed one in the namespace of its prefix.
        if (element === undefined) {
            return undefined;
        }
        if (namespace === undefined) {
            return element.getAttribute(local)?.getValue();
        }
        for (const attribute of element.getAttributes()) {
            const name: string = attribute.getName();
            const colon: number = name.indexOf(":");
            if (colon !== -1 && name.substring(colon + 1) === local && this.prefixes.get(name.substring(0, colon)) === namespace) {
                return attribute.getValue();
            }
        }
        return undefined;
    }

    private resolveIf(args: ReadonlyArray<ReadonlyArray<Token>>, scope: Scope): Resolved {
        // CSS Values 5 §7.3: the value of the first condition that is true, or nothing.
        for (let index: number = 0; index + 1 < args.length; index += 2) {
            if (this.condition(args[index], scope) === "true") {
                return { result: [...args[index + 1]] };
            }
        }
        return { result: [] };
    }

    private condition(tokens: ReadonlyArray<Token>, scope: Scope): TriState | undefined {
        // CSS Values 5 §7.3 and Appendix B: else, or a <boolean-expr> of supports(), media() and style() in Kleene logic.
        if (tokens.length === 1 && tokens[0].type === tokenTypes.Ident && this.asciiCase.foldLower(tokens[0].text) === "else") {
            return "true";
        }
        return this.booleanExpression(tokens, (unit: ReadonlyArray<Token>) => this.ifTest(unit, scope));
    }

    private ifTest(unit: ReadonlyArray<Token>, scope: Scope): TriState | undefined {
        if (unit[0].type === tokenTypes.LeftParenthesis) {
            return this.condition(this.syntax.trim(unit.slice(1, unit.length - 1)), scope);
        }
        if (unit[0].type !== tokenTypes.Function) {
            return undefined;
        }
        const contents: Array<Token> = this.syntax.trim(unit.slice(1, unit.length - 1));
        switch (this.syntax.functionName(unit[0])) {
            case "media": {
                // CSS Values 5 §7.3: media( <media-query> ), one query.
                const list: MediaQueryList | undefined = this.mediaList(this.syntax.serialize(contents));
                return list === undefined || list.children.size !== 1 ? "unknown" : this.conditions.evaluate(list);
            }
            case "supports":
                return this.supports.holds(this.syntax.serialize(contents), scope.namespaces) ? "true" : "false";
            case "style":
                return this.styleQuery(contents, scope);
            default:
                return "unknown";
        }
    }

    private styleQuery(tokens: ReadonlyArray<Token>, scope: Scope): TriState {
        // CSS Conditional 5 §5.4: <style-query> = not <style-in-parens> | <style-in-parens> [ [ and | or ] <style-in-parens> ]* |
        // <style-feature>, where <general-enclosed> is unknown.
        const units: Array<Array<Token>> = this.components(tokens);
        const first: Token | undefined = units[0]?.[0];
        const logical: boolean = first !== undefined && (first.type === tokenTypes.LeftParenthesis || (first.type === tokenTypes.Ident && this.asciiCase.foldLower(first.text) === "not"));
        if (!logical) {
            return this.styleFeature(tokens, scope);
        }
        return this.booleanExpression(tokens, (unit: ReadonlyArray<Token>): TriState => {
            if (unit[0].type !== tokenTypes.LeftParenthesis) {
                return "unknown";
            }
            return this.styleQuery(this.syntax.trim(unit.slice(1, unit.length - 1)), scope);
        }) ?? "unknown";
    }

    private styleFeature(tokens: ReadonlyArray<Token>, scope: Scope): TriState {
        // CSS Conditional 5 §6.2: a declaration, a property name alone, or a range; revert and revert-layer make it false.
        if (tokens.some((token: Token) => token.type === tokenTypes.Delim && COMPARISONS.has(token.text))) {
            return this.styleRange(tokens, scope);
        }
        const parts: Array<Array<Token>> = this.syntax.split(tokens, tokenTypes.Colon);
        const head: Array<Token> = this.syntax.trim(parts[0]);
        if (head.length !== 1 || head[0].type !== tokenTypes.Ident) {
            return "unknown";
        }
        const name: string = head[0].text.startsWith("--") ? head[0].text : this.asciiCase.foldLower(head[0].text);
        const value: Array<Token> | undefined = parts.length > 1 ? this.syntax.trim(tokens.slice(parts[0].length + 1)) : undefined;
        const keyword: string | undefined = value !== undefined && value.length === 1 && value[0].type === tokenTypes.Ident ? this.asciiCase.foldLower(value[0].text) : undefined;
        if (keyword === "revert" || keyword === "revert-layer") {
            return "false";
        }
        if (!name.startsWith("--")) {
            const substituted: Substituted | undefined = value === undefined ? undefined : this.substitute(value, { ...scope, random: true });
            if (value !== undefined && substituted === undefined) {
                return "false";
            }
            return scope.host.matches(name, substituted === undefined ? undefined : this.syntax.serialize(substituted.tokens));
        }
        const actual: CustomValue | null = this.lookup(name, scope);
        const syntax: string | undefined = scope.frame === undefined ? scope.host.registration(name) : undefined;
        const initial: CustomValue | null = scope.frame === undefined ? scope.host.initialCustom(name) : null;
        if (value === undefined) {
            return this.sameCustom(actual, initial) ? "false" : "true";
        }
        let expected: CustomValue | null;
        if (keyword === "initial") {
            expected = initial;
        } else if (keyword === "inherit") {
            expected = scope.frame === undefined ? scope.host.inherited(name) : this.frameInherited(scope.frame, name, scope);
        } else if (keyword === "unset") {
            expected = scope.frame !== undefined ? this.frameInherited(scope.frame, name, scope) : (scope.host.inherits(name) ? scope.host.inherited(name) : initial);
        } else {
            const substituted: Substituted | undefined = this.substitute(value, { ...scope, random: syntax !== undefined });
            const text: string | undefined = substituted === undefined ? undefined : this.syntax.serialize(this.syntax.trim(substituted.tokens));
            const computed: string | undefined = text === undefined || syntax === undefined ? text : scope.host.typed(syntax, text, scope.baseUrl);
            expected = computed === undefined ? null : { text: computed };
        }
        return this.sameCustom(actual, expected) ? "true" : "false";
    }

    private styleRange(tokens: ReadonlyArray<Token>, scope: Scope): TriState {
        // CSS Conditional 5 §6.2: each value is substituted, a custom property name as if in var(), and parsed as a number,
        // percentage or dimension; values of different types make the range false.
        const range: [Array<Array<Token>>, Array<string>] | undefined = this.rangeParts(tokens);
        if (range === undefined) {
            return "unknown";
        }
        const comparisons: Array<string> = range[1];
        const numbers: Array<[number, string]> = [];
        for (const value of range[0]) {
            const trimmed: Array<Token> = this.syntax.trim(value);
            const name: string | undefined = trimmed.length === 1 && trimmed[0].type === tokenTypes.Ident && trimmed[0].text.startsWith("--") ? trimmed[0].text : undefined;
            const custom: CustomValue | null = name === undefined ? null : this.lookup(name, scope);
            const substituted: Substituted | undefined = name !== undefined ? (custom === null ? undefined : this.makeSubstituted(this.syntax.tokens(custom.text), custom.base))
                : this.substitute(trimmed, { ...scope, random: true });
            const number: [number, string] | undefined = substituted === undefined ? undefined : scope.host.numeric(this.syntax.serialize(substituted.tokens));
            if (number === undefined) {
                return "false";
            }
            numbers.push(number);
        }
        const type: string = numbers.find((number: [number, string]) => number[1] !== "number" || number[0] !== 0)?.[1] ?? "number";
        if (!numbers.every((number: [number, string]) => number[1] === type || (number[1] === "number" && number[0] === 0 && type === "length"))) {
            return "false";
        }
        for (let index: number = 0; index < comparisons.length; index++) {
            if (!this.compare(numbers[index][0], comparisons[index], numbers[index + 1][0])) {
                return "false";
            }
        }
        return "true";
    }

    private rangeParts(tokens: ReadonlyArray<Token>): [Array<Array<Token>>, Array<string>] | undefined {
        // Media Queries 5 §2.4.3: one comparison between two values, or two that point the same way between three.
        const values: Array<Array<Token>> = [[]];
        const comparisons: Array<string> = [];
        for (let index: number = 0; index < tokens.length; index++) {
            const token: Token = tokens[index];
            if (token.type === tokenTypes.Delim && COMPARISONS.has(token.text)) {
                const equals: boolean = token.text !== "=" && tokens[index + 1]?.type === tokenTypes.Delim && tokens[index + 1].text === "=";
                comparisons.push(token.text + (equals ? "=" : ""));
                values.push([]);
                index += equals ? 1 : 0;
            } else {
                values[values.length - 1].push(token);
            }
        }
        const valid: boolean = values.length === 2 || (values.length === 3 && comparisons[0][0] === comparisons[1][0] && comparisons[0] !== "=");
        return valid ? [values, comparisons] : undefined;
    }

    private compare(a: number, comparison: string, b: number): boolean {
        switch (comparison) {
            case "<":
                return a < b;
            case "<=":
                return a <= b;
            case ">":
                return a > b;
            case ">=":
                return a >= b;
            default:
                return a === b;
        }
    }

    private booleanExpression(tokens: ReadonlyArray<Token>, test: (unit: ReadonlyArray<Token>) => TriState | undefined): TriState | undefined {
        // CSS Values 5 Appendix B: not, and and or, which are not mixed without parentheses.
        const units: Array<Array<Token>> = this.components(tokens);
        if (units.length === 0) {
            return undefined;
        }
        const word: (unit: Array<Token>) => string | undefined = (unit: Array<Token>): string | undefined =>
            unit.length === 1 && unit[0].type === tokenTypes.Ident ? this.asciiCase.foldLower(unit[0].text) : undefined;
        if (word(units[0]) === "not") {
            const negated: TriState | undefined = units.length === 2 ? test(units[1]) : undefined;
            return negated === undefined ? undefined : (negated === "unknown" ? "unknown" : (negated === "true" ? "false" : "true"));
        }
        const operator: string | undefined = units.length > 1 ? word(units[1]) : undefined;
        const states: Array<TriState> = [];
        for (let index: number = 0; index < units.length; index++) {
            if (index % 2 === 1) {
                if (word(units[index]) !== operator || (operator !== "and" && operator !== "or")) {
                    return undefined;
                }
                continue;
            }
            const state: TriState | undefined = test(units[index]);
            if (state === undefined) {
                return undefined;
            }
            states.push(state);
        }
        if (units.length % 2 === 0) {
            return undefined;
        }
        const decisive: TriState = operator === "or" ? "true" : "false";
        if (states.includes(decisive)) {
            return decisive;
        }
        return states.includes("unknown") ? "unknown" : (operator === "or" ? "false" : "true");
    }

    private components(tokens: ReadonlyArray<Token>): Array<Array<Token>> {
        // The component values of a sequence, without the whitespace between them.
        const units: Array<Array<Token>> = [];
        for (let index: number = 0; index < tokens.length; index++) {
            if (tokens[index].type === tokenTypes.WhiteSpace) {
                continue;
            }
            const opens: boolean = [tokenTypes.Function, tokenTypes.LeftParenthesis, tokenTypes.LeftSquareBracket, tokenTypes.LeftCurlyBracket].includes(tokens[index].type);
            const close: number = opens ? this.syntax.closing(tokens, index) : index;
            units.push(tokens.slice(index, close + 1));
            index = close;
        }
        return units;
    }

    private resolveRandomItem(args: ReadonlyArray<ReadonlyArray<Token>>, scope: Scope): Resolved {
        // CSS Values 5 §8.2 and §8.3: one of the arguments, chosen by the random value of the random-caching key made of the
        // number of arguments, the <dashed-ident> and, with per-element, the element.
        const options: number = args.length - 1;
        const base: number = this.randomBase(["random-item", options, ...this.cachingKey(args[0], scope)]);
        const index: number = Math.min(Math.floor(base * options), options - 1);
        return { result: [...args[index + 1]] };
    }

    private resolveRandom(tokens: ReadonlyArray<Token>, scope: Scope): Array<Token> | undefined {
        // CSS Values 5 §8.1: each random() resolves to a value of its arguments' type.
        const output: Array<Token> = [];
        for (let index: number = 0; index < tokens.length; index++) {
            if (!this.syntax.isRandom(tokens[index])) {
                output.push(tokens[index]);
                continue;
            }
            const close: number = this.syntax.closing(tokens, index);
            const contents: Array<Token> | undefined = this.resolveRandom(tokens.slice(index + 1, close), scope);
            const args: Array<Array<Token>> | undefined = contents === undefined ? undefined : this.syntax.randomArguments(contents);
            const value: Array<Token> | undefined = args === undefined ? undefined : this.randomValue(args, scope);
            if (value === undefined) {
                return undefined;
            }
            output.push(...value);
            index = close;
        }
        return output;
    }

    private randomValue(args: ReadonlyArray<ReadonlyArray<Token>>, scope: Scope): Array<Token> | undefined {
        // CSS Values 5 §8.1, §8.1.1 and §8.3: the random-caching key holds the minimum, maximum and step, the <dashed-ident> and,
        // with per-element, the element; a maximum below the minimum counts as the minimum.
        const numbers: Array<[number, string]> = [];
        for (let index: number = 1; index < args.length; index++) {
            const sum: [number, string] | undefined = scope.host.numeric(this.syntax.serialize(args[index]));
            if (sum === undefined) {
                return this.unresolvedRandom(args, scope);
            }
            numbers.push(sum);
        }
        if (!numbers.every((sum: [number, string]) => sum[1] === numbers[0][1])) {
            return undefined;
        }
        const base: number = this.randomBase(["random", ...numbers.map((sum: [number, string]) => sum[0]), numbers.length < 3 ? null : 0, ...this.cachingKey(args[0], scope)]);
        const minimum: number = numbers[0][0];
        const maximum: number = Math.max(minimum, numbers[1][0]);
        const step: number | undefined = numbers[2]?.[0];
        let value: number;
        if (!Number.isFinite(minimum) || !Number.isFinite(numbers[1][0])) {
            value = Number.NaN;
        } else if (step === undefined) {
            value = minimum + base * (maximum - minimum);
        } else if (!Number.isFinite(step) || step <= 0) {
            value = minimum;
        } else {
            value = minimum + Math.floor(base * (Math.floor((maximum - minimum) / step) + 1)) * step;
        }
        return this.syntax.tokens(this.numberText(value, numbers[0][1]));
    }

    private unresolvedRandom(args: ReadonlyArray<ReadonlyArray<Token>>, scope: Scope): Array<Token> {
        // A calculation that resolves only at layout, such as a percentage of the containing block, keeps the random value in a
        // calc(); its random-caching key holds the calculations as written.
        const texts: Array<string> = args.slice(1).map((sum: ReadonlyArray<Token>) => this.syntax.serialize(sum));
        const base: string = String(this.randomBase(["random", ...texts, ...this.cachingKey(args[0], scope)]));
        const minimum: string = "(" + texts[0] + ")";
        const maximum: string = "max(" + minimum + ", (" + texts[1] + "))";
        if (texts.length < 3) {
            return this.syntax.tokens("calc(" + minimum + " + " + base + " * (" + maximum + " - " + minimum + "))");
        }
        const step: string = "(" + texts[2] + ")";
        return this.syntax.tokens("calc(" + minimum + " + round(down, " + base + " * (round(down, (" + maximum + " - " + minimum + ") / " + step + ") + 1)) * " + step + ")");
    }

    private cachingKey(options: ReadonlyArray<Token>, scope: Scope): Array<string | number | null> {
        // CSS Values 5 §8.3: the <dashed-ident>, or null, and with per-element a value unique to the element or pseudo-element.
        const words: Array<Token> = options.filter((token: Token) => token.type === tokenTypes.Ident);
        const name: Token | undefined = words.find((token: Token) => token.text.startsWith("--"));
        const element: XMLElement | undefined = scope.host.element;
        const perElement: boolean = words.some((token: Token) => this.asciiCase.foldLower(token.text) === "per-element");
        if (!perElement || element === undefined) {
            return [name?.text ?? null, null];
        }
        let key: number | undefined = this.elementKeys.get(element);
        if (key === undefined) {
            key = this.nextElementKey++;
            this.elementKeys.set(element, key);
        }
        return [name?.text ?? null, key + (scope.host.pseudoElement === undefined ? "" : "::" + scope.host.pseudoElement)];
    }

    private randomBase(key: ReadonlyArray<string | number | null>): number {
        // CSS Values 5 §8.3: functions with the same random-caching key resolve to the same value, and distinct keys to fresh ones.
        const text: string = JSON.stringify(key);
        let base: number | undefined = this.randomValues.get(text);
        if (base === undefined) {
            base = Math.random();
            this.randomValues.set(text, base);
        }
        return base;
    }

    private numberText(value: number, type: string): string {
        const unit: string = type === "number" ? "" : (type === "percentage" ? "%" : this.units.canonicalUnitOf(type as BaseType));
        if (Number.isFinite(value)) {
            return String(value) + unit;
        }
        const constant: string = Number.isNaN(value) ? "NaN" : (value > 0 ? "infinity" : "-infinity");
        return unit === "" ? "calc(" + constant + ")" : "calc(" + constant + " * 1" + unit + ")";
    }

    private resolveDashed(name: string, args: ReadonlyArray<ReadonlyArray<Token>>, scope: Scope): Resolved | undefined {
        // CSS Functions and Mixins §3: the arguments are substituted, and may be left as the guaranteed-invalid value.
        const rule: FunctionRule | undefined = this.functions.get(name);
        if (rule === undefined) {
            return undefined;
        }
        const result: Substituted | undefined = this.evaluateFunction(rule, args.map((arg: ReadonlyArray<Token>) => this.substitute(arg, scope)), scope);
        return result === undefined ? undefined : this.makeResolved(result.tokens, undefined, result.base);
    }

    private evaluateFunction(rule: FunctionRule, args: ReadonlyArray<Substituted | undefined>, scope: Scope): Substituted | undefined {
        // CSS Functions and Mixins §3.1: the body applies to a hypothetical child of the calling context; the parameters take
        // their arguments or their defaults, with their types, and in the body the local variables override them.
        const key: string = "function|" + this.functionKey(rule);
        if (!scope.host.enter(key)) {
            return undefined;
        }
        let result: Substituted | undefined;
        if (args.length <= rule.parameters.length) {
            const frame: Frame = {
                rule, callingProperty: scope.property, parameters: new Map<string, CustomValue | null>(), locals: new Map<string, FunctionDescriptor>(),
                computed: new Map<string, CustomValue | null>()
            };
            if (scope.frame !== undefined) {
                frame.parent = scope.frame;
            }
            const inner: Scope = { host: scope.host, frame, property: scope.property, baseUrl: rule.baseUrl, namespaces: rule.namespaces, random: false };
            rule.parameters.forEach((parameter: FunctionParameter, index: number) => {
                const arg: Substituted | undefined = args[index];
                let value: CustomValue | null = arg === undefined ? null : this.typedValue(parameter.type, arg, rule, scope.host);
                if (value === null && parameter.defaultValue !== undefined) {
                    value = this.localValue(parameter.name, parameter.defaultValue, parameter.type, { ...inner, property: parameter.name });
                }
                frame.parameters.set(parameter.name, value);
            });
            for (const descriptor of rule.body) {
                // CSS Functions and Mixins §4.1: @container in the body queries the containers of the calling element.
                if (descriptor.containers.length === 0 || scope.host.containersHold(descriptor.containers)) {
                    frame.locals.set(descriptor.name, descriptor);
                }
            }
            result = this.functionResult(frame, inner);
        }
        return scope.host.leave(key) ? undefined : result;
    }

    private functionResult(frame: Frame, scope: Scope): Substituted | undefined {
        // CSS Functions and Mixins §3.1: result is checked against the return type, and a CSS-wide keyword in it stays as it is.
        const descriptor: FunctionDescriptor | undefined = frame.locals.get("result");
        if (descriptor === undefined) {
            return undefined;
        }
        if (DeclarationReader.CSS_WIDE_KEYWORDS.has(this.asciiCase.foldLower(descriptor.text))) {
            return { tokens: this.syntax.tokens(descriptor.text) };
        }
        const key: string = "property|result|" + this.functionKey(frame.rule);
        if (!scope.host.enter(key)) {
            return undefined;
        }
        const typed: boolean = frame.rule.returnType !== SyntaxDefinition.UNIVERSAL;
        const substituted: Substituted | undefined = this.substitute(this.syntax.tokens(descriptor.text), { ...scope, property: "result", random: typed });
        const value: CustomValue | null = substituted === undefined ? null : this.typedValue(frame.rule.returnType, substituted, frame.rule, scope.host);
        return scope.host.leave(key) || value === null ? undefined : this.makeSubstituted(this.syntax.tokens(value.text), value.base);
    }

    private typedValue(type: string, value: Substituted, rule: FunctionRule, host: SubstitutionHost): CustomValue | null {
        // CSS Functions and Mixins §3.1: a typed parameter or result computes as a registered custom property of that syntax.
        const text: string = this.syntax.serialize(this.syntax.trim(value.tokens));
        if (type === SyntaxDefinition.UNIVERSAL) {
            return this.makeValue(text, value.base);
        }
        const computed: string | undefined = host.typed(type, text, rule.baseUrl);
        return computed === undefined ? null : this.makeValue(computed, value.base);
    }

    private makeValue(text: string, base?: string): CustomValue {
        return base === undefined ? { text } : { text, base };
    }

    private makeSubstituted(tokens: Array<Token>, base?: string): Substituted {
        return base === undefined ? { tokens } : { tokens, base };
    }

    private makeResolved(result?: Array<Token>, fallback?: ReadonlyArray<Token>, base?: string): Resolved {
        const resolved: Resolved = {};
        if (result !== undefined) {
            resolved.result = result;
        }
        if (fallback !== undefined) {
            resolved.fallback = fallback;
        }
        if (base !== undefined) {
            resolved.base = base;
        }
        return resolved;
    }

    private lookup(name: string, scope: Scope): CustomValue | null {
        return scope.frame === undefined ? scope.host.custom(name) : this.frameValue(scope.frame, name, scope);
    }

    private frameValue(frame: Frame, name: string, scope: Scope): CustomValue | null {
        // CSS Functions and Mixins §2.3 and §3.1: local variables shadow parameters, which shadow the calling context's custom
        // properties; in the body every registration has the universal syntax.
        const known: CustomValue | null | undefined = frame.computed.get(name);
        if (known !== undefined) {
            return known;
        }
        const local: FunctionDescriptor | undefined = name === "result" ? undefined : frame.locals.get(name);
        if (local === undefined) {
            return frame.parameters.has(name) ? frame.parameters.get(name) ?? null : this.frameInherited(frame, name, scope);
        }
        const key: string = "property|" + name + "|" + this.functionKey(frame.rule);
        if (!scope.host.enter(key)) {
            return null;
        }
        const inner: Scope = { host: scope.host, frame, property: name, baseUrl: frame.rule.baseUrl, namespaces: frame.rule.namespaces, random: false };
        let value: CustomValue | null = this.localValue(name, local.text, SyntaxDefinition.UNIVERSAL, inner);
        if (scope.host.leave(key)) {
            value = null;
        }
        frame.computed.set(name, value);
        return value;
    }

    private localValue(name: string, text: string, type: string, scope: Scope): CustomValue | null {
        // CSS Functions and Mixins §3.1: initial is the parameter's value, inherit the calling context's value, and the other
        // CSS-wide keywords the guaranteed-invalid value.
        const frame: Frame = scope.frame as Frame;
        const keyword: string = this.asciiCase.foldLower(text.trim());
        if (keyword === "initial") {
            return frame.parameters.get(name) ?? null;
        }
        if (keyword === "inherit") {
            return this.frameInherited(frame, name, scope);
        }
        if (DeclarationReader.CSS_WIDE_KEYWORDS.has(keyword)) {
            return null;
        }
        const typed: boolean = type !== SyntaxDefinition.UNIVERSAL;
        const substituted: Substituted | undefined = this.substitute(this.syntax.tokens(text), { ...scope, random: typed });
        return substituted === undefined ? null : this.typedValue(type, substituted, frame.rule, scope.host);
    }

    private frameInherited(frame: Frame, name: string, scope: Scope): CustomValue | null {
        // CSS Functions and Mixins §3.1: the inherited value of the calling context's property is the guaranteed-invalid value.
        if (name === frame.callingProperty) {
            return null;
        }
        return frame.parent === undefined ? scope.host.custom(name) : this.frameValue(frame.parent, name, scope);
    }

    private functionKey(rule: FunctionRule): string {
        return rule.name + "|" + rule.order;
    }

    private sameCustom(first: CustomValue | null, second: CustomValue | null): boolean {
        if (first === null || second === null) {
            return first === second;
        }
        return this.normalized(first.text) === this.normalized(second.text);
    }

    private normalized(text: string): string {
        return this.syntax.serialize(this.syntax.trim(this.syntax.tokens(text)).map((token: Token): Token => token.type === tokenTypes.WhiteSpace ? { type: token.type, text: " " } : token));
    }

    private matchesSyntax(grammar: string, text: string): boolean {
        // CSS Values 5 §3.3.1: the universal syntax takes any value.
        if (grammar === SyntaxDefinition.UNIVERSAL) {
            return true;
        }
        try {
            return this.table.lexer.match(grammar, text).matched !== null;
        } catch {
            return false;
        }
    }

    private mediaList(text: string): MediaQueryList | undefined {
        try {
            const list: CssNode = parse(text, { context: "mediaQueryList" });
            return list.type === "MediaQueryList" ? list : undefined;
        } catch {
            return undefined;
        }
    }
}
