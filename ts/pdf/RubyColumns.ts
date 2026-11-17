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
import type { BoxNode, ElementBox, InlineSequence, InlineText, RubyBase, RubyEmpty, RubyLevel, RubyNote, RubySegment, TextSequence } from "./BoxTree.js";
import { DisplayTypes } from "./DisplayTypes.js";
import { LineBreaker } from "./LineBreaker.js";
import { RubyPairing } from "./RubyPairing.js";

interface Location {
    sequence: InlineSequence;
    from: number;
    to: number;
}

export class RubyColumns {

    private readonly displays: DisplayTypes = new DisplayTypes();
    private readonly pairing: RubyPairing = new RubyPairing();
    private segments: number = 0;

    apply(sequences: ReadonlyArray<InlineSequence>): void {
        // CSS Ruby 1 §2.3: the bases and the annotations of each ruby segment, in the text; how wide the columns are and where the
        // space goes is decided by the layout of each line (§3.4: "each fragment is laid out independently").
        const located: Map<ElementBox, Location> = new Map<ElementBox, Location>();
        for (const sequence of sequences) {
            this.locate(sequence, located);
        }
        for (const sequence of sequences) {
            delete sequence.ruby;
            if (sequence.text === undefined) {
                continue;
            }
            const marks: Uint8Array = this.baseCharacters(sequence, located);
            for (const item of sequence.items) {
                if (item.kind === "open" && item.node.kind === "box" && this.displays.isRubyContainer(item.node.display)) {
                    this.container(sequence, item.node, located, marks);
                }
            }
        }
    }

    private locate(sequence: InlineSequence, located: Map<ElementBox, Location>): void {
        const text: InlineText | undefined = sequence.text;
        if (text === undefined) {
            return;
        }
        const open: Array<number> = [];
        for (const [index, item] of sequence.items.entries()) {
            if (item.kind === "open") {
                open.push(index);
            } else if (item.kind === "close") {
                const opened: number | undefined = open.pop();
                if (opened !== undefined && item.node.kind === "box") {
                    located.set(item.node, { sequence, from: text.starts[opened], to: text.starts[index] });
                }
            }
        }
    }

    private container(sequence: InlineSequence, ruby: ElementBox, located: Map<ElementBox, Location>, marks: Uint8Array): void {
        const mode: string | undefined = this.keyword(ruby.style.values["writing-mode"]);
        const horizontal: boolean = mode === undefined || mode === "horizontal-tb";
        let baseContainer: ElementBox | undefined;
        let levels: Array<ElementBox> = [];
        let positions: Array<boolean> = [];
        const home: Location | undefined = located.get(ruby);
        const empties: Array<number> = this.emptyBases(sequence, home);
        let used: number = 0;
        const flush: () => void = (): void => {
            if (levels.length > 0) {
                this.segment(sequence, baseContainer, levels, positions, located, baseContainer === undefined ? empties[used++] : undefined, marks);
            }
            levels = [];
            positions = [];
        };
        for (const [index, child] of ruby.children.entries()) {
            if (child.kind !== "box" || child.placement !== "in-flow") {
                continue;
            }
            if (child.display.internal === "ruby-base-container") {
                flush();
                baseContainer = child;
            } else if (child.display.internal === "ruby-text-container") {
                const keywords: Array<string> = this.keywords(child.style.values["ruby-position"]);
                if (keywords.includes("inter-character") && horizontal) {
                    continue;
                }
                if (this.pairing.baseContainerOf(ruby, index) !== baseContainer) {
                    flush();
                    baseContainer = this.pairing.baseContainerOf(ruby, index);
                }
                // §4.1: alternate puts the first level over, or under with under, and the next levels on the other side of the
                // level before them; over and under alone are fixed, and inter-character in a vertical container "has the same effect as over".
                const alternates: boolean = keywords.includes("alternate") || (!keywords.includes("over") && !keywords.includes("under") && !keywords.includes("inter-character"));
                const under: boolean = alternates && positions.length > 0 ? !positions[positions.length - 1] : keywords.includes("under");
                levels.push(child);
                positions.push(under);
            }
        }
        flush();
    }

    private emptyBases(sequence: InlineSequence, home: Location | undefined): Array<number> {
        // The anonymous, empty ruby base that §2.3.1 assumes before an annotation container with no base container is a character
        // of its own in the text, which holds the room of the annotation.
        const text: InlineText = sequence.text as InlineText;
        const found: Array<number> = [];
        for (const [index, item] of sequence.items.entries()) {
            if (home !== undefined && item.kind === "text" && (item.node as TextSequence).emptyBase === true && text.starts[index] >= home.from && text.starts[index] < home.to) {
                found.push(text.starts[index]);
            }
        }
        return found;
    }

    private segment(sequence: InlineSequence, baseContainer: ElementBox | undefined, containers: ReadonlyArray<ElementBox>, positions: ReadonlyArray<boolean>,
        located: Map<ElementBox, Location>, emptyAt: number | undefined, marks: Uint8Array): void {
        const text: InlineText = sequence.text as InlineText;
        const boxes: Array<ElementBox> = baseContainer === undefined ? [] : baseContainer.children.filter((node: BoxNode): node is ElementBox =>
            node.kind === "box" && node.placement === "in-flow" && node.display.internal === "ruby-base" && node.rubyWhiteSpace === undefined);
        const bases: Array<RubyBase> = [];
        for (const box of boxes) {
            const place: Location | undefined = located.get(box);
            bases.push({ box, from: place?.from ?? 0, to: place?.to ?? 0, align: this.keyword(box.style.values["ruby-align"]) ?? "space-around" });
        }
        const levels: Array<RubyLevel> = [];
        const empties: Array<RubyEmpty> = [];
        for (const [level, container] of containers.entries()) {
            const notes: Array<RubyNote> = [];
            const hidden: Array<readonly [number, number, ElementBox]> = [];
            for (const pair of this.pairing.pairs(container, baseContainer)) {
                // §2.4: a hidden annotation separates the annotations beside it "as if they belonged to separate segments"; it is not
                // laid out, so no text holds it, and the box stays for the emphasis marks that stand outside it.
                if (this.pairing.isHidden(pair, container)) {
                    if (pair.bases !== undefined) {
                        hidden.push([boxes.indexOf(pair.bases[0]), boxes.indexOf(pair.bases[pair.bases.length - 1]), pair.annotation]);
                    }
                    continue;
                }
                const place: Location | undefined = located.get(pair.annotation);
                if (place === undefined) {
                    continue;
                }
                if (pair.bases === undefined) {
                    // §2.3.1: an annotation with no base of its own is paired with "an anonymous, empty ruby base" after the last one.
                    empties.push({ sequence: place.sequence, box: pair.annotation, from: place.from, to: place.to, level, under: positions[level] });
                    continue;
                }
                const first: number = boxes.indexOf(pair.bases[0]);
                const last: number = boxes.indexOf(pair.bases[pair.bases.length - 1]);
                if (first < 0 || last < first) {
                    continue;
                }
                notes.push({
                    sequence: place.sequence, box: pair.annotation, from: place.from, to: place.to, first, last,
                    align: this.keyword(pair.annotation.style.values["ruby-align"]) ?? "space-around"
                });
            }
            levels.push({
                container, level, under: positions[level], merge: this.keyword(container.style.values["ruby-merge"]) ?? "separate",
                align: this.keyword(container.style.values["ruby-align"]) ?? "space-around", notes, hidden
            });
        }
        // Text Decoration 4 §3.4: emphasis marks stand outside the ruby on their side, "auto-hidden and empty ruby annotations"
        // included, so a segment whose annotations are all hidden stays for them, with no other effect on the layout (§2.4).
        const shown: boolean = levels.some((level: RubyLevel) => level.notes.length > 0) || empties.length > 0;
        if (!shown && levels.every((level: RubyLevel) => level.hidden.length === 0)) {
            return;
        }
        // §2.3.1: with no ruby base container, "an anonymous, empty ruby base container is assumed to exist before" the annotations,
        // so the empty base is a character with no advance of its own, and the annotations stand after it.
        if (bases.length === 0 && shown) {
            if (emptyAt === undefined) {
                return;
            }
            for (let glyph: number = 0; glyph < text.glyphs.length; glyph++) {
                if (text.clusters[glyph] === emptyAt) {
                    text.advances[glyph] = 0;
                }
            }
        }
        // §3.4: the line may break only where all the levels allow it, and never inside a base or between bases that one annotation
        // spans, so a column stays whole. The annotations that ruby-merge joins stand over one base each until the line is made.
        // §2.4: a hidden annotation's base is as if it "were not a ruby base but an intervening inline", so it may break.
        for (const base of shown ? bases : []) {
            this.keep(text, base.from, base.to);
        }
        for (const level of levels) {
            for (const note of level.notes) {
                if (note.first !== note.last) {
                    this.keep(text, bases[note.first].from, bases[note.last].to);
                }
            }
        }
        const segment: RubySegment = {
            index: this.segments++, bases, levels, empties, tail: bases.length > 0 ? bases[bases.length - 1].to : (emptyAt as number) + 1, marks
        };
        sequence.ruby = sequence.ruby ?? [];
        sequence.ruby.push(segment);
    }

    private baseCharacters(sequence: InlineSequence, located: ReadonlyMap<ElementBox, Location>): Uint8Array {
        const marked: Uint8Array = new Uint8Array((sequence.text as InlineText).codepoints.length);
        for (const [box, place] of located) {
            if (place.sequence === sequence && box.display.internal === "ruby-base") {
                marked.fill(1, place.from, place.to);
            }
        }
        return marked;
    }

    private keep(text: InlineText, from: number, to: number): void {
        for (let position: number = from + 1; position < to; position++) {
            if (text.breaks[position] !== LineBreaker.MANDATORY) {
                text.breaks[position] = LineBreaker.NONE;
            }
        }
    }

    private keyword(value?: CssValue): string | undefined {
        return value !== undefined && value.kind === "ident" ? value.lower : undefined;
    }

    private keywords(value?: CssValue): Array<string> {
        if (value === undefined) {
            return [];
        }
        return (value.kind === "list" ? value.items : [value]).filter((item: CssValue) => item.kind === "ident").map((item: CssValue) => (item as { lower: string }).lower);
    }
}
