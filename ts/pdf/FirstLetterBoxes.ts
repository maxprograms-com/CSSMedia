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

import type { CssValue } from "../css/values/CssValue.js";
import { BoxBuilder } from "./BoxBuilder.js";
import type { BoxNode, ElementBox, InlineItem, InlineSequence, TextSequence } from "./BoxTree.js";
import type { ComputedStyle } from "./ComputedStyle.js";
import { DisplayTypes } from "./DisplayTypes.js";
import { GeneratedContent } from "./GeneratedContent.js";
import type { WhiteSpaceProcessor } from "./WhiteSpaceProcessor.js";

interface Found {
    index: number;
    parent: ElementBox;
    start: number;
    letter: number;
    suffix: number;
    end: number;
}

interface Wrapped {
    parent: ElementBox;
    text: TextSequence;
    nodes: ReadonlyArray<BoxNode>;
    index: number;
    count: number;
}

interface Split {
    owner: ElementBox;
    origins?: ReadonlyArray<ElementBox>;
    lines?: ReadonlyArray<ElementBox>;
    wrapped?: Wrapped;
}

export class FirstLetterBoxes {

    private readonly builder: BoxBuilder;
    private readonly whiteSpace: WhiteSpaceProcessor;
    private readonly displays: DisplayTypes = new DisplayTypes();
    private readonly splits: Map<InlineSequence, Split> = new Map<InlineSequence, Split>();
    private sequences: Array<InlineSequence> = [];

    constructor(builder: BoxBuilder, whiteSpace: WhiteSpaceProcessor) {
        this.builder = builder;
        this.whiteSpace = whiteSpace;
    }

    apply(root: ElementBox, sequences: Array<InlineSequence>): void {
        this.sequences = sequences;
        if (this.builder.hasFirstLineOrigins()) {
            this.visit(root);
        }
    }

    undo(sequence: InlineSequence): void {
        const wrapped: Wrapped | undefined = this.splits.get(sequence)?.wrapped;
        if (wrapped === undefined) {
            return;
        }
        const parent: ElementBox = wrapped.parent;
        parent.children.splice(parent.children.indexOf(wrapped.nodes[0]), wrapped.nodes.length, wrapped.text);
        sequence.items.splice(wrapped.index, wrapped.count, { kind: "text", node: wrapped.text });
    }

    again(sequence: InlineSequence): Array<InlineSequence> {
        const split: Split | undefined = this.splits.get(sequence);
        this.sequences = [];
        if (split === undefined) {
            return this.sequences;
        }
        if (split.origins !== undefined) {
            const wrapped: Wrapped | undefined = this.wrap(split.owner, sequence, split.origins);
            if (wrapped === undefined) {
                delete split.wrapped;
            } else {
                split.wrapped = wrapped;
            }
        }
        if (split.lines !== undefined) {
            sequence.firstLine = this.firstLine(split.owner, sequence, split.lines);
        }
        return this.sequences;
    }

    private visit(box: ElementBox, inherited?: ReadonlyArray<ElementBox>, inheritedLines?: ReadonlyArray<ElementBox>): void {
        // CSS Pseudo-Elements 4 §2.1.1: the first formatted line of a block container with an inline formatting context is its
        // first line, and otherwise "the first formatted line of its first in-flow block-level child", except in a table wrapper.
        const container: boolean = !box.replaced && this.displays.isBlockContainer(box.display) && !box.children.some((child: BoxNode) => this.isTableGrid(child));
        let origins: ReadonlyArray<ElementBox> | undefined;
        let lines: ReadonlyArray<ElementBox> | undefined;
        if (container) {
            origins = this.builder.originatesFirstLetter(box) ? (inherited === undefined ? [box] : [...inherited, box]) : inherited;
            lines = this.builder.originatesFirstLine(box) ? (inheritedLines === undefined ? [box] : [...inheritedLines, box]) : inheritedLines;
        }
        const first: BoxNode | undefined = container ? box.children.find((child: BoxNode) => this.isInFlowBlockLevel(child)) : undefined;
        if (container && first === undefined && box.inline !== undefined) {
            const sequence: InlineSequence = box.inline[0];
            const split: Split | undefined = this.whiteSpace.holds(sequence) && (origins !== undefined || lines !== undefined) ? { owner: box } : undefined;
            if (origins !== undefined) {
                const wrapped: Wrapped | undefined = this.wrap(box, sequence, origins);
                if (split !== undefined) {
                    split.origins = origins;
                    if (wrapped !== undefined) {
                        split.wrapped = wrapped;
                    }
                }
            }
            if (lines !== undefined) {
                sequence.firstLine = this.firstLine(box, sequence, lines);
                if (split !== undefined) {
                    split.lines = lines;
                }
            }
            if (split !== undefined) {
                this.splits.set(sequence, split);
            }
        }
        for (const child of box.children) {
            if (child.kind === "box") {
                if (child === first) {
                    this.visit(child, origins, lines);
                } else {
                    this.visit(child);
                }
            }
        }
    }

    private firstLine(owner: ElementBox, sequence: InlineSequence, origins: ReadonlyArray<ElementBox>): InlineSequence {
        // CSS Pseudo-Elements 4 §2.1.3: on the first line a child inherits the inherited properties from ::first-line and
        // "For all other properties [...] inheritance is from the non-pseudo parent"; the same content gets those styles here.
        const styles: Array<ComputedStyle> = this.lineStyles(owner, origins);
        const line: ComputedStyle = styles[styles.length - 1];
        const root: ComputedStyle = {
            values: owner.style.values === owner.style.inherited ? line.inherited : Object.assign(Object.create(line.inherited) as Record<string, CssValue>, owner.style.values),
            inherited: line.inherited, custom: owner.style.custom
        };
        if (owner.style.zoom !== undefined) {
            root.zoom = owner.style.zoom;
        }
        const parents: Array<ComputedStyle> = [root];
        const open: Array<ElementBox> = [];
        const items: Array<InlineItem> = [];
        for (const item of sequence.items) {
            const parent: ComputedStyle = parents[parents.length - 1];
            if (item.kind === "open") {
                const box: ElementBox = item.node as ElementBox;
                const lined: ElementBox = { ...box, style: this.builder.firstLineBoxStyle(box, parent) };
                open.push(lined);
                parents.push(lined.style);
                items.push({ kind: "open", node: lined });
            } else if (item.kind === "close") {
                parents.pop();
                items.push({ kind: "close", node: open.pop() as ElementBox });
            } else if (item.kind === "text" && item.node.kind === "text") {
                items.push({ kind: "text", node: { ...item.node, style: { values: parent.inherited, inherited: parent.inherited, custom: parent.custom } } });
            } else {
                items.push(item);
            }
        }
        return { style: root, items };
    }

    private lineStyles(owner: ElementBox, origins: ReadonlyArray<ElementBox>): Array<ComputedStyle> {
        // CSS Pseudo-Elements 4 §2.1.1: several ::first-line pseudo-elements "are nested in the same order as their originating
        // elements", inside the block container that has the line.
        const styles: Array<ComputedStyle> = [];
        let parent: ComputedStyle = owner.style;
        for (const origin of origins) {
            parent = this.builder.firstLineStyle(origin, parent);
            styles.push(parent);
        }
        return styles;
    }

    private isTableGrid(node: BoxNode): boolean {
        return node.kind === "box" && this.displays.isTableRoot(node.display);
    }

    private isInFlowBlockLevel(node: BoxNode): boolean {
        return node.kind === "box" && node.placement === "in-flow" && node.display.outer === "block";
    }

    private wrap(owner: ElementBox, sequence: InlineSequence, origins: ReadonlyArray<ElementBox>): Wrapped | undefined {
        const found: Found | undefined = this.find(owner, sequence);
        if (found === undefined) {
            return undefined;
        }
        const text: TextSequence = sequence.items[found.index].node as TextSequence;
        // CSS Pseudo-Elements 4 §2.2.3: the pseudo-elements of several originating elements "are nested in the same order as
        // their originating elements", and "Inheritance behaves accordingly".
        const boxes: Array<ElementBox> = [];
        let style: ComputedStyle = found.parent.style;
        for (const origin of origins) {
            const box: ElementBox = this.builder.firstLetterBox(origin, BoxBuilder.FIRST_LETTER, style) as ElementBox;
            boxes.push(box);
            style = box.style;
        }
        // "they are nested within the innermost ::first-letter". Text without a ::prefix or a ::suffix stays with the letter.
        const prefixes: Array<ElementBox> = this.parts(origins, BoxBuilder.FIRST_LETTER_PREFIX, style, found.letter > found.start);
        const suffixes: Array<ElementBox> = this.parts(origins, BoxBuilder.FIRST_LETTER_SUFFIX, style, found.end > found.suffix);
        const innermost: ElementBox = boxes[boxes.length - 1];
        let items: Array<InlineItem> = [];
        const from: number = prefixes.length > 0 ? found.letter : found.start;
        const to: number = suffixes.length > 0 ? found.suffix : found.end;
        const letter: TextSequence = this.piece(text, from, to, style);
        let leading: TextSequence = letter;
        if (prefixes.length > 0) {
            leading = this.piece(text, found.start, found.letter, prefixes[prefixes.length - 1].style);
            items.push(...this.nest(prefixes, leading, innermost));
        }
        innermost.children.push(letter);
        items.push({ kind: "text", node: letter });
        if (suffixes.length > 0) {
            items.push(...this.nest(suffixes, this.piece(text, found.suffix, found.end, suffixes[suffixes.length - 1].style), innermost));
        }
        for (let index: number = boxes.length - 1; index >= 0; index--) {
            const box: ElementBox = boxes[index];
            if (index > 0) {
                boxes[index - 1].children.push(box);
            }
            if (box.placement === "float") {
                // A floated first letter is out of the flow of its line and has its own inline formatting context.
                const own: InlineSequence = { style: box.style, items };
                box.inline = [own];
                this.sequences.push(own);
                items = [{ kind: "out-of-flow", node: box }];
            } else {
                items = [{ kind: "open", node: box }, ...items, { kind: "close", node: box }];
            }
        }
        const nodes: Array<BoxNode> = [boxes[0]];
        if (found.start > 0) {
            leading = this.piece(text, 0, found.start, text.style);
            nodes.unshift(leading);
            items.unshift({ kind: "text", node: leading });
        }
        if (found.end < text.text.length) {
            const rest: TextSequence = this.piece(text, found.end, text.text.length, text.style);
            nodes.push(rest);
            items.push({ kind: "text", node: rest });
        }
        if (text.namedStrings !== undefined) {
            leading.namedStrings = text.namedStrings;
        }
        found.parent.children.splice(found.parent.children.indexOf(text), 1, ...nodes);
        sequence.items.splice(found.index, 1, ...items);
        return { parent: found.parent, text, nodes, index: found.index, count: items.length };
    }

    private parts(origins: ReadonlyArray<ElementBox>, name: string, parent: ComputedStyle, present: boolean): Array<ElementBox> {
        const boxes: Array<ElementBox> = [];
        let style: ComputedStyle = parent;
        if (!present) {
            return boxes;
        }
        for (const origin of origins) {
            const box: ElementBox | undefined = this.builder.firstLetterBox(origin, name, style);
            if (box !== undefined) {
                boxes.push(box);
                style = box.style;
            }
        }
        return boxes;
    }

    private nest(boxes: ReadonlyArray<ElementBox>, text: TextSequence, parent: ElementBox): Array<InlineItem> {
        let items: Array<InlineItem> = [{ kind: "text", node: text }];
        boxes[boxes.length - 1].children.push(text);
        for (let index: number = boxes.length - 1; index >= 0; index--) {
            (index > 0 ? boxes[index - 1] : parent).children.push(boxes[index]);
            items = [{ kind: "open", node: boxes[index] }, ...items, { kind: "close", node: boxes[index] }];
        }
        return items;
    }

    private piece(text: TextSequence, start: number, end: number, parent: ComputedStyle): TextSequence {
        // CSS Display 3 §2: text inherits from its parent box, and its other properties have the initial value.
        const collapsed: Array<number> | undefined = text.collapsedSpaces?.filter((offset: number) => offset >= start && offset < end).map((offset: number) => offset - start);
        const part: TextSequence = {
            kind: "text", text: text.text.substring(start, end),
            style: parent === text.style ? parent : { values: parent.inherited, inherited: parent.inherited, custom: parent.custom }
        };
        if (text.language !== undefined) {
            part.language = text.language;
        }
        if (collapsed !== undefined && collapsed.length > 0) {
            part.collapsedSpaces = collapsed;
        }
        return part;
    }

    private find(owner: ElementBox, sequence: InlineSequence): Found | undefined {
        // CSS Pseudo-Elements 4 §2.2.2: the first-letter text is the first inline-level content of the first formatted line
        // "if it is not preceded by any other in-flow content", and "any marker boxes are ignored, as if they were out-of-flow".
        const open: Array<ElementBox> = [];
        const items: ReadonlyArray<InlineItem> = sequence.items;
        for (let index: number = 0; index < items.length; index++) {
            const item: InlineItem = items[index];
            if (item.kind === "open") {
                const box: ElementBox = item.node as ElementBox;
                if (box.pseudoElement !== undefined && box.pseudoElement.endsWith("marker")) {
                    while (items[index].kind !== "close" || items[index].node !== box) {
                        index++;
                    }
                } else {
                    open.push(box);
                }
                continue;
            }
            if (item.kind === "close") {
                open.pop();
                continue;
            }
            if (item.kind === "out-of-flow") {
                continue;
            }
            if (item.kind !== "text" || item.node.kind !== "text") {
                return undefined;
            }
            // CSS Text 4 §4.3.2: "A sequence of collapsible spaces at the beginning of a line is removed", so they do not come
            // before the first letter.
            const text: TextSequence = item.node;
            let start: number = 0;
            while (this.collapses(text.style.values["white-space-collapse"]) && text.text.charAt(start) === " ") {
                start++;
            }
            if (start === text.text.length) {
                continue;
            }
            const found: readonly [number, number, number] | undefined = GeneratedContent.firstLetter(text.text, start, text.language);
            if (found === undefined) {
                return undefined;
            }
            return { index, parent: open.length > 0 ? open[open.length - 1] : owner, start, letter: found[0], suffix: found[1], end: found[2] };
        }
        return undefined;
    }

    private collapses(value?: CssValue): boolean {
        const keyword: string = value !== undefined && value.kind === "ident" ? value.lower : "collapse";
        return keyword === "collapse" || keyword === "preserve-breaks";
    }
}
