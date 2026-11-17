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
import type { ElementBox, InlineSequence, InlineText, RubyColumn, RubyExtras, RubyLevel, RubySegment, TextRun } from "../pdf/BoxTree.js";
import { LineBreaker } from "../pdf/LineBreaker.js";

interface Entry {
    first: number;
    last: number;
    sequence: InlineSequence;
    box: ElementBox;
    container: ElementBox;
    from: number;
    to: number;
    width: number;
    align: string;
    level: number;
    under: boolean;
    before: number;
    after: number;
}

interface Unit {
    first: number;
    last: number;
    wide: boolean;
}

export interface RubyFit {
    base: RubyExtras;
    placed: Array<RubyColumn>;
}

const OBJECT: number = 0xFFFC;
const BOPOMOFO_START: number = 0x3100;
const BOPOMOFO_END: number = 0x312F;
const BOPOMOFO_EXTENDED_START: number = 0x31A0;
const BOPOMOFO_EXTENDED_END: number = 0x31BF;

export class RubyLayout {

    private readonly breaker: LineBreaker = new LineBreaker();
    private readonly graphemes: Intl.Segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
    private readonly widths: WeakMap<InlineText, Float64Array> = new WeakMap<InlineText, Float64Array>();
    private readonly glyphed: WeakMap<InlineText, Uint8Array> = new WeakMap<InlineText, Uint8Array>();

    fit(text: InlineText, segment: RubySegment, first: number, last: number, edge: readonly [number, number]): RubyFit {
        // CSS Ruby 1 §3.1.1: each ruby column is as wide as its widest content, and the content of the narrower boxes is spread over
        // it. §3.4: "After line-breaking, each fragment is laid out independently", so this is made for the bases that are on one
        // line, with the annotations that are paired with them only.
        const widths: Float64Array = this.widthsOf(text);
        const columns: Array<number> = [];
        for (let index: number = first; index <= last; index++) {
            columns.push(this.sum(widths, segment.bases[index].from, segment.bases[index].to));
        }
        const entries: Array<Entry> = [];
        for (const level of segment.levels) {
            const own: Array<Entry> = [];
            for (const note of level.notes) {
                if (note.first >= first && note.last <= last) {
                    own.push({
                        first: note.first, last: note.last, sequence: note.sequence, box: note.box, container: level.container, from: note.from, to: note.to,
                        width: this.sum(this.widthsOf(note.sequence.text as InlineText), note.from, note.to), align: note.align, level: level.level, under: level.under,
                        before: 0, after: 0
                    });
                }
            }
            entries.push(...this.merged(own, level, columns, first));
        }
        const sizes: Array<number> = this.sizes(text, widths, segment, columns, first, entries, edge);
        const base: RubyExtras = new Map<number, readonly [number, number]>();
        for (let index: number = first; index <= last; index++) {
            this.spread(text, segment.bases[index].from, segment.bases[index].to, sizes[index - first] - columns[index - first], segment.bases[index].align, base);
        }
        const placed: Array<RubyColumn> = [];
        for (const entry of entries) {
            let total: number = 0;
            for (let index: number = entry.first; index <= entry.last; index++) {
                total += sizes[index - first];
            }
            const extras: RubyExtras = new Map<number, readonly [number, number]>();
            this.spread(entry.sequence.text as InlineText, entry.from, entry.to, total + this.gaps(text, widths, segment, entry.first, entry.last) + entry.before + entry.after - entry.width,
                entry.align, extras);
            placed.push({
                start: segment.bases[entry.first].from, end: segment.bases[entry.last].to, from: entry.from, to: entry.to, sequence: entry.sequence, annotation: entry.box,
                level: entry.level, under: entry.under, segment: segment.index, before: entry.before, after: entry.after, room: 0, offset: 0, trail: 0, extras
            });
        }
        if (last === segment.bases.length - 1 && segment.empties.length > 0) {
            // §2.3.1: the annotations that have no base are paired with empty bases that follow the last one, side by side, and the
            // room that they take is after the last character of the base.
            const room: Array<number> = segment.empties.map((empty) => this.sum(this.widthsOf(empty.sequence.text as InlineText), empty.from, empty.to));
            const total: number = room.reduce((sum: number, width: number) => sum + width, 0);
            const anchor: readonly [number, number] = base.get(segment.tail - 1) ?? [0, 0];
            base.set(segment.tail - 1, [anchor[0], anchor[1] + total]);
            let offset: number = 0;
            for (const [index, empty] of segment.empties.entries()) {
                placed.push({
                    start: segment.tail, end: segment.tail, from: empty.from, to: empty.to, sequence: empty.sequence, annotation: empty.box, level: empty.level, under: empty.under,
                    segment: segment.index, before: 0, after: 0, room: room[index], offset, trail: total, extras: new Map<number, readonly [number, number]>()
                });
                offset += room[index];
            }
        }
        return { base, placed };
    }

    private merged(entries: Array<Entry>, level: RubyLevel, columns: ReadonlyArray<number>, first: number): Array<Entry> {
        // §4.2: with merge the annotations of the container are one annotation over all the bases they stand on, and with auto they
        // merge when any of them is wider than its bases.
        if (entries.length < 2 || level.merge === "separate") {
            return entries;
        }
        // §2.4: a hidden annotation between two of them splits the sequence, so each side is merged on its own.
        const groups: Array<Array<Entry>> = [[entries[0]]];
        for (let index: number = 1; index < entries.length; index++) {
            const previous: Entry = entries[index - 1];
            const split: boolean = level.hidden.some((range: readonly [number, number, ElementBox]) => range[0] > previous.last && range[1] < entries[index].first);
            if (split) {
                groups.push([]);
            }
            groups[groups.length - 1].push(entries[index]);
        }
        if (groups.length > 1) {
            return groups.flatMap((group: Array<Entry>) => this.merged(group, level, columns, first));
        }
        const wider: boolean = entries.some((entry: Entry) => {
            let total: number = 0;
            for (let index: number = entry.first; index <= entry.last; index++) {
                total += columns[index - first];
            }
            return entry.width > total;
        });
        if (level.merge === "auto" && !wider) {
            return entries;
        }
        const head: Entry = entries[0];
        const tail: Entry = entries[entries.length - 1];
        const widths: Float64Array = this.widthsOf(head.sequence.text as InlineText);
        return [{
            ...head, first: Math.min(...entries.map((entry: Entry) => entry.first)), last: Math.max(...entries.map((entry: Entry) => entry.last)), to: tail.to,
            width: this.sum(widths, head.from, tail.to), align: level.align
        }];
    }

    private sizes(text: InlineText, widths: Float64Array, segment: RubySegment, columns: ReadonlyArray<number>, first: number, entries: ReadonlyArray<Entry>,
        edge: readonly [number, number]): Array<number> {
        const sizes: Array<number> = columns.slice();
        for (const entry of entries) {
            this.overhang(text, widths, segment, columns, first, entry, edge);
        }
        // The annotations that stand over one base widen its column, and then those that span more bases, the fewest first, each
        // widening the columns it spans by an equal share of what it lacks, less what it overhangs.
        for (const entry of entries.filter((candidate: Entry) => candidate.first === candidate.last)) {
            sizes[entry.first - first] = Math.max(sizes[entry.first - first], entry.width - entry.before - entry.after);
        }
        for (const entry of entries.filter((candidate: Entry) => candidate.first !== candidate.last).sort((a: Entry, b: Entry) => (a.last - a.first) - (b.last - b.first))) {
            let total: number = 0;
            for (let index: number = entry.first; index <= entry.last; index++) {
                total += sizes[index - first];
            }
            // §3.1.1: the inter-character annotations between the columns "factor into measurement of annotations that span both".
            const needed: number = entry.width - entry.before - entry.after - this.gaps(text, widths, segment, entry.first, entry.last);
            if (needed > total) {
                for (let index: number = entry.first; index <= entry.last; index++) {
                    sizes[index - first] += (needed - total) / (entry.last - entry.first + 1);
                }
            }
        }
        return sizes;
    }

    private overhang(text: InlineText, widths: Float64Array, segment: RubySegment, columns: ReadonlyArray<number>, first: number, entry: Entry,
        edge: readonly [number, number]): void {
        // §5.1: with ruby-overhang: auto an annotation longer than its bases "may partially overlap adjacent boxes", as far as the UA
        // decides: here over the kana beside the ruby on the line that are no base of another one, by at most half the annotation's
        // font size.
        if (this.keyword(entry.container.style.values["ruby-overhang"]) === "none") {
            return;
        }
        let total: number = 0;
        for (let index: number = entry.first; index <= entry.last; index++) {
            total += columns[index - first];
        }
        const excess: number = entry.width - total;
        if (excess <= 0) {
            return;
        }
        const run: TextRun | undefined = (entry.sequence.text as InlineText).runs.find((candidate: TextRun) => candidate.start >= entry.from && candidate.start < entry.to);
        const limit: number = (run?.size ?? 0) / 2;
        const reach: (position: number) => number = (position: number): number => {
            if (position < edge[0] || position >= edge[1] || segment.marks[position] === 1 || !this.isKana(text.codepoints[position])) {
                return 0;
            }
            return Math.min(excess / 2, limit, widths[position]);
        };
        entry.before = reach(segment.bases[entry.first].from - 1);
        entry.after = reach(segment.bases[entry.last].to);
    }

    private gaps(text: InlineText, widths: Float64Array, segment: RubySegment, first: number, last: number): number {
        // The inter-character annotations are atomic inlines in the text, which follow the base that they are paired with.
        let total: number = 0;
        for (let index: number = first; index < last; index++) {
            for (let at: number = segment.bases[index].to; at < segment.bases[index + 1].from && text.codepoints[at] === OBJECT; at++) {
                total += widths[at];
            }
        }
        return total;
    }

    private spread(text: InlineText, from: number, to: number, extra: number, align: string, target: RubyExtras): void {
        // §4.3: space-between and space-around justify between the adjacent CJK characters, space-around with one more opportunity
        // around the content, and the content is centered where there is none.
        if (extra <= 0) {
            return;
        }
        const units: Array<Unit> = this.units(text, from, to);
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
        // The space before a unit goes before its first character and the space after it after its last, as the text has them.
        const add: (position: number, lead: number, trail: number) => void = (position: number, lead: number, trail: number): void => {
            const known: readonly [number, number] = target.get(position) ?? [0, 0];
            target.set(position, [known[0] + lead, known[1] + trail]);
        };
        for (const [index, unit] of units.entries()) {
            if (before[index] !== 0) {
                add(unit.first, before[index], 0);
            }
            if (after[index] !== 0) {
                add(unit.last, 0, after[index]);
            }
        }
    }

    private units(text: InlineText, from: number, to: number): Array<Unit> {
        // The characters that are set together, by grapheme cluster, which have glyphs of their own.
        const shown: Uint8Array = this.glyphsOf(text);
        let characters: string = "";
        for (let position: number = from; position < to; position++) {
            characters += String.fromCodePoint(text.codepoints[position]);
        }
        const units: Array<Unit> = [];
        let at: number = from;
        for (const cluster of this.graphemes.segment(characters)) {
            const length: number = Array.from(cluster.segment).length;
            let has: boolean = false;
            for (let position: number = at; position < at + length; position++) {
                has = has || shown[position] === 1;
            }
            if (has) {
                const code: number = cluster.segment.codePointAt(0) as number;
                const bopomofo: boolean = (code >= BOPOMOFO_START && code <= BOPOMOFO_END) || (code >= BOPOMOFO_EXTENDED_START && code <= BOPOMOFO_EXTENDED_END);
                units.push({ first: at, last: at + length - 1, wide: this.breaker.isWideOrFullwidth(code) && !bopomofo });
            }
            at += length;
        }
        return units;
    }

    private glyphsOf(text: InlineText): Uint8Array {
        let shown: Uint8Array | undefined = this.glyphed.get(text);
        if (shown === undefined) {
            shown = new Uint8Array(text.codepoints.length);
            for (let glyph: number = 0; glyph < text.glyphs.length; glyph++) {
                shown[text.clusters[glyph]] = 1;
            }
            this.glyphed.set(text, shown);
        }
        return shown;
    }

    private widthsOf(text: InlineText): Float64Array {
        // What each character takes of the line: the advances of its glyphs and the spacing around it.
        let widths: Float64Array | undefined = this.widths.get(text);
        if (widths === undefined) {
            widths = new Float64Array(text.codepoints.length);
            for (let glyph: number = 0; glyph < text.glyphs.length; glyph++) {
                widths[text.clusters[glyph]] += text.advances[glyph];
            }
            for (let position: number = 0; position < widths.length; position++) {
                widths[position] += text.spacingBefore[position] + text.spacingAfter[position];
            }
            this.widths.set(text, widths);
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

    private isKana(code: number): boolean {
        return (code >= 0x3040 && code <= 0x30FF) || (code >= 0xFF66 && code <= 0xFF9F);
    }

    private keyword(value?: CssValue): string | undefined {
        return value !== undefined && value.kind === "ident" ? value.lower : undefined;
    }
}
