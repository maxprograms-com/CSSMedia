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

import type { CssNode, FunctionNode, Value } from "css-tree";
import { AsciiCase } from "../AsciiCase.js";
import { CssIdentifierEscaping } from "../CssIdentifierEscaping.js";
import { CalcParser } from "./CalcParser.js";
import { ColorSpaces } from "./ColorSpaces.js";
import type { CalcNode, CssValue } from "./CssValue.js";

const UNICODE_RANGE: RegExp = /^u\+([0-9a-f?]{1,6})(?:-([0-9a-f]{1,6}))?$/i;
const MAX_CODE_POINT: number = 0x10FFFF;

export class CssValueParser {

    static readonly INTEGER: RegExp = /^[+-]?[0-9]+$/;

    private readonly asciiCase: AsciiCase = new AsciiCase();
    private readonly escaping: CssIdentifierEscaping = new CssIdentifierEscaping();
    private readonly calcParser: CalcParser = new CalcParser();

    parse(value: Value): CssValue | undefined {
        return this.parseSequence(value.children.toArray());
    }

    parseNodes(nodes: ReadonlyArray<CssNode>): CssValue | undefined {
        return this.parseSequence(nodes);
    }

    private parseSequence(nodes: ReadonlyArray<CssNode>, channels?: ReadonlySet<string>): CssValue | undefined {
        // Commas separate the items of a list; within an item, components are separated by whitespace, and a slash is a component of its own.
        const groups: Array<Array<CssNode>> = [[]];
        for (const node of nodes) {
            if (node.type === "Operator" && node.value.trim() === ",") {
                groups.push([]);
            } else {
                groups[groups.length - 1].push(node);
            }
        }
        if (groups.length === 1 && groups[0].length === 0) {
            return undefined;
        }
        const items: Array<CssValue> = [];
        for (const group of groups) {
            const item: CssValue | undefined = this.parseGroup(group, channels);
            if (item === undefined) {
                return undefined;
            }
            items.push(item);
        }
        return items.length === 1 ? items[0] : { kind: "list", separator: "comma", items };
    }

    private parseGroup(nodes: ReadonlyArray<CssNode>, channels?: ReadonlySet<string>): CssValue | undefined {
        if (nodes.length === 0) {
            return undefined;
        }
        const items: Array<CssValue> = [];
        for (const node of nodes) {
            const item: CssValue | undefined = this.parseComponent(node, channels);
            if (item === undefined) {
                return undefined;
            }
            items.push(item);
        }
        return items.length === 1 ? items[0] : { kind: "list", separator: "space", items };
    }

    private parseComponent(node: CssNode, channels?: ReadonlySet<string>): CssValue | undefined {
        switch (node.type) {
            case "Identifier": {
                const name: string = this.escaping.unescape(node.name);
                return { kind: "ident", name, lower: this.asciiCase.foldLower(name) };
            }
            case "Number":
                return { kind: "number", value: this.numberOf(node.value), integer: CssValueParser.INTEGER.test(node.value) };
            case "Percentage":
                return { kind: "percentage", value: this.numberOf(node.value) };
            case "Dimension":
                return { kind: "dimension", value: this.numberOf(node.value), unit: this.asciiCase.foldLower(this.escaping.unescape(node.unit)) };
            case "Hash":
                return { kind: "hash", value: this.escaping.unescape(node.value) };
            case "String":
                return { kind: "string", value: node.value };
            case "Url":
                return { kind: "url", href: node.value };
            case "UnicodeRange":
                return this.parseUnicodeRange(node.value);
            case "Operator":
                return node.value.trim() === "/" ? { kind: "slash" } : undefined;
            case "Function":
                return this.parseFunction(node, channels);
            case "Brackets":
                return this.parseBlock("[", node.children.toArray(), channels);
            case "Parentheses":
                return this.parseBlock("(", node.children.toArray(), channels);
            default:
                return undefined;
        }
    }

    private parseFunction(node: FunctionNode, channels?: ReadonlySet<string>): CssValue | undefined {
        const name: string = this.asciiCase.foldLower(this.escaping.unescape(node.name));
        if (this.calcParser.isMathFunction(name)) {
            const root: CalcNode | undefined = this.calcParser.parse(node, channels);
            return root === undefined ? undefined : { kind: "calc", root };
        }
        if (name === "anchor-size") {
            const anchor: CalcNode | undefined = this.calcParser.parseAnchor(node);
            return anchor === undefined ? undefined : { kind: "calc", root: anchor };
        }
        const nodes: Array<CssNode> = node.children.toArray();
        if (nodes.length === 0) {
            return { kind: "function", name, args: [] };
        }
        if (name === "calc-size") {
            return this.parseCalcSize(nodes);
        }
        const content: CssValue | undefined = this.parseSequence(nodes, this.relativeChannels(name, nodes));
        if (content === undefined) {
            return undefined;
        }
        // CSS Values 4 §4.5: <url> = <url()> | <src()>, and src() gives its URL as a string followed by modifiers.
        const first: CssValue = content.kind === "list" && content.separator === "space" ? content.items[0] : content;
        if (name === "src" && first.kind === "string") {
            return { kind: "url", href: first.value };
        }
        const args: ReadonlyArray<CssValue> = content.kind === "list" && content.separator === "comma" ? content.items : [content];
        return { kind: "function", name, args };
    }

    anchored(value: CssValue): boolean {
        // CSS Anchor Positioning 1 §5: anchor-size() "is only allowed in the accepted @position-try properties (and is
        // otherwise invalid)", so the reader checks where a value that holds one is declared.
        switch (value.kind) {
            case "calc":
                return this.calcAnchored(value.root);
            case "function":
                return value.args.some((argument: CssValue) => this.anchored(argument));
            case "list":
                return value.items.some((item: CssValue) => this.anchored(item));
            case "block":
                return value.content !== undefined && this.anchored(value.content);
            default:
                return false;
        }
    }

    private calcAnchored(node: CalcNode): boolean {
        if (node.kind === "anchor") {
            return true;
        }
        return node.kind !== "leaf" && node.kind !== "channel" && node.children.some((child: CalcNode) => this.calcAnchored(child));
    }

    private parseCalcSize(nodes: ReadonlyArray<CssNode>): CssValue | undefined {
        // CSS Values 5 §10: calc-size( <calc-size-basis>, <calc-sum> ), where the basis is a sizing keyword, another
        // calc-size(), any or a <calc-sum>, and "if the calc-size basis is not any, the keyword size is allowed."
        const comma: number = nodes.findIndex((node: CssNode) => node.type === "Operator" && node.value.trim() === ",");
        if (comma <= 0) {
            return undefined;
        }
        const first: ReadonlyArray<CssNode> = nodes.slice(0, comma);
        const only: CssNode | undefined = first.length === 1 ? first[0] : undefined;
        let basis: CssValue | undefined;
        if (only !== undefined && only.type === "Identifier") {
            basis = this.parseComponent(only);
        } else if (only !== undefined && only.type === "Function" && this.asciiCase.foldLower(this.escaping.unescape(only.name)) === "calc-size") {
            basis = this.parseCalcSize(only.children.toArray());
        } else {
            const sum: CalcNode | undefined = this.calcParser.parseSize(first, false);
            basis = sum === undefined ? undefined : { kind: "calc", root: sum };
        }
        const sized: boolean = basis === undefined || basis.kind !== "ident" || basis.lower !== "any";
        const root: CalcNode | undefined = this.calcParser.parseSize(nodes.slice(comma + 1), sized);
        return basis === undefined || root === undefined ? undefined : { kind: "function", name: "calc-size", args: [basis, { kind: "calc", root }] };
    }

    private relativeChannels(name: string, nodes: ReadonlyArray<CssNode>): ReadonlySet<string> | undefined {
        // CSS Color 5 §4.2: with an origin color, "from <color>", the components may be the component keywords of the function;
        // §5.1: in color() they are r, g and b, or x, y and z in an XYZ space. A function nested in it starts over.
        const first: CssNode = nodes[0];
        const names: ReadonlyArray<string> | undefined = ColorSpaces.CHANNELS.get(name);
        if (names === undefined || first.type !== "Identifier" || this.asciiCase.foldLower(first.name) !== "from") {
            return undefined;
        }
        const space: CssNode | undefined = name === "color" ? nodes[2] : undefined;
        if (space !== undefined && space.type === "Identifier" && space.name.startsWith("--")) {
            // The names of a custom color space come from its profile, which is not known while the value is read.
            return ColorSpaces.PROFILE_CHANNELS;
        }
        const xyz: boolean = space !== undefined && space.type === "Identifier" && this.asciiCase.foldLower(space.name).startsWith("xyz");
        return new Set<string>([...(xyz ? ColorSpaces.XYZ_CHANNELS : names), ColorSpaces.ALPHA_CHANNEL]);
    }

    private parseBlock(bracket: "[" | "(", nodes: ReadonlyArray<CssNode>, channels?: ReadonlySet<string>): CssValue | undefined {
        if (nodes.length === 0) {
            return { kind: "block", bracket };
        }
        const content: CssValue | undefined = this.parseSequence(nodes, channels);
        return content === undefined ? undefined : { kind: "block", bracket, content };
    }

    private parseUnicodeRange(text: string): CssValue | undefined {
        // CSS Fonts 4 §4.5: a single code point, an interval, or a prefix whose trailing ? digits stand for any hex digit.
        const match: RegExpExecArray | null = UNICODE_RANGE.exec(text);
        if (match === null) {
            return undefined;
        }
        const first: string = match[1];
        const wildcard: boolean = first.includes("?");
        if (wildcard && (match[2] !== undefined || !/^[0-9a-f]*\?+$/i.test(first))) {
            return undefined;
        }
        const start: number = Number.parseInt(wildcard ? first.replace(/\?/g, "0") : first, 16);
        const end: number = wildcard ? Number.parseInt(first.replace(/\?/g, "f"), 16) : (match[2] !== undefined ? Number.parseInt(match[2], 16) : start);
        if (start > MAX_CODE_POINT || end > MAX_CODE_POINT || start > end) {
            return undefined;
        }
        return { kind: "unicode-range", start, end };
    }

    private numberOf(text: string): number {
        const value: number = Number(text);
        return value === 0 ? 0 : value;
    }
}
