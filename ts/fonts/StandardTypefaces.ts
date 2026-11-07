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

import { STANDARD_FONTS } from "./generated/StandardFonts.js";
import type { CharacterMap, FaceMetrics, LineMetrics, StandardFontData, Typeface } from "./Typeface.js";

const UNITS_PER_EM: number = 1000;
const SPACE: number = 0x20;
const DIGIT_ZERO: number = 0x30;
const NO_BREAK_SPACE: number = 0xA0;
const NARROW_NO_BREAK_SPACE: number = 0x202F;
const ITALIC: number = 0x0001;
const BOLD: number = 0x0020;
const REGULAR: number = 0x0040;
const OBLIQUE: number = 0x0200;

export class StandardTypefaces {

    private readonly typefaces: Map<string, Typeface> = new Map<string, Typeface>();

    names(): Array<string> {
        return STANDARD_FONTS.map((font: StandardFontData) => font.name);
    }

    typeface(name: string): Typeface | undefined {
        let typeface: Typeface | undefined = this.typefaces.get(name);
        if (typeface === undefined) {
            const data: StandardFontData | undefined = STANDARD_FONTS.find((font: StandardFontData) => font.name === name);
            if (data === undefined) {
                return undefined;
            }
            typeface = this.build(data);
            this.typefaces.set(name, typeface);
        }
        return typeface;
    }

    private build(data: StandardFontData): Typeface {
        const glyphCount: number = data.glyphNames.length + 1;
        const advances: Uint16Array = new Uint16Array(glyphCount);
        const bounds: Int16Array = new Int16Array(glyphCount * 4);
        for (let glyph: number = 1; glyph < glyphCount; glyph++) {
            advances[glyph] = data.widths[glyph - 1];
            bounds.set(data.boxes.slice((glyph - 1) * 4, glyph * 4), glyph * 4);
        }
        // The AFM metrics have no missing character glyph, and CSS Fonts 4 §5.2 needs one that shows.
        const zero: number = data.codes.findIndex((codes: ReadonlyArray<number>) => codes.includes(DIGIT_ZERO));
        advances[0] = zero < 0 ? UNITS_PER_EM / 2 : data.widths[zero];
        bounds.set([data.stemV, 0, advances[0] - data.stemV, data.capHeight ?? data.ascender ?? data.bounds[3]], 0);
        const bold: boolean = data.weight === "Bold";
        const oblique: boolean = data.name.endsWith("Oblique");
        const italic: boolean = data.name.endsWith("Italic");
        return {
            source: data.name,
            index: 0,
            standardFont: data.name,
            tables: this.kerningTable(data.kerning),
            names: {
                families: [data.family],
                family: data.family,
                fullName: data.name,
                postScriptName: data.name
            },
            glyphCount,
            characters: this.characterMap(data),
            metrics: this.metrics(data, bold, oblique, italic),
            glyphs: { advances, bounds },
            baselines: {}
        };
    }

    private characterMap(data: StandardFontData): CharacterMap {
        const pairs: Array<[number, number]> = [];
        data.codes.forEach((codes: ReadonlyArray<number>, index: number) => {
            for (const code of codes) {
                pairs.push([code, index + 1]);
            }
        });
        // ISO 32000-1 Annex D, Table D.2: the Latin encodings give the no-break space the glyph of the space.
        const space: [number, number] | undefined = pairs.find((pair: [number, number]) => pair[0] === SPACE);
        if (space !== undefined && !pairs.some((pair: [number, number]) => pair[0] === NO_BREAK_SPACE)) {
            pairs.push([NO_BREAK_SPACE, space[1]]);
        }
        // The fonts have no narrow no-break space, which French punctuation needs; it takes the glyph of the space too.
        if (space !== undefined && !pairs.some((pair: [number, number]) => pair[0] === NARROW_NO_BREAK_SPACE)) {
            pairs.push([NARROW_NO_BREAK_SPACE, space[1]]);
        }
        pairs.sort((first: [number, number], second: [number, number]) => first[0] - second[0]);
        const starts: Array<number> = [];
        const ends: Array<number> = [];
        const bases: Array<number> = [];
        for (const pair of pairs) {
            const last: number = starts.length - 1;
            if (last >= 0 && pair[0] === ends[last]) {
                continue;
            }
            if (last >= 0 && pair[0] === ends[last] + 1 && pair[1] === bases[last] + (pair[0] - starts[last])) {
                ends[last] = pair[0];
                continue;
            }
            starts.push(pair[0]);
            ends.push(pair[0]);
            bases.push(pair[1]);
        }
        return {
            starts: Uint32Array.from(starts),
            ends: Uint32Array.from(ends),
            modes: new Uint8Array(starts.length),
            bases: Int32Array.from(bases),
            glyphs: new Uint16Array(0),
            variations: []
        };
    }

    private metrics(data: StandardFontData, bold: boolean, oblique: boolean, italic: boolean): FaceMetrics {
        // The AFM files of Symbol and ZapfDingbats give no ascender or descender; the font bounding box stands in.
        const ascender: number = data.ascender ?? data.bounds[3];
        const descender: number = data.descender ?? data.bounds[1];
        // An AFM file has no line gap, and its ascender and descender alone make lines collide: CSS 2 §10.8.2 recommends "between
        // 1.0 to 1.2" for normal, which the height of the font bounding box gives for the text fonts.
        const lines: LineMetrics = { ascender, descender, lineGap: data.bounds[3] - data.bounds[1] - (ascender - descender) };
        const metrics: FaceMetrics = {
            unitsPerEm: UNITS_PER_EM,
            bounds: [data.bounds[0], data.bounds[1], data.bounds[2], data.bounds[3]],
            horizontal: lines,
            typographic: lines,
            useTypographic: false,
            underlinePosition: data.underlinePosition,
            underlineThickness: data.underlineThickness,
            italicAngle: data.italicAngle,
            fixedPitch: data.fixedPitch,
            weightClass: bold ? 700 : 400,
            widthClass: 5,
            selection: (italic ? ITALIC : 0) | (oblique ? OBLIQUE : 0) | (bold ? BOLD : 0) | (!bold && !italic && !oblique ? REGULAR : 0),
            macStyle: (bold ? 1 : 0) | (italic || oblique ? 2 : 0)
        };
        if (data.xHeight !== undefined) {
            metrics.xHeight = data.xHeight;
        }
        if (data.capHeight !== undefined) {
            metrics.capHeight = data.capHeight;
        }
        return metrics;
    }

    private kerningTable(kerning: ReadonlyArray<number>): Record<string, Buffer> {
        // AFM kerning pairs as an OpenType kern table, format 0, so that the shaper reads them like any font's.
        const count: number = kerning.length / 3;
        if (count === 0) {
            return {};
        }
        const pairs: Array<[number, number, number]> = [];
        for (let index: number = 0; index < kerning.length; index += 3) {
            pairs.push([kerning[index], kerning[index + 1], kerning[index + 2]]);
        }
        pairs.sort((first: [number, number, number], second: [number, number, number]) => first[0] - second[0] || first[1] - second[1]);
        const selector: number = Math.floor(Math.log2(count));
        const searchRange: number = 6 * Math.pow(2, selector);
        const table: Buffer = Buffer.alloc(4 + 14 + count * 6);
        table.writeUInt16BE(0, 0);
        table.writeUInt16BE(1, 2);
        table.writeUInt16BE(0, 4);
        table.writeUInt16BE(14 + count * 6, 6);
        table.writeUInt16BE(0x0001, 8);
        table.writeUInt16BE(count, 10);
        table.writeUInt16BE(searchRange, 12);
        table.writeUInt16BE(selector, 14);
        table.writeUInt16BE(count * 6 - searchRange, 16);
        pairs.forEach((pair: [number, number, number], index: number) => {
            table.writeUInt16BE(pair[0], 18 + index * 6);
            table.writeUInt16BE(pair[1], 20 + index * 6);
            table.writeInt16BE(pair[2], 22 + index * 6);
        });
        return { kern: table };
    }
}
