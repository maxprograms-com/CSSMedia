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
import type { BoxNode, ElementBox, InlineSequence, InlineText, RubyColumn, TextRun, TextSequence } from "./BoxTree.js";
import { DisplayTypes } from "./DisplayTypes.js";
import { LineBreaker } from "./LineBreaker.js";
import { RubyPairing } from "./RubyPairing.js";

interface Location {
    sequence: InlineSequence;
    from: number;
    to: number;
}

interface Column {
    box: ElementBox;
    from: number;
    to: number;
    width: number;
}

interface Entry {
    first: number;
    last: number;
    sequence: InlineSequence;
    box: ElementBox;
    from: number;
    to: number;
    width: number;
    align: string;
    level: number;
    under: boolean;
    container: ElementBox;
    before: number;
    after: number;
}

interface Orphan {
    place: Location;
    annotation: ElementBox;
    level: number;
    under: boolean;
    width: number;
}

interface Unit {
    glyphs: Array<number>;
    wide: boolean;
}

const BOPOMOFO_START: number = 0x3100;
const BOPOMOFO_END: number = 0x312F;
const BOPOMOFO_EXTENDED_START: number = 0x31A0;
const BOPOMOFO_EXTENDED_END: number = 0x31BF;

export class RubyColumns {

    private readonly displays: DisplayTypes = new DisplayTypes();
    private readonly pairing: RubyPairing = new RubyPairing();
    private readonly breaker: LineBreaker = new LineBreaker();
    private readonly graphemes: Intl.Segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
    private segments: number = 0;

    apply(sequences: ReadonlyArray<InlineSequence>): void {
        // CSS Ruby 1 §3.1.1: each ruby column is as wide as its widest content, and the bases and annotations are spread to it; the
        // extra space is put into the advances of the glyphs, so the lines are measured and broken with it.
        const located: Map<ElementBox, Location> = new Map<ElementBox, Location>();
        for (const sequence of sequences) {
            this.locate(sequence, located);
        }
        for (const sequence of sequences) {
            delete sequence.ruby;
            if (sequence.text === undefined) {
                continue;
            }
            for (const item of sequence.items) {
                if (item.kind === "open" && item.node.kind === "box" && this.displays.isRubyContainer(item.node.display)) {
                    this.container(sequence, item.node, located);
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

    private container(sequence: InlineSequence, ruby: ElementBox, located: Map<ElementBox, Location>): void {
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
                this.segment(sequence, baseContainer, levels, positions, located, baseContainer === undefined ? empties[used++] : undefined);
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
                // level before them; over and under alone are fixed.
                const alternates: boolean = keywords.includes("alternate") || (!keywords.includes("over") && !keywords.includes("under"));
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

    private segment(sequence: InlineSequence, baseContainer: ElementBox | undefined, levels: ReadonlyArray<ElementBox>, positions: ReadonlyArray<boolean>,
        located: Map<ElementBox, Location>, emptyAt: number | undefined): void {
        const text: InlineText = sequence.text as InlineText;
        const bases: Array<ElementBox> = baseContainer === undefined ? [] : baseContainer.children.filter((node: BoxNode): node is ElementBox =>
            node.kind === "box" && node.placement === "in-flow" && node.display.internal === "ruby-base" && node.rubyWhiteSpace === undefined);
        const widths: Float64Array = this.characterWidths(text);
        const columns: Array<Column> = [];
        for (const box of bases) {
            const place: Location | undefined = located.get(box);
            columns.push({ box, from: place?.from ?? 0, to: place?.to ?? 0, width: place === undefined ? 0 : this.sum(widths, place.from, place.to) });
        }
        const entries: Array<Entry> = [];
        const orphans: Array<Orphan> = [];
        for (const [level, container] of levels.entries()) {
            const own: Array<Entry> = [];
            for (const pair of this.pairing.pairs(container, baseContainer)) {
                const place: Location | undefined = located.get(pair.annotation);
                if (place !== undefined && pair.bases === undefined && !this.pairing.isHidden(pair, container)) {
                    // §2.3.1: an annotation with no base of its own is paired with "an anonymous, empty ruby base" after the last one.
                    orphans.push({ place, annotation: pair.annotation, level, under: positions[level], width: this.sum(this.characterWidths(place.sequence.text as InlineText), place.from, place.to) });
                }
                if (place === undefined || pair.bases === undefined || this.pairing.isHidden(pair, container)) {
                    continue;
                }
                const first: number = bases.indexOf(pair.bases[0]);
                const last: number = bases.indexOf(pair.bases[pair.bases.length - 1]);
                if (first < 0 || last < first) {
                    continue;
                }
                const annotated: InlineText = place.sequence.text as InlineText;
                own.push({
                    first, last, sequence: place.sequence, box: pair.annotation, from: place.from, to: place.to, width: this.sum(this.characterWidths(annotated), place.from, place.to),
                    align: this.keyword(pair.annotation.style.values["ruby-align"]) ?? "space-around", level, under: positions[level], container, before: 0, after: 0
                });
            }
            entries.push(...this.merged(own, container, columns));
        }
        if (entries.length === 0 && orphans.length === 0) {
            return;
        }
        // §2.3.1: with no ruby base container, "an anonymous, empty ruby base container is assumed to exist before" the annotations,
        // so the empty base is a character with no advance of its own, and the annotations stand after it.
        if (columns.length === 0) {
            if (emptyAt === undefined) {
                return;
            }
            for (let glyph: number = 0; glyph < text.glyphs.length; glyph++) {
                if (text.clusters[glyph] === emptyAt) {
                    text.advances[glyph] = 0;
                }
            }
        }
        const start: number = columns.length > 0 ? columns[columns.length - 1].to : (emptyAt as number) + 1;
        const sizes: Array<number> = columns.map((column: Column) => column.width);
        const annotated: Uint8Array = this.baseCharacters(sequence, located);
        for (const entry of entries) {
            this.overhang(text, widths, annotated, entry, columns);
        }
        // The annotations that stand over one base widen its column, and then those that span more bases, the fewest first, each
        // widening the columns it spans by an equal share of what it lacks, less what it overhangs.
        for (const entry of entries.filter((candidate: Entry) => candidate.first === candidate.last)) {
            sizes[entry.first] = Math.max(sizes[entry.first], entry.width - entry.before - entry.after);
        }
        for (const entry of entries.filter((candidate: Entry) => candidate.first !== candidate.last).sort((a: Entry, b: Entry) => (a.last - a.first) - (b.last - b.first))) {
            let total: number = 0;
            for (let index: number = entry.first; index <= entry.last; index++) {
                total += sizes[index];
            }
            const needed: number = entry.width - entry.before - entry.after;
            if (needed > total) {
                for (let index: number = entry.first; index <= entry.last; index++) {
                    sizes[index] += (needed - total) / (entry.last - entry.first + 1);
                }
            }
        }
        // §3.4: the line may break only where all the levels allow it, and never inside a base or between bases that an annotation
        // spans, so a column stays whole.
        for (const entry of entries) {
            this.keep(text, columns[entry.first].from, columns[entry.last].to);
        }
        for (const column of columns) {
            this.keep(text, column.from, column.to);
        }
        for (const [index, column] of columns.entries()) {
            this.spread(text, column.from, column.to, sizes[index] - column.width, this.keyword(column.box.style.values["ruby-align"]) ?? "space-around");
        }
        const records: Array<RubyColumn> = sequence.ruby ?? [];
        for (const entry of entries) {
            let total: number = 0;
            for (let index: number = entry.first; index <= entry.last; index++) {
                total += sizes[index];
            }
            this.spread(entry.sequence.text as InlineText, entry.from, entry.to, total + entry.before + entry.after - entry.width, entry.align);
            records.push({
                start: columns[entry.first].from, end: columns[entry.last].to, from: entry.from, to: entry.to, sequence: entry.sequence, annotation: entry.box, level: entry.level,
                under: entry.under, segment: this.segments, before: entry.before, after: entry.after, room: 0, offset: 0, trail: 0
            });
        }
        // The empty bases follow the last base, side by side, and the room they take goes into the advance of its last glyph.
        const trail: number = orphans.reduce((total: number, orphan: Orphan) => total + orphan.width, 0);
        let offset: number = 0;
        for (const orphan of orphans) {
            records.push({
                start, end: start, from: orphan.place.from, to: orphan.place.to, sequence: orphan.place.sequence, annotation: orphan.annotation, level: orphan.level,
                under: orphan.under, segment: this.segments, before: 0, after: 0, room: orphan.width, offset, trail
            });
            offset += orphan.width;
        }
        if (trail > 0) {
            this.leave(text, columns.length > 0 ? columns[columns.length - 1].from : start - 1, start, trail);
        }
        this.segments++;
        sequence.ruby = records;
    }

    private leave(text: InlineText, from: number, to: number, room: number): void {
        for (let position: number = to - 1; position >= from; position--) {
            for (let glyph: number = text.glyphs.length - 1; glyph >= 0; glyph--) {
                if (text.clusters[glyph] === position) {
                    text.advances[glyph] += room;
                    return;
                }
            }
        }
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

    private overhang(text: InlineText, widths: Float64Array, annotated: Uint8Array, entry: Entry, columns: ReadonlyArray<Column>): void {
        // §5.1: with ruby-overhang: auto an annotation longer than its bases "may partially overlap adjacent boxes", as far as the UA
        // decides: here over the kana beside the ruby that are no base of another one, by at most half the annotation's font size.
        if (this.keyword(entry.container.style.values["ruby-overhang"]) === "none") {
            return;
        }
        let total: number = 0;
        for (let index: number = entry.first; index <= entry.last; index++) {
            total += columns[index].width;
        }
        const excess: number = entry.width - total;
        if (excess <= 0) {
            return;
        }
        const run: TextRun | undefined = (entry.sequence.text as InlineText).runs.find((candidate: TextRun) => candidate.start >= entry.from && candidate.start < entry.to);
        const limit: number = (run?.size ?? 0) / 2;
        const reach: (position: number) => number = (position: number): number => {
            if (position < 0 || position >= text.codepoints.length || annotated[position] === 1 || !this.isKana(text.codepoints[position])) {
                return 0;
            }
            return Math.min(excess / 2, limit, widths[position]);
        };
        entry.before = reach(columns[entry.first].from - 1);
        entry.after = reach(columns[entry.last].to);
    }

    private isKana(code: number): boolean {
        return (code >= 0x3040 && code <= 0x30FF) || (code >= 0xFF66 && code <= 0xFF9F);
    }

    private keep(text: InlineText, from: number, to: number): void {
        for (let position: number = from + 1; position < to; position++) {
            if (text.breaks[position] !== LineBreaker.MANDATORY) {
                text.breaks[position] = LineBreaker.NONE;
            }
        }
    }

    private merged(entries: Array<Entry>, container: ElementBox, columns: ReadonlyArray<Column>): Array<Entry> {
        // §4.2: with merge the annotations of the container are one annotation over all the bases they stand on, and with auto they
        // merge when any of them is wider than its bases.
        const keyword: string = this.keyword(container.style.values["ruby-merge"]) ?? "separate";
        if (entries.length < 2 || keyword === "separate") {
            return entries;
        }
        const wider: boolean = entries.some((entry: Entry) => {
            let total: number = 0;
            for (let index: number = entry.first; index <= entry.last; index++) {
                total += columns[index].width;
            }
            return entry.width > total;
        });
        if (keyword === "auto" && !wider) {
            return entries;
        }
        const head: Entry = entries[0];
        const tail: Entry = entries[entries.length - 1];
        const own: InlineText = head.sequence.text as InlineText;
        const widths: Float64Array = this.characterWidths(own);
        return [{
            ...head, first: Math.min(...entries.map((entry: Entry) => entry.first)), last: Math.max(...entries.map((entry: Entry) => entry.last)), to: tail.to,
            width: this.sum(widths, head.from, tail.to), align: this.keyword(container.style.values["ruby-align"]) ?? "space-around"
        }];
    }

    private characterWidths(text: InlineText): Float64Array {
        // What each character takes of the line: the advances of its glyphs and the spacing around it.
        const widths: Float64Array = new Float64Array(text.codepoints.length);
        for (let glyph: number = 0; glyph < text.glyphs.length; glyph++) {
            widths[text.clusters[glyph]] += text.advances[glyph];
        }
        for (let position: number = 0; position < widths.length; position++) {
            widths[position] += text.spacingBefore[position] + text.spacingAfter[position];
        }
        return widths;
    }

    private sum(widths: Float64Array, from: number, to: number): number {
        let total: number = 0;
        for (let position: number = from; position < to; position++) {
            total += widths[position];
        }
        return total;
    }

    private spread(text: InlineText, from: number, to: number, extra: number, align: string): void {
        // §4.3: space-between and space-around justify between the adjacent CJK characters, space-around with one more opportunity
        // around the content, and the content is centered where there is none.
        if (extra <= 0) {
            return;
        }
        const glyphs: Map<number, Array<number>> = new Map<number, Array<number>>();
        for (let glyph: number = 0; glyph < text.glyphs.length; glyph++) {
            const position: number = text.clusters[glyph];
            if (position >= from && position < to) {
                glyphs.set(position, [...(glyphs.get(position) ?? []), glyph]);
            }
        }
        const units: Array<Unit> = this.units(text, from, to, glyphs);
        if (units.length === 0) {
            return;
        }
        const before: Array<number> = new Array<number>(units.length).fill(0);
        const after: Array<number> = new Array<number>(units.length).fill(0);
        const between: Array<number> = [];
        for (let index: number = 1; index < units.length; index++) {
            if (units[index - 1].wide && units[index].wide) {
                between.push(index);
            }
        }
        const around: boolean = align === "space-around";
        const opportunities: number = between.length + (around || between.length === 0 ? 1 : 0);
        if (align === "start") {
            after[units.length - 1] = extra;
        } else if (align === "center" || (!around && between.length === 0)) {
            before[0] = extra / 2;
            after[units.length - 1] = extra / 2;
        } else {
            const share: number = extra / opportunities;
            for (const index of between) {
                after[index - 1] += share / 2;
                before[index] += share / 2;
            }
            if (around || between.length === 0) {
                before[0] += share / 2;
                after[units.length - 1] += share / 2;
            }
        }
        for (const [index, unit] of units.entries()) {
            this.widen(text, unit, before[index], after[index]);
        }
    }

    private units(text: InlineText, from: number, to: number, byCluster: ReadonlyMap<number, ReadonlyArray<number>>): Array<Unit> {
        let characters: string = "";
        for (let position: number = from; position < to; position++) {
            characters += String.fromCodePoint(text.codepoints[position]);
        }
        const units: Array<Unit> = [];
        let at: number = from;
        for (const cluster of this.graphemes.segment(characters)) {
            const length: number = Array.from(cluster.segment).length;
            const glyphs: Array<number> = [];
            for (let position: number = at; position < at + length; position++) {
                glyphs.push(...(byCluster.get(position) ?? []));
            }
            glyphs.sort((first: number, second: number) => first - second);
            if (glyphs.length > 0) {
                const code: number = cluster.segment.codePointAt(0) as number;
                const bopomofo: boolean = (code >= BOPOMOFO_START && code <= BOPOMOFO_END) || (code >= BOPOMOFO_EXTENDED_START && code <= BOPOMOFO_EXTENDED_END);
                units.push({ glyphs, wide: this.breaker.isWideOrFullwidth(code) && !bopomofo });
            }
            at += length;
        }
        return units;
    }

    private widen(text: InlineText, unit: Unit, before: number, after: number): void {
        // The space before a unit is a shift of its first glyph, which is moved along the line, and the space after it goes into
        // the advance; a glyph of a right-to-left run has its space before on the side of the end of its run.
        if (before === 0 && after === 0) {
            return;
        }
        const first: number = unit.glyphs[0];
        const last: number = unit.glyphs[unit.glyphs.length - 1];
        const run: TextRun | undefined = text.runs.find((candidate: TextRun) => first >= candidate.glyphStart && first < candidate.glyphEnd);
        const reversed: boolean = run !== undefined && (run.level & 1) === 1;
        const shift: number = first === last && reversed ? after : before;
        text.advances[first] += before + (first === last ? after : 0);
        if (first !== last) {
            text.advances[last] += after;
        }
        if (text.xOffsets === undefined) {
            text.xOffsets = new Float64Array(text.glyphs.length);
        }
        if (text.yOffsets === undefined) {
            text.yOffsets = new Float64Array(text.glyphs.length);
        }
        if (run !== undefined && run.upright) {
            text.yOffsets[first] -= shift;
        } else {
            text.xOffsets[first] += shift;
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
