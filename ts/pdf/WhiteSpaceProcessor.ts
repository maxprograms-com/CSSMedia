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
import type { BoxNode, ElementBox, InlineItem, InlineSequence, TextSequence } from "./BoxTree.js";
import type { ComputedStyle } from "./ComputedStyle.js";
import { DisplayTypes } from "./DisplayTypes.js";
import { SPACE_DISCARDING_RANGES } from "./generated/SpaceDiscardingData.js";
import { RubyPairing } from "./RubyPairing.js";

const TAB: number = 0x09;
const LINE_FEED: number = 0x0A;
const CARRIAGE_RETURN: number = 0x0D;
const SPACE: number = 0x20;
const DELETE: number = 0x7F;
const LAST_CONTROL: number = 0x9F;
const ZERO_WIDTH_SPACE: number = 0x200B;
const CONTROL_PICTURES: number = 0x2400;
const DELETE_PICTURE: number = 0x2421;
const REPLACEMENT_CHARACTER: number = 0xFFFD;
const OBJECT: number = 0xFFFC;

const NO_TEXT: number = -1;
const COLLAPSE: number = 0;
const PRESERVE_BREAKS: number = 1;
const PRESERVE: number = 2;
const PRESERVE_SPACES: number = 3;
const BREAK_SPACES: number = 4;
const DISCARD: number = 5;
const MODES: ReadonlyMap<string, number> = new Map<string, number>([
    ["collapse", COLLAPSE], ["preserve-breaks", PRESERVE_BREAKS], ["preserve", PRESERVE], ["preserve-spaces", PRESERVE_SPACES],
    ["break-spaces", BREAK_SPACES], ["discard", DISCARD]
]);

const KEPT: number = 0;
const REMOVED: number = 1;
const COLLAPSED: number = 2;

const DISCARD_BEFORE: number = 1;
const DISCARD_AFTER: number = 2;
const DISCARD_INNER: number = 4;
const TRIMS: ReadonlyMap<string, number> = new Map<string, number>([
    ["discard-before", DISCARD_BEFORE], ["discard-after", DISCARD_AFTER], ["discard-inner", DISCARD_INNER]
]);

interface AnnotationLevel {
    container: ElementBox;
    hidden: ReadonlySet<ElementBox>;
    separate: boolean;
}

interface Edges {
    trimStart: boolean;
    trimEnd: boolean;
    suppressBreaks: boolean;
}

export class WhiteSpaceProcessor {

    private readonly displays: DisplayTypes = new DisplayTypes();
    private readonly units: Array<number> = [];
    private readonly modes: Array<number> = [];
    private readonly marks: Array<number> = [];
    private readonly texts: Array<TextSequence> = [];
    private readonly starts: Array<number> = [];
    private readonly trims: Array<[number, number, number]> = [];
    private readonly nested: Array<ElementBox> = [];
    private readonly pairing: RubyPairing = new RubyPairing();
    private readonly levels: Array<AnnotationLevel> = [];
    private readonly spliced: Map<BoxNode, Array<ElementBox>> = new Map<BoxNode, Array<ElementBox>>();
    private readonly edges: Map<InlineSequence, Edges> = new Map<InlineSequence, Edges>();
    private readonly holders: Map<TextSequence, InlineSequence> = new Map<TextSequence, InlineSequence>();
    private sequences: Array<InlineSequence> = [];
    private items: Array<InlineItem> = [];
    private suppressBreaks: boolean = false;

    process(root: ElementBox): Array<InlineSequence> {
        this.sequences = [];
        this.container(root, false, false, root.style);
        return this.sequences;
    }

    sequenceOf(text: TextSequence): InlineSequence | undefined {
        return this.holders.get(text);
    }

    holds(sequence: InlineSequence): boolean {
        return this.edges.has(sequence);
    }

    again(sequence: InlineSequence): void {
        // Processing processed text gives the same text, so only the new text of a cross-reference changes.
        const edges: Edges | undefined = this.edges.get(sequence);
        if (edges === undefined) {
            return;
        }
        this.suppressBreaks = edges.suppressBreaks;
        const opened: Array<number> = [];
        for (const item of sequence.items) {
            const node: BoxNode = item.node;
            if (item.kind === "text" && node.kind === "text") {
                this.addText(node, false);
            } else if (item.kind === "open") {
                opened.push(this.units.length);
            } else if (item.kind === "close" && node.kind === "box") {
                this.addTrim(node, opened.pop() as number, true);
            } else if (item.kind === "object" || item.kind === "out-of-flow") {
                const start: number = this.units.length;
                if (item.kind === "object") {
                    this.addUnits();
                }
                if (node.kind === "box" && node.display.internal !== "ruby-text" && this.displays.isBlockContainer(node.display)) {
                    this.addTrim(node, start, false);
                }
            }
        }
        this.settle(edges.trimStart, edges.trimEnd);
        this.suppressBreaks = false;
    }

    normalText(value: string, style: ComputedStyle): string {
        // GCPM 3 §1.1.1.1: "as if white-space: normal had been set", whatever the white-space of the boxes the text comes from;
        // the text is a line of its own, and CSS Text 4 §4.3.2 removes the spaces at the ends of a line.
        const text: TextSequence = { kind: "text", text: value, style };
        this.addCharacters(text, COLLAPSE);
        this.settle(false, false);
        let result: string = "";
        let copied: number = 0;
        for (const offset of text.collapsedSpaces ?? []) {
            result += text.text.substring(copied, offset);
            copied = offset + 1;
        }
        result += text.text.substring(copied);
        const start: number = result.startsWith(" ") ? 1 : 0;
        return result.substring(start, Math.max(start, result.endsWith(" ") ? result.length - 1 : result.length));
    }

    private container(box: ElementBox, sharedStart: boolean, sharedEnd: boolean, style: ComputedStyle): void {
        // CSS Text 4 §4.3.1: white space is processed "For each inline ... within an inline formatting context". An anonymous
        // block box at an edge of a block container holds the text at that edge of the container, for §4.2 discard-inner.
        const blockContainer: boolean = this.displays.isBlockContainer(box.display);
        const inner: boolean = blockContainer && (this.trimOf(box.style.values["white-space-trim"]) & DISCARD_INNER) !== 0;
        const trimStart: boolean = inner || sharedStart;
        const trimEnd: boolean = inner || sharedEnd;
        const children: ReadonlyArray<BoxNode> = box.children;
        let index: number = 0;
        while (index < children.length) {
            const child: BoxNode = children[index];
            if (this.isInFlowBlockLevel(child)) {
                // CSS Writing Modes 4 §2.2: the override of a block container "is applied to an anonymous inline box that
                // surrounds all of its content", so its anonymous block boxes take the style that decides it.
                const anonymous: boolean = child.element === undefined && blockContainer;
                this.container(child, anonymous && trimStart && index === 0, anonymous && trimEnd && index === children.length - 1, anonymous ? style : child.style);
                index++;
                continue;
            }
            const first: number = index;
            const base: number = this.nested.length;
            const levelBase: number = this.levels.length;
            while (index < children.length && !this.isInFlowBlockLevel(children[index])) {
                this.collect(children[index]);
                index++;
            }
            this.resolve(box, style, trimStart && first === 0, trimEnd && index === children.length);
            // The boxes found in the text have their own formatting contexts, which are processed once this text is done.
            while (this.nested.length > base || this.levels.length > levelBase) {
                if (this.levels.length > levelBase) {
                    this.annotationLevel(this.levels.pop() as AnnotationLevel);
                } else {
                    const nested: ElementBox = this.nested.pop() as ElementBox;
                    this.container(nested, false, false, nested.style);
                }
            }
        }
    }

    private annotationLevel(level: AnnotationLevel): void {
        // CSS Ruby 1 §2.5: "Annotations in separate ruby segments or separated by hidden annotations are not considered
        // adjacent"; §3.2: inter-character annotations "are laid out exactly like inline blocks".
        this.suppressBreaks = true;
        for (const child of level.container.children) {
            if (child.kind !== "box" || child.placement !== "in-flow" || child.display.internal !== "ruby-text") {
                this.collect(child);
            } else if (level.hidden.has(child)) {
                this.resolve(level.container, level.container.style, false, false);
            } else {
                this.collectInline(child);
                if (level.separate) {
                    this.resolve(level.container, level.container.style, false, false);
                }
            }
        }
        this.resolve(level.container, level.container.style, false, false);
        this.suppressBreaks = false;
    }

    private isInFlowBlockLevel(node: BoxNode): node is ElementBox {
        return node.kind === "box" && node.placement === "in-flow" && node.display.outer === "block";
    }

    private collect(node: BoxNode): void {
        if (node.kind === "text") {
            this.addText(node);
            return;
        }
        if (node.kind === "deferred") {
            this.addObject(node);
            return;
        }
        const inFlow: boolean = node.placement === "in-flow" && !node.replaced;
        if (inFlow && this.displays.isInlineBox(node.display)) {
            this.collectInline(node);
            return;
        }
        if (inFlow && this.displays.isRubyContainer(node.display)) {
            // CSS Ruby 1 §2.1.1: "a ruby container and its base-level contents participate in the same inline formatting
            // context that contains the ruby container itself"; §3.3: ruby containers "are treated as inline boxes".
            const start: number = this.units.length;
            this.items.push({ kind: "open", node });
            this.collectRuby(node);
            this.items.push({ kind: "close", node });
            this.addTrim(node, start, true);
            return;
        }
        // An atomic inline stands between the characters around it; a box out of the flow keeps its place among them, which
        // CSS 2.1 §9.5.1 and §10.3.7 and GCPM 3 §2 position it from, but it is no character of this text.
        const start: number = this.units.length;
        if (node.placement === "in-flow") {
            this.addObject(node);
        } else {
            this.items.push({ kind: "out-of-flow", node });
        }
        this.nested.push(node);
        if (this.displays.isBlockContainer(node.display)) {
            this.addTrim(node, start, false);
        }
    }

    private collectInline(box: ElementBox): void {
        const start: number = this.units.length;
        this.items.push({ kind: "open", node: box });
        for (const child of box.children) {
            this.collect(child);
        }
        this.items.push({ kind: "close", node: box });
        this.addTrim(box, start, true);
    }

    private addTrim(box: ElementBox, start: number, inline: boolean): void {
        // CSS Text 4 §4.2: white-space-trim applies to inline boxes and block containers; the discard-inner of a block
        // container works on the text inside it.
        const trim: number = this.trimOf(box.style.values["white-space-trim"]) & (inline ? ~0 : ~DISCARD_INNER);
        if (trim !== 0) {
            this.trims.push([start, this.units.length, trim]);
        }
    }

    private collectRuby(ruby: ElementBox): void {
        const horizontal: boolean = this.keyword("horizontal-tb", ruby.style.values["writing-mode"]) === "horizontal-tb";
        const children: ReadonlyArray<BoxNode> = ruby.children;
        for (let index: number = 0; index < children.length; index++) {
            const child: BoxNode = children[index];
            const internal: string | undefined = this.internalOf(child);
            if (internal === "ruby-base-container") {
                // CSS Ruby 1 §2.3.1: the annotation containers that follow a base container are the levels of its segment.
                let next: number = index + 1;
                while (next < children.length && this.internalOf(children[next]) !== "ruby-base-container" && this.internalOf(children[next]) !== "ruby-base") {
                    if (this.internalOf(children[next]) === "ruby-text-container") {
                        this.scheduleLevel(children[next] as ElementBox, horizontal, child as ElementBox);
                    }
                    next++;
                }
                for (const base of (child as ElementBox).children) {
                    if (this.internalOf(base) === "ruby-base") {
                        this.collectInline(base as ElementBox);
                        this.addSpliced(base as ElementBox);
                    } else {
                        this.collect(base);
                    }
                }
                for (let level: number = index + 1; level < next; level++) {
                    this.addSpliced(children[level]);
                }
            } else if (internal === "ruby-text-container") {
                if (this.pairing.baseContainerOf(ruby, index) === undefined) {
                    this.scheduleLevel(child as ElementBox, horizontal);
                    this.addSpliced(child);
                }
            } else if (internal === "ruby-base") {
                this.collectInline(child as ElementBox);
            } else {
                this.collect(child);
            }
        }
    }

    private scheduleLevel(container: ElementBox, horizontal: boolean, baseContainer?: ElementBox): void {
        // CSS Ruby 1 §4.1: with inter-character, in a horizontal ruby container, "the ruby annotation becomes an inter-character
        // annotation"; §3.2: it "is inserted to the right of the ruby base it is paired with", the last one when it spans several.
        const separate: boolean = horizontal && this.keyword("alternate", container.style.values["ruby-position"]) === "inter-character";
        const hidden: Set<ElementBox> = new Set<ElementBox>();
        for (const pair of this.pairing.pairs(container, baseContainer)) {
            if (this.pairing.isHidden(pair, container)) {
                hidden.add(pair.annotation);
            } else if (separate) {
                const place: ElementBox = pair.bases !== undefined ? pair.bases[pair.bases.length - 1] : container;
                const annotations: Array<ElementBox> | undefined = this.spliced.get(place);
                if (annotations === undefined) {
                    this.spliced.set(place, [pair.annotation]);
                } else {
                    annotations.push(pair.annotation);
                }
            }
        }
        this.levels.push({ container, hidden, separate });
    }

    private addSpliced(place: BoxNode): void {
        // CSS Ruby 1 §2.5: base-level content includes the "inter-character annotations, which are treated as atomic inlines".
        const annotations: Array<ElementBox> | undefined = this.spliced.get(place);
        if (annotations !== undefined) {
            this.spliced.delete(place);
            for (const annotation of annotations) {
                this.addObject(annotation);
            }
        }
    }

    private internalOf(node: BoxNode): string | undefined {
        return node.kind === "box" && node.placement === "in-flow" ? node.display.internal : undefined;
    }

    private keyword(initial: string, value?: CssValue): string {
        return value !== undefined && value.kind === "ident" ? value.lower : initial;
    }

    private addText(text: TextSequence, item: boolean = true): void {
        const collapse: CssValue | undefined = text.style.values["white-space-collapse"];
        if (item) {
            this.items.push({ kind: "text", node: text });
        }
        this.addCharacters(text, (collapse !== undefined && collapse.kind === "ident" ? MODES.get(collapse.lower) : undefined) ?? COLLAPSE);
    }

    private addCharacters(text: TextSequence, mode: number): void {
        const source: string = text.text;
        this.texts.push(text);
        this.starts.push(this.units.length);
        for (let offset: number = 0; offset < source.length; offset++) {
            // CSS Text 4 §4: "Carriage returns (U+000D) are treated identically to spaces (U+0020) in all respects."
            const unit: number = source.charCodeAt(offset);
            const white: boolean = unit === SPACE || unit === TAB || unit === LINE_FEED || unit === CARRIAGE_RETURN;
            if (unit === CARRIAGE_RETURN) {
                this.units.push(SPACE);
            } else if (!white && (unit < SPACE || (unit >= DELETE && unit <= LAST_CONTROL))) {
                // §4: the other control characters "must be rendered as a visible glyph", and the UA may "substitute the glyphs
                // provided for the corresponding symbol in the Control Pictures block"; U+0080 to U+009F have no such symbol.
                this.units.push(unit < SPACE ? CONTROL_PICTURES + unit : (unit === DELETE ? DELETE_PICTURE : REPLACEMENT_CHARACTER));
            } else {
                this.units.push(unit);
            }
            this.modes.push(mode);
            // §4.1: discard directs user agents to discard "all white space in the element".
            this.marks.push(white && mode === DISCARD ? REMOVED : KEPT);
        }
    }

    private addObject(node: BoxNode): void {
        this.items.push({ kind: "object", node });
        this.addUnits();
    }

    private addUnits(): void {
        this.units.push(OBJECT);
        this.modes.push(NO_TEXT);
        this.marks.push(KEPT);
    }

    private trimOf(value?: CssValue): number {
        if (value === undefined) {
            return 0;
        }
        let trim: number = 0;
        for (const item of value.kind === "list" ? value.items : [value]) {
            trim |= item.kind === "ident" ? (TRIMS.get(item.lower) ?? 0) : 0;
        }
        return trim;
    }

    private resolve(owner: ElementBox, style: ComputedStyle, trimStart: boolean, trimEnd: boolean): void {
        if (this.items.length > 0) {
            // The inline content of the box, in order, for the stages that prepare and lay out its text.
            const sequence: InlineSequence = { style, items: this.items };
            owner.inline = owner.inline ?? [];
            owner.inline.push(sequence);
            this.sequences.push(sequence);
            this.items = [];
            for (const text of this.texts) {
                if (text.target !== undefined || text.named !== undefined || text.bookmark !== undefined) {
                    this.holders.set(text, sequence);
                    this.edges.set(sequence, { trimStart, trimEnd, suppressBreaks: this.suppressBreaks });
                }
            }
        }
        this.settle(trimStart, trimEnd);
    }

    private settle(trimStart: boolean, trimEnd: boolean): void {
        if (this.texts.length > 0) {
            // CSS Text 4 §4.2: "White space processing for white-space-trim takes place before § 4.3.1 Phase I".
            for (const [start, end, trim] of this.trims) {
                this.trimBox(start, end, trim);
            }
            if (trimStart || trimEnd) {
                this.trimContainer(trimStart, trimEnd);
            }
            this.removeAroundBreaks();
            this.transformBreaks();
            this.collapseSpaces();
            this.store();
        }
        this.units.length = 0;
        this.modes.length = 0;
        this.marks.length = 0;
        this.texts.length = 0;
        this.starts.length = 0;
        this.trims.length = 0;
    }

    private isWhite(index: number): boolean {
        const unit: number = this.units[index];
        return unit === SPACE || unit === TAB || unit === LINE_FEED;
    }

    private isCollapsibleSpace(index: number): boolean {
        // CSS Text 4 §4.3.1: with collapse or preserve-breaks "white space characters are considered collapsible".
        const mode: number = this.modes[index];
        return (mode === COLLAPSE || mode === PRESERVE_BREAKS) && (this.units[index] === SPACE || this.units[index] === TAB);
    }

    private isCollapsibleWhite(index: number): boolean {
        // CSS Text 4 §4.3.3: "When white-space-collapse is not collapse, segment breaks are not collapsible."
        return this.isCollapsibleSpace(index) || (this.units[index] === LINE_FEED && this.modes[index] === COLLAPSE);
    }

    private isIgnored(index: number): boolean {
        // CSS Text 4 §4.3.1: phase I works "ignoring bidi formatting characters (characters with the Bidi_Control property
        // [UAX9]) as if they were not there".
        const unit: number = this.units[index];
        return this.marks[index] === REMOVED || unit === 0x061C || unit === 0x200E || unit === 0x200F || (unit >= 0x202A && unit <= 0x202E)
            || (unit >= 0x2066 && unit <= 0x2069);
    }

    private trimBox(start: number, end: number, trim: number): void {
        const marks: Array<number> = this.marks;
        if ((trim & DISCARD_BEFORE) !== 0) {
            // "collapse all collapsible whitespace immediately before the start of the element".
            for (let index: number = start - 1; index >= 0 && (marks[index] === REMOVED || this.isCollapsibleWhite(index)); index--) {
                marks[index] = REMOVED;
            }
        }
        if ((trim & DISCARD_AFTER) !== 0) {
            for (let index: number = end; index < marks.length && (marks[index] === REMOVED || this.isCollapsibleWhite(index)); index++) {
                marks[index] = REMOVED;
            }
        }
        if ((trim & DISCARD_INNER) !== 0) {
            // For a box that is not a block container: "discard all whitespace at the beginning and end of the element".
            for (let index: number = start; index < end && (marks[index] === REMOVED || this.isWhite(index)); index++) {
                marks[index] = REMOVED;
            }
            for (let index: number = end - 1; index >= start && (marks[index] === REMOVED || this.isWhite(index)); index--) {
                marks[index] = REMOVED;
            }
        }
    }

    private trimContainer(trimStart: boolean, trimEnd: boolean): void {
        // CSS Text 4 §4.2, discard-inner on a block container: discard "up to and including the last segment break before the
        // first non-white-space character" and "starting with the first segment break after the last non-white-space character".
        const marks: Array<number> = this.marks;
        const count: number = marks.length;
        let firstSolid: number = 0;
        while (firstSolid < count && (marks[firstSolid] === REMOVED || this.isWhite(firstSolid))) {
            firstSolid++;
        }
        let lastSolid: number = count - 1;
        while (lastSolid >= 0 && (marks[lastSolid] === REMOVED || this.isWhite(lastSolid))) {
            lastSolid--;
        }
        let startBreak: number = firstSolid - 1;
        while (startBreak >= 0 && (marks[startBreak] === REMOVED || this.units[startBreak] !== LINE_FEED)) {
            startBreak--;
        }
        let endBreak: number = lastSolid + 1;
        while (endBreak < count && (marks[endBreak] === REMOVED || this.units[endBreak] !== LINE_FEED)) {
            endBreak++;
        }
        for (let index: number = 0; trimStart && index <= startBreak; index++) {
            marks[index] = REMOVED;
        }
        for (let index: number = endBreak; trimEnd && index < count; index++) {
            marks[index] = REMOVED;
        }
    }

    private removeAroundBreaks(): void {
        // CSS Text 4 §4.3.1: "Any sequence of collapsible spaces and tabs immediately preceding or following a segment break is
        // removed."
        const marks: Array<number> = this.marks;
        const count: number = marks.length;
        for (let index: number = 0; index < count; index++) {
            if (this.units[index] !== LINE_FEED || marks[index] === REMOVED) {
                continue;
            }
            for (let before: number = index - 1; before >= 0 && (this.isIgnored(before) || this.isCollapsibleSpace(before)); before--) {
                marks[before] = this.isCollapsibleSpace(before) ? REMOVED : marks[before];
            }
            for (let after: number = index + 1; after < count && (this.isIgnored(after) || this.isCollapsibleSpace(after)); after++) {
                marks[after] = this.isCollapsibleSpace(after) ? REMOVED : marks[after];
            }
        }
    }

    private transformBreaks(): void {
        const units: Array<number> = this.units;
        const marks: Array<number> = this.marks;
        const count: number = units.length;
        // CSS Ruby 1 §2.2: "Convert all forced line breaks inside ruby annotations (regardless of white-space value) as defined
        // for collapsible segment breaks".
        const suppress: boolean = this.suppressBreaks;
        // CSS Text 4 §4.3.3: "First, any collapsible segment break immediately following another collapsible segment break is
        // removed."
        let follows: boolean = false;
        for (let index: number = 0; index < count; index++) {
            if (this.isIgnored(index)) {
                continue;
            }
            const collapsible: boolean = units[index] === LINE_FEED && (suppress || this.modes[index] === COLLAPSE);
            if (collapsible && follows) {
                marks[index] = REMOVED;
            }
            follows = collapsible;
        }
        for (let index: number = 0; index < count; index++) {
            if (units[index] !== LINE_FEED || marks[index] === REMOVED) {
                continue;
            }
            const mode: number = this.modes[index];
            if (mode === PRESERVE_SPACES && !suppress) {
                // §4.3.1: with preserve-spaces "each tab and segment break is converted to a space".
                units[index] = SPACE;
            } else if (mode === COLLAPSE || suppress) {
                // The rules are "UA-defined in this level"; these are the ones of CSS Text 3 of 29 April 2020, §4.1.3: a break
                // next to U+200B or between two space-discarding characters is removed, and any other becomes a space.
                const before: number = this.characterBefore(index);
                const after: number = this.characterAfter(index);
                if (before === ZERO_WIDTH_SPACE || after === ZERO_WIDTH_SPACE || (this.discardsSpace(before) && this.discardsSpace(after))) {
                    marks[index] = REMOVED;
                } else {
                    units[index] = SPACE;
                }
            }
        }
    }

    private characterBefore(index: number): number {
        let before: number = index - 1;
        while (before >= 0 && this.isIgnored(before)) {
            before--;
        }
        if (before < 0) {
            return -1;
        }
        const unit: number = this.units[before];
        const lead: number = before > 0 ? this.units[before - 1] : 0;
        return unit >= 0xDC00 && unit <= 0xDFFF && lead >= 0xD800 && lead <= 0xDBFF ? ((lead - 0xD800) << 10) + (unit - 0xDC00) + 0x10000 : unit;
    }

    private characterAfter(index: number): number {
        const count: number = this.units.length;
        let after: number = index + 1;
        while (after < count && this.isIgnored(after)) {
            after++;
        }
        if (after >= count) {
            return -1;
        }
        const unit: number = this.units[after];
        const trail: number = after + 1 < count ? this.units[after + 1] : 0;
        return unit >= 0xD800 && unit <= 0xDBFF && trail >= 0xDC00 && trail <= 0xDFFF ? ((unit - 0xD800) << 10) + (trail - 0xDC00) + 0x10000 : unit;
    }

    private discardsSpace(codepoint: number): boolean {
        let low: number = 0;
        let high: number = SPACE_DISCARDING_RANGES.length - 1;
        while (low <= high) {
            const middle: number = (low + high) >> 1;
            if (codepoint < SPACE_DISCARDING_RANGES[middle][0]) {
                high = middle - 1;
            } else if (codepoint > SPACE_DISCARDING_RANGES[middle][1]) {
                low = middle + 1;
            } else {
                return true;
            }
        }
        return false;
    }

    private collapseSpaces(): void {
        // CSS Text 4 §4.3.1: "Every collapsible tab is converted to a collapsible space", and a collapsible space after another
        // one of the same inline formatting context "is collapsed to have zero advance width", keeping its soft wrap opportunity.
        const units: Array<number> = this.units;
        const count: number = units.length;
        let follows: boolean = false;
        for (let index: number = 0; index < count; index++) {
            if (this.isIgnored(index)) {
                continue;
            }
            const mode: number = this.modes[index];
            if (units[index] === TAB && (mode === COLLAPSE || mode === PRESERVE_BREAKS || mode === PRESERVE_SPACES)) {
                units[index] = SPACE;
            }
            const collapsible: boolean = units[index] === SPACE && (mode === COLLAPSE || mode === PRESERVE_BREAKS);
            if (collapsible && follows) {
                this.marks[index] = COLLAPSED;
            }
            follows = collapsible;
        }
    }

    private store(): void {
        for (let item: number = 0; item < this.texts.length; item++) {
            const text: TextSequence = this.texts[item];
            const source: string = text.text;
            const base: number = this.starts[item];
            let result: string = "";
            let copied: number = 0;
            let collapsed: Array<number> | undefined;
            for (let offset: number = 0; offset < source.length; offset++) {
                const mark: number = this.marks[base + offset];
                const unit: number = this.units[base + offset];
                if (mark === REMOVED || unit !== source.charCodeAt(offset)) {
                    result += source.substring(copied, offset) + (mark === REMOVED ? "" : String.fromCharCode(unit));
                    copied = offset + 1;
                }
                if (mark === COLLAPSED) {
                    collapsed = collapsed ?? [];
                    collapsed.push(result.length + offset - copied);
                }
            }
            if (copied > 0) {
                text.text = result + source.substring(copied);
            }
            if (collapsed !== undefined) {
                text.collapsedSpaces = collapsed;
            } else {
                delete text.collapsedSpaces;
            }
        }
    }
}
