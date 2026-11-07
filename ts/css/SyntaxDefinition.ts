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

import { string as cssString, tokenize, tokenTypes } from "css-tree";
import { AsciiCase } from "./AsciiCase.js";

export interface SyntaxComponent {
    name: string;
    keyword: boolean;
    multiplier: "" | "+" | "#";
    text: string;
}

const TYPE_NAMES: ReadonlySet<string> = new Set<string>([
    "angle", "color", "custom-ident", "image", "integer", "length", "length-percentage", "number", "percentage", "resolution", "string", "time", "url",
    "transform-function", "transform-list"
]);

const RESERVED_KEYWORDS: ReadonlySet<string> = new Set<string>(["initial", "inherit", "unset", "revert", "revert-layer", "default"]);

const IDENTIFIER: RegExp = /^(?:--|-?(?:[A-Za-z_]|[^\x00-\x7F]|\\[^\n]))(?:[\w-]|[^\x00-\x7F]|\\[^\n])*$/;

export class SyntaxDefinition {

    static readonly UNIVERSAL: string = "*";

    private readonly asciiCase: AsciiCase = new AsciiCase();

    parse(text: string): string | undefined {
        // CSS Values 5 §3.3: '*', <syntax-component>s joined by '|', or a <syntax-string> holding either.
        const trimmed: string = text.trim();
        if (trimmed.startsWith("\"") || trimmed.startsWith("'")) {
            const quoted: string | undefined = this.singleString(trimmed);
            return quoted === undefined ? undefined : this.parseComponents(quoted.trim());
        }
        return this.parseComponents(trimmed);
    }

    components(grammar: string): Array<SyntaxComponent> {
        if (grammar === SyntaxDefinition.UNIVERSAL) {
            return [];
        }
        return grammar.split(" | ").map((text: string): SyntaxComponent => {
            const typed: RegExpExecArray | null = /^<([a-z-]+)>([+#])?$/.exec(text);
            if (typed !== null) {
                return { name: typed[1], keyword: false, multiplier: (typed[2] ?? "") as "" | "+" | "#", text };
            }
            return { name: text, keyword: true, multiplier: "", text };
        });
    }

    private parseComponents(text: string): string | undefined {
        // CSS Properties and Values 1 §5.4.2: <transform-list> takes no multiplier, and an identifier may not be a CSS-wide
        // keyword or default; no whitespace precedes a multiplier.
        if (text === SyntaxDefinition.UNIVERSAL) {
            return SyntaxDefinition.UNIVERSAL;
        }
        if (text.length === 0) {
            return undefined;
        }
        const components: Array<string> = [];
        for (const part of text.split("|")) {
            const component: string = part.trim();
            const typed: RegExpExecArray | null = /^<([a-z-]+)>([+#])?$/.exec(component);
            if (typed !== null) {
                if (!TYPE_NAMES.has(typed[1]) || (typed[1] === "transform-list" && typed[2] !== undefined)) {
                    return undefined;
                }
                components.push(component);
            } else if (IDENTIFIER.test(component) && !RESERVED_KEYWORDS.has(this.asciiCase.foldLower(component))) {
                components.push(component);
            } else {
                return undefined;
            }
        }
        return components.join(" | ");
    }

    private singleString(text: string): string | undefined {
        let count: number = 0;
        let value: string | undefined;
        tokenize(text, (type: number, start: number, end: number) => {
            count++;
            value = type === tokenTypes.String ? cssString.decode(text.substring(start, end)) : undefined;
        });
        return count === 1 ? value : undefined;
    }
}
