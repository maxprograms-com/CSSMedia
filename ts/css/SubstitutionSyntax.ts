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

import { tokenize, tokenTypes } from "css-tree";
import { AsciiCase } from "./AsciiCase.js";
import { DeclarationReader } from "./DeclarationReader.js";
import { SyntaxDefinition } from "./SyntaxDefinition.js";

export interface Token {
    type: number;
    text: string;
}

export interface AttributeType {
    kind: "syntax" | "raw-string" | "number" | "unit" | "url";
    text: string;
}

export interface AttributeName {
    local: string;
    prefix?: string;
    type?: AttributeType;
}

const CLOSERS: ReadonlyMap<number, number> = new Map<number, number>([
    [tokenTypes.Function, tokenTypes.RightParenthesis],
    [tokenTypes.LeftParenthesis, tokenTypes.RightParenthesis],
    [tokenTypes.LeftSquareBracket, tokenTypes.RightSquareBracket],
    [tokenTypes.LeftCurlyBracket, tokenTypes.RightCurlyBracket]
]);

const NAMED_FUNCTIONS: ReadonlySet<string> = new Set<string>(["var", "env", "attr", "if", "inherit", "random-item"]);

const AFTER_WORD: ReadonlySet<string> = new Set<string>(["ident", "function", "url", "bad-url", "-", "number", "percentage", "dimension", "cdc"]);

const SEPARATED: ReadonlyMap<string, ReadonlySet<string>> = new Map<string, ReadonlySet<string>>([
    ["ident", new Set<string>([...AFTER_WORD, "("])],
    ["at-keyword", AFTER_WORD],
    ["hash", AFTER_WORD],
    ["dimension", AFTER_WORD],
    ["#", new Set<string>(["ident", "function", "url", "bad-url", "-", "number", "percentage", "dimension"])],
    ["-", new Set<string>(["ident", "function", "url", "bad-url", "-", "number", "percentage", "dimension"])],
    ["number", new Set<string>(["ident", "function", "url", "bad-url", "number", "percentage", "%", "dimension"])],
    ["@", new Set<string>(["ident", "function", "url", "bad-url", "-"])],
    [".", new Set<string>(["number", "percentage", "dimension"])],
    ["+", new Set<string>(["number", "percentage", "dimension"])],
    ["/", new Set<string>(["*"])]
]);

export class SubstitutionSyntax {

    private readonly asciiCase: AsciiCase = new AsciiCase();
    private readonly definitions: SyntaxDefinition = new SyntaxDefinition();

    tokens(text: string): Array<Token> {
        // CSS Syntax 3 §4.3.2: comments produce no token.
        const tokens: Array<Token> = [];
        tokenize(text, (type: number, start: number, end: number) => {
            if (type !== tokenTypes.Comment) {
                tokens.push({ type, text: text.substring(start, end) });
            }
        });
        return tokens;
    }

    serialize(tokens: ReadonlyArray<Token>): string {
        // CSS Syntax 3 §9: an empty comment goes between two tokens that would otherwise read back as one.
        let text: string = "";
        let previous: Token | undefined;
        for (const token of tokens) {
            if (previous !== undefined && SEPARATED.get(this.kind(previous))?.has(this.kind(token)) === true) {
                text += "/**/";
            }
            text += token.text;
            previous = token;
        }
        return text;
    }

    trim(tokens: ReadonlyArray<Token>): Array<Token> {
        let start: number = 0;
        let end: number = tokens.length;
        while (start < end && tokens[start].type === tokenTypes.WhiteSpace) {
            start++;
        }
        while (end > start && tokens[end - 1].type === tokenTypes.WhiteSpace) {
            end--;
        }
        return tokens.slice(start, end);
    }

    functionName(token: Token): string {
        // A dashed function name is case-sensitive, like the custom property names it resembles.
        const name: string = token.text.substring(0, token.text.length - 1);
        return name.startsWith("--") ? name : this.asciiCase.foldLower(name);
    }

    isSubstitution(token: Token): boolean {
        if (token.type !== tokenTypes.Function) {
            return false;
        }
        const name: string = this.functionName(token);
        return name.startsWith("--") || NAMED_FUNCTIONS.has(name);
    }

    isRandom(token: Token): boolean {
        return token.type === tokenTypes.Function && this.functionName(token) === "random";
    }

    closing(tokens: ReadonlyArray<Token>, open: number): number {
        const stack: Array<number> = [];
        for (let index: number = open; index < tokens.length; index++) {
            const closer: number | undefined = CLOSERS.get(tokens[index].type);
            if (closer !== undefined) {
                stack.push(closer);
            } else if (stack.length > 0 && tokens[index].type === stack[stack.length - 1]) {
                stack.pop();
                if (stack.length === 0) {
                    return index;
                }
            }
        }
        return tokens.length;
    }

    arguments(name: string, contents: ReadonlyArray<Token>): Array<Array<Token>> | undefined {
        // The grammars of CSS Variables 1 §3 (var()), CSS Values 5 §7.3, §7.6, §7.7 and §8.2, and CSS Functions and Mixins §3,
        // with the comma-containing productions of CSS Values 5 §3.1.1.
        if (name.startsWith("--")) {
            return this.dashedArguments(contents);
        }
        switch (name) {
            case "var":
            case "inherit":
                return this.referenceArguments(contents, name === "var");
            case "env":
                return this.envArguments(contents);
            case "attr":
                return this.attrArguments(contents);
            case "random-item":
                return this.randomItemArguments(contents);
            case "if":
                return this.ifArguments(contents);
            default:
                return undefined;
        }
    }

    isValid(text: string): boolean {
        // CSS Values 5 Appendix A: a value with arbitrary substitution functions is valid at parse time when the functions are.
        const tokens: Array<Token> = this.tokens(text);
        for (let index: number = 0; index < tokens.length; index++) {
            if (this.isSubstitution(tokens[index]) && this.arguments(this.functionName(tokens[index]), tokens.slice(index + 1, this.closing(tokens, index))) === undefined) {
                return false;
            }
        }
        return true;
    }

    split(tokens: ReadonlyArray<Token>, separator: number): Array<Array<Token>> {
        const parts: Array<Array<Token>> = [[]];
        let depth: number = 0;
        for (const token of tokens) {
            if (CLOSERS.has(token.type)) {
                depth++;
            } else if (this.isCloser(token.type)) {
                depth--;
            } else if (depth === 0 && token.type === separator) {
                parts.push([]);
                continue;
            }
            parts[parts.length - 1].push(token);
        }
        return parts;
    }

    commaContaining(tokens: ReadonlyArray<Token>): Array<Token> | undefined {
        // CSS Values 5 §3.1.1: a comma-containing production is either one {} block, standing for its contents, or holds no
        // comma and no {} block.
        const trimmed: Array<Token> = this.trim(tokens);
        if (trimmed.length > 0 && trimmed[0].type === tokenTypes.LeftCurlyBracket) {
            return this.closing(trimmed, 0) === trimmed.length - 1 ? this.trim(trimmed.slice(1, trimmed.length - 1)) : undefined;
        }
        let depth: number = 0;
        for (const token of trimmed) {
            if (depth === 0 && (token.type === tokenTypes.Comma || token.type === tokenTypes.LeftCurlyBracket)) {
                return undefined;
            }
            if (CLOSERS.has(token.type)) {
                depth++;
            } else if (this.isCloser(token.type)) {
                depth--;
            }
        }
        return trimmed;
    }

    attrName(tokens: ReadonlyArray<Token>): AttributeName | undefined {
        // CSS Values 5 §8.7: <attr-name> <attr-type>?, where <attr-name> = [ <ident-token>? '|' ]? <ident-token>; the null
        // namespace is implied without a prefix, and the prefix before the bar may be empty.
        let index: number = 0;
        let prefix: string | undefined;
        if (tokens.length > 1 && tokens[0].type === tokenTypes.Delim && tokens[0].text === "|" && tokens[1].type === tokenTypes.Ident) {
            prefix = "";
            index = 1;
        } else if (tokens.length > 2 && tokens[0].type === tokenTypes.Ident && tokens[1].type === tokenTypes.Delim && tokens[1].text === "|" && tokens[2].type === tokenTypes.Ident) {
            prefix = tokens[0].text;
            index = 2;
        }
        if (tokens[index]?.type !== tokenTypes.Ident) {
            return undefined;
        }
        const name: AttributeName = { local: tokens[index].text };
        if (prefix !== undefined) {
            name.prefix = prefix;
        }
        const rest: Array<Token> = this.trim(tokens.slice(index + 1));
        if (rest.length === 0) {
            return name;
        }
        if (tokens[index + 1].type !== tokenTypes.WhiteSpace) {
            return undefined;
        }
        const type: AttributeType | undefined = this.attrType(rest);
        if (type === undefined) {
            return undefined;
        }
        name.type = type;
        return name;
    }

    private attrType(tokens: ReadonlyArray<Token>): AttributeType | undefined {
        // CSS Values 5 §8.7: <attr-type> = type( <syntax> ) | raw-string | number | <attr-unit>, and <url> is invalid in type(); the
        // keyword url, which the attribute type of CSS Values 3 had, stays for the URL of an attribute.
        if (tokens.length === 1 && tokens[0].type === tokenTypes.Delim && tokens[0].text === "%") {
            return { kind: "unit", text: "%" };
        }
        if (tokens.length === 1 && tokens[0].type === tokenTypes.Ident) {
            const word: string = this.asciiCase.foldLower(tokens[0].text);
            if (DeclarationReader.RESERVED_IDENTIFIERS.has(word)) {
                return undefined;
            }
            return word === "raw-string" || word === "number" || word === "url" ? { kind: word, text: word } : { kind: "unit", text: word };
        }
        if (tokens.length > 1 && tokens[0].type === tokenTypes.Function && this.functionName(tokens[0]) === "type" && this.closing(tokens, 0) === tokens.length - 1) {
            const syntax: string | undefined = this.definitions.parse(this.serialize(this.trim(tokens.slice(1, tokens.length - 1))));
            if (syntax === undefined || syntax.split(" | ").some((component: string) => component.startsWith("<url>"))) {
                return undefined;
            }
            return { kind: "syntax", text: syntax };
        }
        return undefined;
    }

    randomArguments(contents: ReadonlyArray<Token>): Array<Array<Token>> | undefined {
        // CSS Values 5 §8.1: random( <random-caching-options>? , <calc-sum>, <calc-sum>, [by <calc-sum>]? ); the result holds the
        // caching options, empty when omitted, the minimum, the maximum and the step when given.
        const parts: Array<Array<Token>> = this.split(contents, tokenTypes.Comma).map((part: Array<Token>) => this.trim(part));
        const options: boolean = parts.length > 0 && this.isCachingOptions(parts[0]);
        const sums: Array<Array<Token>> = options ? parts.slice(1) : parts;
        if (sums.length < 2 || sums.length > 3 || sums.some((sum: Array<Token>) => sum.length === 0)) {
            return undefined;
        }
        if (sums.length === 3) {
            const step: Array<Token> = sums[2];
            if (step[0].type !== tokenTypes.Ident || this.asciiCase.foldLower(step[0].text) !== "by" || step.length < 3 || step[1].type !== tokenTypes.WhiteSpace) {
                return undefined;
            }
            sums[2] = this.trim(step.slice(1));
        }
        return [options ? parts[0] : [], ...sums];
    }

    private isCachingOptions(tokens: ReadonlyArray<Token>): boolean {
        // CSS Values 5 §8.1: <random-caching-options> = <dashed-ident> || per-element.
        const items: Array<Token> = tokens.filter((token: Token) => token.type !== tokenTypes.WhiteSpace);
        if (items.length === 0 || items.length > 2 || items.some((token: Token) => token.type !== tokenTypes.Ident)) {
            return false;
        }
        const named: number = items.filter((token: Token) => token.text.startsWith("--")).length;
        const element: number = items.filter((token: Token) => this.asciiCase.foldLower(token.text) === "per-element").length;
        return named <= 1 && element <= 1 && named + element === items.length;
    }

    private referenceArguments(contents: ReadonlyArray<Token>, lenient: boolean): Array<Array<Token>> | undefined {
        // var( <custom-property-name> , <declaration-value>? ) and inherit() alike; the fallback of var() is a non-strict
        // comma-containing production, which may hold commas and {} blocks unless it starts with one (CSS Values 5 §3.1.1).
        const parts: Array<Array<Token>> = this.split(contents, tokenTypes.Comma);
        const name: Array<Token> = this.trim(parts[0]);
        if (name.length !== 1 || name[0].type !== tokenTypes.Ident || !name[0].text.startsWith("--")) {
            return undefined;
        }
        if (parts.length === 1) {
            return [name];
        }
        const rest: Array<Token> = contents.slice(parts[0].length + 1);
        const fallback: Array<Token> | undefined = lenient && !this.startsWithBlock(rest) ? this.trim(rest) : this.commaContaining(rest);
        return fallback === undefined ? undefined : [name, fallback];
    }

    private envArguments(contents: ReadonlyArray<Token>): Array<Array<Token>> | undefined {
        // CSS Environment Variables 1 §3: env( <custom-ident> <integer [0,∞]>*, <declaration-value>? ).
        const parts: Array<Array<Token>> = this.split(contents, tokenTypes.Comma);
        const name: Array<Token> = this.trim(parts[0]);
        if (name.length === 0 || name[0].type !== tokenTypes.Ident) {
            return undefined;
        }
        for (const token of name.slice(1)) {
            if (token.type !== tokenTypes.WhiteSpace && token.type !== tokenTypes.Comment && (token.type !== tokenTypes.Number || !/^\+?[0-9]+$/.test(token.text))) {
                return undefined;
            }
        }
        if (parts.length === 1) {
            return [name];
        }
        const rest: Array<Token> = contents.slice(parts[0].length + 1);
        const fallback: Array<Token> | undefined = this.startsWithBlock(rest) ? this.commaContaining(rest) : this.trim(rest);
        return fallback === undefined ? undefined : [name, fallback];
    }

    private attrArguments(contents: ReadonlyArray<Token>): Array<Array<Token>> | undefined {
        const parts: Array<Array<Token>> = this.split(contents, tokenTypes.Comma);
        const first: Array<Token> = this.trim(parts[0]);
        if (this.attrName(first) === undefined) {
            return undefined;
        }
        if (parts.length === 1) {
            return [first];
        }
        const fallback: Array<Token> | undefined = this.commaContaining(contents.slice(parts[0].length + 1));
        return fallback === undefined ? undefined : [first, fallback];
    }

    private randomItemArguments(contents: ReadonlyArray<Token>): Array<Array<Token>> | undefined {
        // CSS Values 5 §8.2: random-item( <random-caching-options> , [ <declaration-value>? ]# ).
        const parts: Array<Array<Token>> = this.split(contents, tokenTypes.Comma);
        if (parts.length < 2 || !this.isCachingOptions(parts[0])) {
            return undefined;
        }
        const result: Array<Array<Token>> = [this.trim(parts[0])];
        for (const part of parts.slice(1)) {
            const argument: Array<Token> | undefined = this.commaContaining(part);
            if (argument === undefined) {
                return undefined;
            }
            result.push(argument);
        }
        return result;
    }

    private ifArguments(contents: ReadonlyArray<Token>): Array<Array<Token>> | undefined {
        // CSS Values 5 §7.3: [ <if-condition> : <declaration-value>? ; ]* <if-condition> : <declaration-value>? ;?
        const branches: Array<Array<Token>> = this.split(contents, tokenTypes.Semicolon);
        if (branches.length > 1 && this.trim(branches[branches.length - 1]).length === 0) {
            branches.pop();
        }
        const result: Array<Array<Token>> = [];
        for (const branch of branches) {
            const parts: Array<Array<Token>> = this.split(branch, tokenTypes.Colon);
            const condition: Array<Token> = this.trim(parts[0]);
            const value: Array<Token> | undefined = parts.length < 2 ? undefined : this.commaContaining(branch.slice(parts[0].length + 1));
            if (condition.length === 0 || value === undefined) {
                return undefined;
            }
            result.push(condition, value);
        }
        return result;
    }

    private dashedArguments(contents: ReadonlyArray<Token>): Array<Array<Token>> | undefined {
        // CSS Functions and Mixins §3: --*( <declaration-value>#? ).
        if (this.trim(contents).length === 0) {
            return [];
        }
        const result: Array<Array<Token>> = [];
        for (const part of this.split(contents, tokenTypes.Comma)) {
            const argument: Array<Token> | undefined = this.commaContaining(part);
            if (argument === undefined || argument.length === 0) {
                return undefined;
            }
            result.push(argument);
        }
        return result;
    }

    private startsWithBlock(tokens: ReadonlyArray<Token>): boolean {
        const trimmed: Array<Token> = this.trim(tokens);
        return trimmed.length > 0 && trimmed[0].type === tokenTypes.LeftCurlyBracket;
    }

    private isCloser(type: number): boolean {
        return type === tokenTypes.RightParenthesis || type === tokenTypes.RightSquareBracket || type === tokenTypes.RightCurlyBracket;
    }

    private kind(token: Token): string {
        switch (token.type) {
            case tokenTypes.Ident:
                return "ident";
            case tokenTypes.Function:
                return "function";
            case tokenTypes.Url:
                return "url";
            case tokenTypes.BadUrl:
                return "bad-url";
            case tokenTypes.Number:
                return "number";
            case tokenTypes.Percentage:
                return "percentage";
            case tokenTypes.Dimension:
                return "dimension";
            case tokenTypes.CDC:
                return "cdc";
            case tokenTypes.LeftParenthesis:
                return "(";
            case tokenTypes.AtKeyword:
                return "at-keyword";
            case tokenTypes.Hash:
                return "hash";
            case tokenTypes.Delim:
                return token.text;
            default:
                return "";
        }
    }
}
