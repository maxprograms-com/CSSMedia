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

import { TextNode } from "typesxml";
import type { CssValue, FunctionValue } from "../css/values/CssValue.js";
import { SourceElement } from "../parse/SourceElement.js";
import type { BoxNode, ElementBox, TextSequence } from "./BoxTree.js";
import type { DisplayType } from "./DisplayTypes.js";
import type { ComputedStyle } from "./ComputedStyle.js";
import type { ContentValues } from "./ContentValues.js";
import type { Counter, CounterScopes } from "./CounterScopes.js";
import type { CounterStyles, CounterSymbol } from "./CounterStyles.js";
import type { CrossReferences } from "./CrossReferences.js";
import type { QuotePair } from "./QuoteSystems.js";
import { WhiteSpaceProcessor } from "./WhiteSpaceProcessor.js";

export interface ContentState {
    counters: Array<Counter>;
    node: number;
    language?: string;
    quotes: () => ReadonlyArray<QuotePair>;
    contents?: () => Array<BoxNode>;
    references?: CrossReferences;
    targets?: Map<TextSequence, string>;
}

const TARGETS: ReadonlySet<string> = new Set<string>(["target-counter", "target-counters", "target-text"]);
const LEADER_KEYWORDS: ReadonlyMap<string, string> = new Map<string, string>([["dotted", "."], ["solid", "_"], ["space", " "]]);
const LINE_BREAKS: RegExp = /[\n\r\u2028\u2029]/g;
const PAGE: string = "page";
const INLINE: DisplayType = { outer: "inline", inner: "flow", listItem: false };

const LEADING_WHITE_SPACE: RegExp = /^[ \t\r\n]*/;
const UNIT: string = "\\p{M}*";
const SPACE_BEFORE: string = "(?!\\u3000)\\p{Zs}";
const SPACE_AFTER: string = "(?![\\u3000\\u0020\\u00A0])\\p{Zs}";
const CLOSING: string = "(?![\\p{Ps}\\p{Pd}])\\p{P}";
const FIRST_LETTER: RegExp = new RegExp(
    "((?:\\p{P}" + UNIT + "(?:(?:\\p{P}|" + SPACE_BEFORE + ")" + UNIT + ")*)?)([\\p{L}\\p{N}\\p{S}]" + UNIT + ")((?:(?:(?:" + CLOSING + "|" + SPACE_AFTER + ")" + UNIT + ")*"
    + CLOSING + UNIT + ")?)", "uy");
const NEXT_LETTER: RegExp = /\p{L}\p{M}*/uy;
const HIGHEST_CHARACTER: string = "\uFFFF";
const LONGEST_LETTER: number = 4;

export class GeneratedContent {

    static readonly LIST_ITEM: string = "list-item";
    private static collators?: Map<string, Intl.Collator>;
    private static uncollated?: Set<string>;

    private readonly scopes: CounterScopes;
    private readonly counterStyles: CounterStyles;
    private readonly values: ContentValues;
    private whiteSpace?: WhiteSpaceProcessor;
    quoteDepth: number = 0;

    constructor(scopes: CounterScopes, counterStyles: CounterStyles, values: ContentValues) {
        this.scopes = scopes;
        this.counterStyles = counterStyles;
        this.values = values;
    }

    evaluate(items: ReadonlyArray<CssValue>, text: ComputedStyle, state: ContentState): Array<BoxNode> {
        // CSS Content 3 §1: each value becomes an anonymous inline run of text or an inline replaced element; the values that
        // depend on layout or on other pages are kept for the stages that know them.
        const rightToLeft: boolean = this.isRightToLeft(text);
        const nodes: Array<BoxNode> = [];
        for (const item of items) {
            switch (item.kind) {
                case "string":
                    this.addText(nodes, item.value, text, state.language);
                    break;
                case "ident":
                    if (item.lower === "contents") {
                        if (state.contents !== undefined) {
                            nodes.push(...state.contents());
                        }
                    } else {
                        this.addText(nodes, this.quote(item.lower, state.quotes), text, state.language);
                    }
                    break;
                case "function":
                    if (item.name === "counter" || item.name === "counters") {
                        this.addSymbols(nodes, this.counter(item.name, item.args, state, rightToLeft), text, state.language);
                    } else if (item.name === "leader") {
                        this.addLeader(nodes, item.args[0], text, state.language);
                    } else if (TARGETS.has(item.name) && state.references !== undefined && state.targets === undefined) {
                        this.addSymbols(nodes, this.target(item.name, item.args, state.references, rightToLeft, false), text, state.language);
                    } else if (TARGETS.has(item.name) && state.references !== undefined && state.targets !== undefined) {
                        const node: TextSequence = { kind: "text", text: this.targetValue(item, rightToLeft, state.references), style: text, target: item };
                        if (state.language !== undefined) {
                            node.language = state.language;
                        }
                        nodes.push(node);
                        state.targets.set(node, node.text);
                    } else {
                        nodes.push({ kind: "deferred", value: item, style: text });
                    }
                    break;
                case "url":
                    nodes.push(this.replaced(item, text));
                    break;
                default:
                    break;
            }
        }
        return nodes;
    }

    hasMarker(text: ComputedStyle): boolean {
        // CSS Lists 3 §3.2: with content normal, ::marker generates a box only for a marker image or a marker string.
        const image: CssValue | undefined = text.values["list-style-image"];
        const type: CssValue | undefined = text.values["list-style-type"];
        return (image !== undefined && this.values.isImage(image)) || (type !== undefined && !(type.kind === "ident" && type.lower === "none"));
    }

    marker(text: ComputedStyle, state: ContentState): Array<BoxNode> {
        // CSS Lists 3 §3.2: with content normal, the marker holds the marker image followed by a space, or else the marker string
        // of list-style-type; with neither it has no contents.
        const image: CssValue | undefined = text.values["list-style-image"];
        if (image !== undefined && this.values.isImage(image)) {
            const nodes: Array<BoxNode> = [this.replaced(image, text)];
            this.addText(nodes, " ", text, state.language);
            return nodes;
        }
        const type: CssValue | undefined = text.values["list-style-type"];
        if (type === undefined || (type.kind === "ident" && type.lower === "none")) {
            return [];
        }
        const nodes: Array<BoxNode> = [];
        if (type.kind === "string") {
            this.addText(nodes, type.value, text, state.language);
            return nodes;
        }
        // CSS Lists 3 §3.4: the list-item counter in the counter style, with the style's prefix and suffix.
        const values: Array<number> = this.scopes.values(state.counters, state.node, GeneratedContent.LIST_ITEM);
        this.addSymbols(nodes, this.counterStyles.marker(values[values.length - 1], this.isRightToLeft(text), type), text, state.language);
        return nodes;
    }

    alternativeText(items: ReadonlyArray<CssValue>, text: ComputedStyle, state: ContentState): string {
        // CSS Content 3 §1.2: the alternative text is [ <string> | <counter> | <attr()> ]+, and attr() is a string by now; an
        // image symbol of a counter style has no text.
        let result: string = "";
        for (const item of items) {
            if (item.kind === "string") {
                result += item.value;
            } else if (item.kind === "function" && (item.name === "counter" || item.name === "counters")) {
                for (const symbol of this.counter(item.name, item.args, state, this.isRightToLeft(text))) {
                    result += typeof symbol === "string" ? symbol : "";
                }
            }
        }
        return result;
    }

    namedText(parts: ReadonlyArray<CssValue>, element: SourceElement, text: ComputedStyle, state: ContentState,
        generated?: Readonly<Record<string, ReadonlyArray<BoxNode>>>): string {
        // CSS Content 3 §2.7.1: the values "are concatenated", so a <string> stays as written; GCPM 3 §1.1.1.1: the text taken from
        // the document is "determined as if white-space: normal had been set", and the values next to each other make one line.
        let result: string = "";
        let line: string = "";
        for (const part of parts) {
            const argument: CssValue | undefined = part.kind === "function" && part.name === "content" ? part.args[0] : undefined;
            const keyword: string = argument !== undefined && argument.kind === "ident" ? argument.lower : "text";
            if (part.kind === "ident" && part.lower === "contents") {
                line += this.textOf(element);
            } else if (part.kind === "function" && part.name === "content" && keyword !== "first-letter") {
                line += keyword === "text" ? this.textOf(element) : this.boxText(generated?.[keyword]);
            } else {
                result += this.normalText(line, text);
                line = "";
                result += part.kind === "function" && part.name === "content" ? this.firstLetterText(element, generated) : this.alternativeText([part], text, state);
            }
        }
        return result + this.normalText(line, text);
    }

    private normalText(line: string, style: ComputedStyle): string {
        if (line.length === 0) {
            return line;
        }
        this.whiteSpace = this.whiteSpace ?? new WhiteSpaceProcessor();
        return this.whiteSpace.normalText(line, style);
    }

    private firstLetterText(element: SourceElement, generated?: Readonly<Record<string, ReadonlyArray<BoxNode>>>): string {
        // CSS Pseudo-Elements 4 §2.2.1: the first letter can come from the content of ::before, and the white space before
        // it is not part of it.
        const text: string = this.boxText(generated?.["before"]) + this.textOf(element);
        const start: number = (LEADING_WHITE_SPACE.exec(text) as RegExpExecArray)[0].length;
        const found: readonly [number, number, number] | undefined = GeneratedContent.firstLetter(text, start, element.getLanguage());
        return found === undefined ? "" : text.substring(start, found[2]);
    }

    private textOf(element: SourceElement): string {
        let text: string = "";
        for (const child of element.getContent()) {
            if (child instanceof TextNode) {
                text += child.getValue();
            } else if (child instanceof SourceElement) {
                text += this.textOf(child);
            }
        }
        return text;
    }

    private boxText(nodes?: ReadonlyArray<BoxNode>): string {
        let text: string = "";
        if (nodes === undefined) {
            return text;
        }
        for (const node of nodes) {
            if (node.kind === "text") {
                text += node.text;
            } else if (node.kind === "box") {
                text += this.boxText(node.children);
            }
        }
        return text;
    }

    static firstLetter(text: string, start: number, language?: string): readonly [number, number, number] | undefined {
        // CSS Pseudo-Elements 4 §2.2.1: the first letter with the punctuation around it; the result has where the letter
        // starts, where the punctuation after it starts, and where the first-letter text ends.
        FIRST_LETTER.lastIndex = start;
        const match: RegExpExecArray | null = FIRST_LETTER.exec(text);
        if (match === null) {
            return undefined;
        }
        const letter: number = start + match[1].length;
        let suffix: number = letter + match[2].length;
        let end: number = suffix + match[3].length;
        const last: number = match[3].length === 0 ? GeneratedContent.lastLetterOfUnit(text, letter, suffix, language) : letter;
        if (last > letter) {
            // The punctuation after the letter follows the whole letter.
            FIRST_LETTER.lastIndex = last;
            const final: RegExpExecArray = FIRST_LETTER.exec(text) as RegExpExecArray;
            suffix = last + final[2].length;
            end = suffix + final[3].length;
        }
        return [letter, suffix, end];
    }

    private static lastLetterOfUnit(text: string, letter: number, first: number, language?: string): number {
        // §2.2.1: "languages may have additional rules about how to treat certain letter combinations", and the UA "should
        // tailor its definition of typographic character unit" to the content language, whose collation knows its letters.
        const collator: Intl.Collator | undefined = GeneratedContent.collator(language);
        const ends: Array<number> = [first];
        while (collator !== undefined && ends.length < LONGEST_LETTER) {
            NEXT_LETTER.lastIndex = ends[ends.length - 1];
            if (NEXT_LETTER.exec(text) === null) {
                break;
            }
            ends.push(NEXT_LETTER.lastIndex);
        }
        for (let index: number = ends.length - 1; collator !== undefined && index > 0; index--) {
            // Text sorts between its start and its start followed by the highest character, U+FFFF in UTS #10, unless
            // the collation takes the characters added to that start with it as one letter.
            const whole: string = text.substring(letter, ends[index]);
            const before: string = text.substring(letter, ends[index - 1]);
            if (collator.compare(whole, before + HIGHEST_CHARACTER) > 0 || collator.compare(whole, before) < 0) {
                return ends[index - 1];
            }
        }
        return letter;
    }

    private static collator(language?: string): Intl.Collator | undefined {
        if (language === undefined || language.length === 0) {
            return undefined;
        }
        let collator: Intl.Collator | undefined = GeneratedContent.collators?.get(language);
        if (collator === undefined && GeneratedContent.uncollated?.has(language) !== true) {
            try {
                collator = new Intl.Collator(language, { sensitivity: "base" });
                GeneratedContent.collators = GeneratedContent.collators ?? new Map<string, Intl.Collator>();
                GeneratedContent.collators.set(language, collator);
            } catch {
                GeneratedContent.uncollated = GeneratedContent.uncollated ?? new Set<string>();
                GeneratedContent.uncollated.add(language);
            }
        }
        return collator;
    }

    private addSymbols(nodes: Array<BoxNode>, symbols: ReadonlyArray<CounterSymbol>, text: ComputedStyle, language?: string): void {
        // CSS Counter Styles 3 §3.8: the image symbols "are rendered as inline replaced elements".
        for (const symbol of symbols) {
            if (typeof symbol === "string") {
                this.addText(nodes, symbol, text, language);
            } else {
                nodes.push(this.replaced(symbol, text));
            }
        }
    }

    private addText(nodes: Array<BoxNode>, content: string, text: ComputedStyle, language?: string): void {
        const last: BoxNode | undefined = nodes[nodes.length - 1];
        if (last !== undefined && last.kind === "text" && last.style === text && last.leader !== true && last.target === undefined) {
            last.text += content;
        } else if (content.length > 0) {
            const node: TextSequence = { kind: "text", text: content, style: text };
            if (language !== undefined) {
                node.language = language;
            }
            nodes.push(node);
        }
    }

    private counter(name: string, args: ReadonlyArray<CssValue>, state: ContentState, rightToLeft: boolean): Array<CounterSymbol> {
        // CSS Lists 3 §4.7: counter( <counter-name>, <counter-style>? ) and counters( <counter-name>, <string>, <counter-style>? ).
        const counterName: CssValue | undefined = args[0];
        if (counterName === undefined || counterName.kind !== "ident") {
            return [];
        }
        const values: Array<number> = this.scopes.values(state.counters, state.node, counterName.name);
        if (name === "counter") {
            return this.counterStyles.representation(values[values.length - 1], rightToLeft, args[1]);
        }
        const separator: CssValue | undefined = args[1];
        const joiner: string = separator !== undefined && separator.kind === "string" ? separator.value : "";
        const symbols: Array<CounterSymbol> = [];
        for (const [index, value] of values.entries()) {
            if (index > 0) {
                symbols.push(joiner);
            }
            symbols.push(...this.counterStyles.representation(value, rightToLeft, args[2]));
        }
        return symbols;
    }

    private replaced(image: CssValue, text: ComputedStyle): ElementBox {
        // CSS Content 3 §1: an <image> of a content list is "an anonymous inline replaced element", and CSS Counter Styles 3
        // §3.8 makes the image symbols of a counter style the same.
        return {
            kind: "box", style: text, display: INLINE, placement: "in-flow", replaced: true, hasStartEdge: true, hasEndEdge: true, usedPage: "", startPage: "", endPage: "",
            children: [{ kind: "deferred", value: image, style: text }]
        };
    }

    private addLeader(nodes: Array<BoxNode>, type: CssValue | undefined, text: ComputedStyle, language?: string): void {
        // CSS Content 3 §2.5.2: "Line break characters in the leader string must be ignored".
        let leader: string = "";
        if (type !== undefined && type.kind === "string") {
            leader = type.value;
        } else if (type !== undefined && type.kind === "ident") {
            leader = LEADER_KEYWORDS.get(type.lower) ?? "";
        }
        leader = leader.replace(LINE_BREAKS, "");
        if (leader.length > 0) {
            const node: TextSequence = { kind: "text", text: leader, style: text, leader: true };
            if (language !== undefined) {
                node.language = language;
            }
            nodes.push(node);
        }
    }

    targetText(value: FunctionValue, style: ComputedStyle, references: CrossReferences): string {
        return this.targetValue(value, this.isRightToLeft(style), references);
    }

    private targetValue(value: FunctionValue, rightToLeft: boolean, references: CrossReferences): string {
        let result: string = "";
        for (const symbol of this.target(value.name, value.args, references, rightToLeft, true)) {
            if (typeof symbol !== "string") {
                throw new Error("An image symbol of a counter style in " + value.name + "() is not implemented");
            }
            result += symbol;
        }
        return result;
    }

    private target(name: string, args: ReadonlyArray<CssValue>, references: CrossReferences, rightToLeft: boolean, shown: boolean): Array<CounterSymbol> {
        // CSS Content 3 §2.6: target-counter( [ <string> | <url> ], <custom-ident>, <counter-style>? ), target-counters( [ <string> | <url> ],
        // <custom-ident>, <string>, <counter-style>? ) and target-text( [ <string> | <url> ], <keyword>? ), from the target of the link.
        const id: string | undefined = references.target(args[0]);
        if (id === undefined) {
            return [];
        }
        const second: CssValue | undefined = args[1];
        if (name === "target-text") {
            return [references.text(id, second !== undefined && second.kind === "ident" ? second.lower : "content") ?? ""];
        }
        const counter: string = second !== undefined && second.kind === "ident" ? second.name : "";
        // Paged Media 3 §6.1: the page counter of an element is that of the page it is on, which layout gives.
        if (counter === PAGE && shown) {
            references.showPage(id);
        }
        const page: number | undefined = counter === PAGE ? references.page(id) : undefined;
        const values: ReadonlyArray<number> = counter === PAGE ? [page ?? 0] : references.counters(id, counter) ?? [0];
        if (name === "target-counter") {
            return this.counterStyles.representation(values[values.length - 1] ?? 0, rightToLeft, args[2]);
        }
        const separator: CssValue | undefined = args[2];
        const symbols: Array<CounterSymbol> = [];
        for (const [index, value] of values.entries()) {
            if (index > 0) {
                symbols.push(separator !== undefined && separator.kind === "string" ? separator.value : "");
            }
            symbols.push(...this.counterStyles.representation(value, rightToLeft, args[3]));
        }
        return symbols;
    }

    private quote(keyword: string, quotes: () => ReadonlyArray<QuotePair>): string {
        // CSS Content 3 §2.4.2: open-quote uses the pair at the current depth and then deepens it; close-quote first makes it
        // shallower; the last pair repeats beyond the list, and a close-quote at depth zero is ignored.
        const pair: (depth: number) => QuotePair | undefined = (depth: number): QuotePair | undefined => {
            const pairs: ReadonlyArray<QuotePair> = quotes();
            return pairs.length === 0 ? undefined : pairs[Math.min(depth, pairs.length - 1)];
        };
        switch (keyword) {
            case "open-quote": {
                const marks: QuotePair | undefined = pair(this.quoteDepth);
                this.quoteDepth++;
                return marks?.[0] ?? "";
            }
            case "close-quote":
                if (this.quoteDepth === 0) {
                    return "";
                }
                this.quoteDepth--;
                return pair(this.quoteDepth)?.[1] ?? "";
            case "no-open-quote":
                this.quoteDepth++;
                return "";
            case "no-close-quote":
                this.quoteDepth = Math.max(0, this.quoteDepth - 1);
                return "";
            default:
                return "";
        }
    }

    private isRightToLeft(style: ComputedStyle): boolean {
        const direction: CssValue | undefined = style.values["direction"];
        return direction !== undefined && direction.kind === "ident" && direction.lower === "rtl";
    }
}
