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

import type { CssNode, Declaration as CssTreeDeclaration, FunctionNode, LexerMatchResult, Value } from "css-tree";
import { generate, List, parse, tokenize, tokenTypes, walk } from "css-tree";
import { BaseUrls } from "../pdf/BaseUrls.js";
import { AsciiCase } from "./AsciiCase.js";
import { CssIdentifierEscaping } from "./CssIdentifierEscaping.js";
import type { PropertyTable } from "./PropertyTable.js";
import type { Longhand, MatchNode } from "./ShorthandExpander.js";
import { ShorthandExpander } from "./ShorthandExpander.js";
import type { CssWideKeyword, Declaration, DeclaredValue, KeywordValue, ParsedValue, PendingSubstitution } from "./Stylesheet.js";
import type { Token } from "./SubstitutionSyntax.js";
import { SubstitutionSyntax } from "./SubstitutionSyntax.js";
import type { NumericType } from "./values/CalcTypes.js";
import { CalcTypes } from "./values/CalcTypes.js";
import type { CssValue } from "./values/CssValue.js";
import { CssValueParser } from "./values/CssValueParser.js";

const SUBSTITUTION_FUNCTIONS: ReadonlySet<string> = new Set<string>(["var", "env", "attr", "if", "inherit", "random-item"]);
const STRING_URL_FUNCTIONS: ReadonlySet<string> = new Set<string>(["src", "image", "image-set"]);
const POSITION_TRY_GROUPS: ReadonlySet<string> = new Set<string>(["inset", "margin", "size", "min-size", "max-size"]);
const POSITION_TRY_PROPERTIES: ReadonlySet<string> = new Set<string>(["justify-self", "align-self", "position-anchor", "position-area"]);

export class DeclarationReader {

    static readonly CSS_WIDE_KEYWORDS: ReadonlySet<string> = new Set<string>(["initial", "inherit", "unset", "revert", "revert-layer"]);
    static readonly NO_NAMESPACES: ReadonlyMap<string, string> = new Map<string, string>();

    private readonly table: PropertyTable;
    private readonly expander: ShorthandExpander;
    private readonly values: CssValueParser = new CssValueParser();
    private readonly asciiCase: AsciiCase = new AsciiCase();
    private readonly escaping: CssIdentifierEscaping = new CssIdentifierEscaping();
    private readonly syntax: SubstitutionSyntax = new SubstitutionSyntax();
    private readonly types: CalcTypes = new CalcTypes();

    constructor(table: PropertyTable) {
        this.table = table;
        this.expander = new ShorthandExpander(table);
    }

    read(declaration: CssTreeDeclaration, baseUrl: string, namespaces: ReadonlyMap<string, string>): Array<Declaration> | undefined {
        // CSS Anchor Positioning 1 §5: anchor-size() "is only allowed in the accepted @position-try properties (and is
        // otherwise invalid)", which are the inset, margin, sizing and self-alignment properties, position-anchor and position-area.
        const declarations: Array<Declaration> | undefined = this.readDeclaration(declaration, baseUrl, namespaces);
        return declarations?.some((read: Declaration) => !this.acceptsAnchors(read.property) && this.holdsAnchor(read.value)) === true ? undefined : declarations;
    }

    private acceptsAnchors(property: string): boolean {
        const group: string | undefined = this.table.definition(property)?.logicalPropertyGroup;
        return POSITION_TRY_PROPERTIES.has(property) || (group !== undefined && POSITION_TRY_GROUPS.has(group));
    }

    private holdsAnchor(value: DeclaredValue): boolean {
        if (value.kind === "toggle") {
            return value.values.some((item: ParsedValue | KeywordValue) => item.kind === "value" && this.values.anchored(item.value));
        }
        return value.kind === "value" && this.values.anchored(value.value);
    }

    private readDeclaration(declaration: CssTreeDeclaration, baseUrl: string, namespaces: ReadonlyMap<string, string>): Array<Declaration> | undefined {
        // CSS Syntax 3 §8.1 and CSS Cascade 5 §3: an invalid declaration is ignored as a whole; a valid shorthand
        // declares each of its longhands.
        const important: boolean = declaration.important !== false;
        if (declaration.property.startsWith("--")) {
            const text: string = this.textOf(declaration.value);
            return this.isValidCustomValue(text) ? [{ property: declaration.property, value: { kind: "custom", text: text.trim(), baseUrl, namespaces }, important }] : undefined;
        }
        const property: string = this.table.canonicalName(this.asciiCase.foldLower(declaration.property));
        const shorthand: boolean = this.expander.isShorthand(property);
        if (!shorthand && this.table.definition(property) === undefined) {
            return undefined;
        }
        const text: string = this.textOf(declaration.value).trim();
        const keyword: CssWideKeyword | undefined = this.wideKeyword(declaration.value);
        if (keyword !== undefined) {
            return this.targets(property, shorthand).map((target: string) => ({ property: target, value: { kind: "keyword", keyword }, important }));
        }
        const substitution: boolean = this.uses(declaration.value, (name: string) => name.startsWith("--") || SUBSTITUTION_FUNCTIONS.has(name));
        const random: boolean = this.uses(declaration.value, (name: string) => name === "random");
        if (substitution || random) {
            // CSS Values 5 Appendix A: syntactically valid arbitrary substitution functions make the value valid at parse time;
            // random() is resolved when the rule is applied, but a declaration it makes invalid is dropped now.
            if (!this.isValidCustomValue(text) || !this.syntax.isValid(text) || (!substitution && !this.validRandom(property, text, baseUrl, namespaces))) {
                return undefined;
            }
            const pending: PendingSubstitution = { kind: "pending", text, baseUrl, namespaces };
            if (shorthand) {
                pending.shorthand = property;
            }
            return this.targets(property, shorthand).map((target: string) => ({ property: target, value: pending, important }));
        }
        const tokens: Array<Token> = this.syntax.tokens(text);
        const whole: string | undefined = this.wholeValueName(tokens);
        if (whole !== undefined) {
            return this.readWholeValue(property, shorthand, whole, tokens, baseUrl, namespaces, important);
        }
        if (declaration.value.type !== "Value") {
            return undefined;
        }
        this.resolveUrls(declaration.value, baseUrl);
        const result: LexerMatchResult | undefined = this.table.matchProperty(property, declaration.value);
        if (result === undefined) {
            return undefined;
        }
        if (!shorthand) {
            const value: CssValue | undefined = this.values.parse(declaration.value);
            return value === undefined ? undefined : [{ property, value: { kind: "value", value }, important }];
        }
        if (this.expander.isIgnored(property)) {
            return undefined;
        }
        const longhands: Array<Longhand> | undefined = this.expander.expand(property, declaration.value, result.matched as MatchNode);
        if (longhands === undefined) {
            return undefined;
        }
        const declarations: Array<Declaration> = [];
        for (const longhand of longhands) {
            if (!this.expander.isShorthand(longhand.property)) {
                declarations.push({ property: longhand.property, value: this.declared(longhand.value), important });
            } else if (longhand.nodes === undefined) {
                declarations.push(...this.targets(longhand.property, true).map((target: string): Declaration => ({ property: target, value: { kind: "keyword", keyword: "initial" }, important })));
            } else {
                const nested: CssTreeDeclaration = {
                    type: "Declaration",
                    important: declaration.important,
                    property: longhand.property,
                    value: { type: "Value", children: new List<CssNode>().fromArray([...longhand.nodes]) }
                } as CssTreeDeclaration;
                const expanded: Array<Declaration> | undefined = this.read(nested, baseUrl, namespaces);
                if (expanded === undefined) {
                    return undefined;
                }
                declarations.push(...expanded);
            }
        }
        return declarations.length === 0 ? undefined : declarations;
    }

    private validRandom(property: string, text: string, baseUrl: string, namespaces: ReadonlyMap<string, string>): boolean {
        // The property's grammar is checked with each random() standing as calc() of its minimum, which has the same type.
        const standIn: Array<Token> | undefined = this.randomStandIn(this.syntax.tokens(text));
        if (standIn === undefined) {
            return false;
        }
        try {
            const parsed: CssTreeDeclaration = parse(property + ": " + this.syntax.serialize(standIn), { context: "declaration" }) as CssTreeDeclaration;
            return this.read(parsed, baseUrl, namespaces) !== undefined;
        } catch {
            return false;
        }
    }

    private randomStandIn(tokens: ReadonlyArray<Token>): Array<Token> | undefined {
        // CSS Values 5 §8.1: the arguments of random() have one consistent type.
        const result: Array<Token> = [];
        for (let index: number = 0; index < tokens.length; index++) {
            if (!this.syntax.isRandom(tokens[index])) {
                result.push(tokens[index]);
                continue;
            }
            const close: number = this.syntax.closing(tokens, index);
            const args: Array<Array<Token>> | undefined = this.syntax.randomArguments(tokens.slice(index + 1, close));
            if (args === undefined) {
                return undefined;
            }
            let type: NumericType | undefined;
            let minimum: Array<Token> | undefined;
            for (const sum of args.slice(1)) {
                const inner: Array<Token> | undefined = this.randomStandIn(sum);
                const sumType: NumericType | undefined = inner === undefined ? undefined : this.calculationType(this.syntax.serialize(inner));
                type = sumType === undefined ? undefined : (type === undefined ? sumType : this.types.add(type, sumType));
                if (type === undefined || inner === undefined) {
                    return undefined;
                }
                minimum = minimum ?? inner;
            }
            result.push(...this.syntax.tokens("calc(" + (minimum === undefined ? "" : this.syntax.serialize(minimum)) + ")"));
            index = close;
        }
        return result;
    }

    private calculationType(sum: string): NumericType | undefined {
        let value: CssValue | undefined;
        try {
            value = this.values.parse(parse("calc(" + sum + ")", { context: "value" }) as Value);
        } catch {
            return undefined;
        }
        return value !== undefined && value.kind === "calc" ? this.types.typeOf(value.root) : undefined;
    }

    private wholeValueName(tokens: ReadonlyArray<Token>): string | undefined {
        // CSS Values 5 §7.1: toggle() and first-valid() are <whole-value>s, which stand for the entire value of the property.
        const trimmed: Array<Token> = this.syntax.trim(tokens);
        if (trimmed.length === 0 || trimmed[0].type !== tokenTypes.Function || this.syntax.closing(trimmed, 0) !== trimmed.length - 1) {
            return undefined;
        }
        const name: string = this.syntax.functionName(trimmed[0]);
        return name === "toggle" || name === "first-valid" ? name : undefined;
    }

    private readWholeValue(property: string, shorthand: boolean, name: string, tokens: ReadonlyArray<Token>, baseUrl: string,
        namespaces: ReadonlyMap<string, string>, important: boolean): Array<Declaration> | undefined {
        // CSS Values 5 §7.2: first-valid() is its first argument the property accepts, or invalid at computed-value time;
        // §7.4: every argument of toggle() is a whole value of the property, without toggle(), attr() or calc().
        const toggle: boolean = name === "toggle";
        const argumentsList: Array<string> | undefined = this.wholeValueArguments(this.syntax.trim(tokens));
        if (argumentsList === undefined) {
            return undefined;
        }
        const results: Array<Array<Declaration>> = [];
        for (const argument of argumentsList) {
            let parsed: CssTreeDeclaration;
            try {
                parsed = parse(property + ": " + argument, { context: "declaration" }) as CssTreeDeclaration;
            } catch {
                if (toggle) {
                    return undefined;
                }
                continue;
            }
            let forbidden: boolean = false;
            walk(parsed, {
                visit: "Function",
                enter: (node: FunctionNode) => {
                    forbidden = forbidden || ["toggle", "attr", "calc"].includes(this.asciiCase.foldLower(this.escaping.unescape(node.name)));
                }
            });
            const read: Array<Declaration> | undefined = toggle && forbidden ? undefined : this.read(parsed, baseUrl, namespaces);
            if (!toggle) {
                if (read !== undefined) {
                    return read.map((declaration: Declaration) => ({ ...declaration, important }));
                }
                continue;
            }
            if (read === undefined || read.some((declaration: Declaration) => declaration.value.kind !== "value" && declaration.value.kind !== "keyword")) {
                return undefined;
            }
            results.push(read);
        }
        if (!toggle) {
            return this.targets(property, shorthand).map((target: string): Declaration => ({ property: target, value: { kind: "keyword", keyword: "unset" }, important }));
        }
        return results.length === 0 ? undefined : results[0].map((first: Declaration, index: number): Declaration => ({
            property: first.property,
            value: { kind: "toggle", values: results.map((declarations: Array<Declaration>) => declarations[index].value as ParsedValue | KeywordValue) },
            important
        }));
    }

    private wholeValueArguments(tokens: ReadonlyArray<Token>): Array<string> | undefined {
        // CSS Values 5 §3.1.1: <whole-value> and <declaration-value> are comma-containing productions, and neither is empty.
        const argumentsList: Array<string> = [];
        for (const part of this.syntax.split(tokens.slice(1, tokens.length - 1), tokenTypes.Comma)) {
            const argument: Array<Token> | undefined = this.syntax.commaContaining(part);
            if (argument === undefined || argument.length === 0) {
                return undefined;
            }
            argumentsList.push(this.syntax.serialize(argument));
        }
        return argumentsList;
    }

    readDescriptor(atRule: string, declaration: CssTreeDeclaration, baseUrl: string): Array<Declaration> | undefined {
        // A descriptor of the at-rule is read with its own grammar: size in @page (CSS Paged Media 3 §7.1) is not the size property.
        const name: string = this.table.descriptorName(atRule, this.asciiCase.foldLower(declaration.property));
        if (this.table.descriptor("@" + atRule, name) === undefined) {
            return undefined;
        }
        const value: DeclaredValue | undefined = this.descriptorValue(atRule, declaration, baseUrl, DeclarationReader.NO_NAMESPACES, false);
        return value === undefined ? [] : [{ property: name, value, important: declaration.important !== false }];
    }

    descriptorValue(atRule: string, declaration: CssTreeDeclaration, baseUrl: string, namespaces: ReadonlyMap<string, string>,
        substitution: boolean): DeclaredValue | undefined {
        // Where the at-rule allows var() and env(), such as @font-palette-values (CSS Fonts 4 §9.2), they are resolved later.
        const name: string = this.table.descriptorName(atRule, this.asciiCase.foldLower(declaration.property));
        if (substitution && this.uses(declaration.value, (functionName: string) => functionName.startsWith("--") || SUBSTITUTION_FUNCTIONS.has(functionName))) {
            const text: string = this.textOf(declaration.value).trim();
            return this.isValidCustomValue(text) && this.syntax.isValid(text) ? { kind: "pending", text, baseUrl, namespaces } : undefined;
        }
        if (declaration.value.type !== "Value") {
            return undefined;
        }
        this.resolveUrls(declaration.value, baseUrl);
        if (!this.table.matchesDescriptor(atRule, name, declaration.value)) {
            return undefined;
        }
        const value: CssValue | undefined = this.values.parse(declaration.value);
        return value === undefined || this.values.anchored(value) ? undefined : { kind: "value", value };
    }

    ignores(declaration: CssTreeDeclaration): boolean {
        return this.expander.isIgnored(this.table.canonicalName(this.asciiCase.foldLower(declaration.property)));
    }

    isValid(declaration: CssTreeDeclaration): boolean {
        // CSS Conditional 3 §6.1: a declaration is supported when the UA would accept it.
        return this.read(declaration, "about:blank", DeclarationReader.NO_NAMESPACES) !== undefined;
    }

    private declared(value?: CssValue): DeclaredValue {
        return value === undefined ? { kind: "keyword", keyword: "initial" } : { kind: "value", value };
    }

    private targets(property: string, shorthand: boolean): ReadonlyArray<string> {
        return shorthand ? this.expander.longhands(property) : [property];
    }

    private wideKeyword(value: CssTreeDeclaration["value"]): CssWideKeyword | undefined {
        if (value.type !== "Value" || value.children.size !== 1) {
            return undefined;
        }
        const only: CssNode | null = value.children.first;
        if (only === null || only.type !== "Identifier") {
            return undefined;
        }
        const name: string = this.asciiCase.foldLower(this.escaping.unescape(only.name));
        return DeclarationReader.CSS_WIDE_KEYWORDS.has(name) ? name as CssWideKeyword : undefined;
    }

    private uses(value: CssTreeDeclaration["value"], test: (name: string) => boolean): boolean {
        // CSS Values 5 Appendix A and CSS Functions and Mixins §3: custom functions are arbitrary substitution functions too.
        if (value.type === "Raw") {
            return this.syntax.tokens(value.value).some((token: Token) => token.type === tokenTypes.Function && test(this.syntax.functionName(token)));
        }
        let found: boolean = false;
        walk(value, {
            visit: "Function",
            enter: (node: FunctionNode) => {
                const name: string = this.escaping.unescape(node.name);
                found = found || test(name.startsWith("--") ? name : this.asciiCase.foldLower(name));
            }
        });
        return found;
    }

    private resolveUrls(value: Value, baseUrl: string): void {
        // CSS Values 4 §4.5.1: a relative URL is resolved against the stylesheet; a fragment-only URL stays as it is.
        const resolve: (node: { value: string }) => void = (node: { value: string }): void => {
            if (node.value.length > 0 && !node.value.startsWith("#")) {
                node.value = BaseUrls.resolved(node.value, baseUrl) ?? node.value;
            }
        };
        walk(value, {
            visit: "Url",
            enter: resolve
        });
        // CSS Values 4 §4.5: src() is a <url> too, with its URL in a string. CSS Images 4 §2.5 and §2.4: "A <string> used in
        // image() represents a <url>", and so does "Each <string> inside image-set()"; the string of its type() is not one.
        walk(value, {
            visit: "Function",
            enter: (node: FunctionNode) => {
                if (STRING_URL_FUNCTIONS.has(this.asciiCase.foldLower(node.name))) {
                    for (const child of node.children) {
                        if (child.type === "String") {
                            resolve(child);
                        }
                    }
                }
            }
        });
    }

    private textOf(value: CssTreeDeclaration["value"]): string {
        return value.type === "Raw" ? value.value : generate(value);
    }

    private isValidCustomValue(text: string): boolean {
        // CSS Syntax 3 §7.2: <declaration-value> holds no bad string, bad URL, unmatched closing bracket, or top-level ";" or "!".
        const closing: ReadonlyMap<number, number> = new Map<number, number>([
            [tokenTypes.LeftParenthesis, tokenTypes.RightParenthesis],
            [tokenTypes.Function, tokenTypes.RightParenthesis],
            [tokenTypes.LeftSquareBracket, tokenTypes.RightSquareBracket],
            [tokenTypes.LeftCurlyBracket, tokenTypes.RightCurlyBracket]
        ]);
        const stack: Array<number> = [];
        let valid: boolean = true;
        tokenize(text, (type: number, start: number, end: number) => {
            if (type === tokenTypes.BadString || type === tokenTypes.BadUrl) {
                valid = false;
            } else if (stack.length === 0 && (type === tokenTypes.Semicolon || (type === tokenTypes.Delim && text.substring(start, end) === "!"))) {
                valid = false;
            } else if (closing.has(type)) {
                stack.push(closing.get(type) as number);
            } else if (type === tokenTypes.RightParenthesis || type === tokenTypes.RightSquareBracket || type === tokenTypes.RightCurlyBracket) {
                valid = valid && stack.pop() === type;
            }
        });
        return valid;
    }
}
