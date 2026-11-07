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

import type { CssNode, SelectorList } from "css-tree";
import { parse, tokenize, tokenTypes, walk } from "css-tree";

interface Token {
    type: number;
    start: number;
    end: number;
}

const STAND_IN: string = "/deep/";

export class SelectorText {

    parseList(text: string): SelectorList | undefined {
        // Selectors 5 §8.1 and §9.1: the column combinator || and the reference combinator /name/ are parsed as /deep/, and get
        // their own text back in the order they appear.
        const combinators: Array<string> = [];
        const prepared: string = this.prepare(text, combinators);
        let failed: boolean = false;
        let list: CssNode;
        try {
            list = parse(prepared, { context: "selectorList", onParseError: () => { failed = true; } });
        } catch {
            return undefined;
        }
        if (failed || list.type !== "SelectorList") {
            return undefined;
        }
        let next: number = 0;
        walk(list, {
            visit: "Combinator",
            enter: (node: { name: string }) => {
                if (node.name === STAND_IN) {
                    node.name = combinators[next++];
                }
            }
        });
        return list;
    }

    private prepare(text: string, combinators: Array<string>): string {
        const tokens: Array<Token> = [];
        tokenize(text, (type: number, start: number, end: number) => {
            tokens.push({ type, start, end });
        });
        let result: string = "";
        let copied: number = 0;
        for (let index: number = 0; index < tokens.length; index++) {
            const token: Token = tokens[index];
            let next: number = index + 1;
            while (next < tokens.length && tokens[next].type === tokenTypes.Comment) {
                next++;
            }
            if (this.isDelim(text, token, "|") && next < tokens.length && this.isDelim(text, tokens[next], "|")) {
                result += text.substring(copied, token.start) + " " + STAND_IN + " ";
                combinators.push("||");
                copied = tokens[next].end;
                index = next;
                continue;
            }
            if (this.isDelim(text, token, "/")) {
                const close: number = this.referenceEnd(text, tokens, index);
                if (close !== -1) {
                    let name: string = "";
                    for (let inner: number = index + 1; inner < close; inner++) {
                        if (tokens[inner].type !== tokenTypes.WhiteSpace && tokens[inner].type !== tokenTypes.Comment) {
                            name += text.substring(tokens[inner].start, tokens[inner].end);
                        }
                    }
                    result += text.substring(copied, token.start) + " " + STAND_IN + " ";
                    combinators.push("/" + name + "/");
                    copied = tokens[close].end;
                    index = close;
                }
            }
        }
        return result + text.substring(copied);
    }

    private referenceEnd(text: string, tokens: ReadonlyArray<Token>, open: number): number {
        // Selectors 5 §9.1: "/" <wq-name> "/", where the name is ident, ident|ident, *|ident or |ident.
        const parts: Array<Token> = [];
        for (let index: number = open + 1; index < tokens.length; index++) {
            const token: Token = tokens[index];
            if (token.type === tokenTypes.WhiteSpace || token.type === tokenTypes.Comment) {
                continue;
            }
            if (this.isDelim(text, token, "/")) {
                return this.isQualifiedName(text, parts) ? index : -1;
            }
            parts.push(token);
            if (parts.length > 3) {
                return -1;
            }
        }
        return -1;
    }

    private isQualifiedName(text: string, parts: ReadonlyArray<Token>): boolean {
        const ident: (token: Token) => boolean = (token: Token): boolean => token.type === tokenTypes.Ident;
        switch (parts.length) {
            case 1:
                return ident(parts[0]);
            case 2:
                return this.isDelim(text, parts[0], "|") && ident(parts[1]);
            case 3:
                return (ident(parts[0]) || this.isDelim(text, parts[0], "*")) && this.isDelim(text, parts[1], "|") && ident(parts[2]);
            default:
                return false;
        }
    }

    private isDelim(text: string, token: Token, character: string): boolean {
        return token.type === tokenTypes.Delim && text.substring(token.start, token.end) === character;
    }
}
