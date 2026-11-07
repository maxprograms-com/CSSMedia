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

import { BaselineReader } from "./BaselineReader.js";
import { CharacterMapReader } from "./CharacterMapReader.js";
import { NameTableReader } from "./NameTableReader.js";
import type { FaceMetrics, FontVariations, GlyphMetrics, LineMetrics, ScriptMetrics, SfntFont, Typeface, VerticalOrigins } from "./Typeface.js";
import { VariationReader } from "./VariationReader.js";

const USE_TYPO_METRICS: number = 0x0080;

export class TypefaceReader {

    private readonly characterMaps: CharacterMapReader = new CharacterMapReader();
    private readonly variations: VariationReader = new VariationReader();
    private readonly baselines: BaselineReader = new BaselineReader();

    read(font: SfntFont, source: string, index: number): Typeface {
        const tables: Readonly<Record<string, Buffer>> = font.tables;
        const head: Buffer = this.required(tables, "head", 54);
        const maxp: Buffer = this.required(tables, "maxp", 6);
        const hhea: Buffer = this.required(tables, "hhea", 36);
        const hmtx: Buffer = this.required(tables, "hmtx", 0);
        // OpenType: a table whose major version is not recognized is treated as missing.
        if (head.readUInt16BE(0) !== 1 || hhea.readUInt16BE(0) !== 1) {
            throw new Error("The head or hhea table of the font has an unknown version");
        }
        const glyphCount: number = maxp.readUInt16BE(4);
        const names: NameTableReader = new NameTableReader(tables["name"]);
        const typeface: Typeface = {
            source,
            index,
            tables,
            names: names.names(),
            glyphCount,
            characters: this.characterMaps.read(glyphCount, tables["cmap"]),
            metrics: this.metrics(tables, head, hhea),
            glyphs: this.glyphMetrics(tables, hhea, hmtx, glyphCount),
            baselines: this.baselines.read(this.variations, tables["BASE"])
        };
        const variations: FontVariations | undefined = this.variations.read(tables, names);
        if (variations !== undefined) {
            typeface.variations = variations;
        }
        return typeface;
    }

    private required(tables: Readonly<Record<string, Buffer>>, tag: string, minimum: number): Buffer {
        const table: Buffer | undefined = tables[tag];
        if (table === undefined || table.length < minimum) {
            throw new Error("The font has no valid " + tag + " table");
        }
        return table;
    }

    private metrics(tables: Readonly<Record<string, Buffer>>, head: Buffer, hhea: Buffer): FaceMetrics {
        const os2: Buffer | undefined = tables["OS/2"];
        const post: Buffer | undefined = tables["post"];
        const vhea: Buffer | undefined = tables["vhea"];
        const os2Version: number = os2 !== undefined && os2.length >= 2 ? os2.readUInt16BE(0) : -1;
        const hasBasicOs2: boolean = os2 !== undefined && os2.length >= 68;
        const hasTypographic: boolean = os2 !== undefined && os2.length >= 78;
        const hasHeights: boolean = os2 !== undefined && os2Version >= 2 && os2.length >= 90;
        const hasPost: boolean = post !== undefined && post.length >= 16;
        const selection: number = hasBasicOs2 ? (os2 as Buffer).readUInt16BE(62) : 0;
        const metrics: FaceMetrics = {
            unitsPerEm: head.readUInt16BE(18),
            bounds: [head.readInt16BE(36), head.readInt16BE(38), head.readInt16BE(40), head.readInt16BE(42)],
            horizontal: { ascender: hhea.readInt16BE(4), descender: hhea.readInt16BE(6), lineGap: hhea.readInt16BE(8) },
            useTypographic: os2Version >= 4 && (selection & USE_TYPO_METRICS) !== 0,
            italicAngle: hasPost ? (post as Buffer).readInt32BE(4) / 65536 : 0,
            fixedPitch: hasPost ? (post as Buffer).readUInt32BE(12) !== 0 : false,
            weightClass: hasBasicOs2 ? (os2 as Buffer).readUInt16BE(4) : 400,
            widthClass: hasBasicOs2 ? (os2 as Buffer).readUInt16BE(6) : 5,
            selection,
            macStyle: head.readUInt16BE(44)
        };
        if (hasTypographic) {
            metrics.typographic = this.lineMetrics(os2 as Buffer, 68);
            metrics.windowsAscent = (os2 as Buffer).readUInt16BE(74);
            metrics.windowsDescent = (os2 as Buffer).readUInt16BE(76);
        }
        if (hasHeights) {
            metrics.xHeight = (os2 as Buffer).readInt16BE(86);
            metrics.capHeight = (os2 as Buffer).readInt16BE(88);
        }
        if (hasPost) {
            metrics.underlinePosition = (post as Buffer).readInt16BE(8);
            metrics.underlineThickness = (post as Buffer).readInt16BE(10);
        }
        if (hasBasicOs2) {
            metrics.strikeoutPosition = (os2 as Buffer).readInt16BE(28);
            metrics.strikeoutSize = (os2 as Buffer).readInt16BE(26);
            metrics.subscript = this.scriptMetrics(os2 as Buffer, 10);
            metrics.superscript = this.scriptMetrics(os2 as Buffer, 18);
        }
        if (vhea !== undefined && vhea.length >= 36) {
            metrics.vertical = this.lineMetrics(vhea, 4);
        }
        return metrics;
    }

    private lineMetrics(table: Buffer, offset: number): LineMetrics {
        return { ascender: table.readInt16BE(offset), descender: table.readInt16BE(offset + 2), lineGap: table.readInt16BE(offset + 4) };
    }

    private scriptMetrics(os2: Buffer, offset: number): ScriptMetrics {
        return { xSize: os2.readInt16BE(offset), ySize: os2.readInt16BE(offset + 2), xOffset: os2.readInt16BE(offset + 4), yOffset: os2.readInt16BE(offset + 6) };
    }

    private glyphMetrics(tables: Readonly<Record<string, Buffer>>, hhea: Buffer, hmtx: Buffer, glyphCount: number): GlyphMetrics {
        const horizontal: [Uint16Array, Int16Array] = this.metricsTable(hmtx, hhea.readUInt16BE(34), glyphCount);
        const vhea: Buffer | undefined = tables["vhea"];
        const vmtx: Buffer | undefined = tables["vmtx"];
        const vertical: [Uint16Array, Int16Array] | undefined = vhea !== undefined && vhea.length >= 36 && vmtx !== undefined ? this.metricsTable(vmtx, vhea.readUInt16BE(34), glyphCount) : undefined;
        const metrics: GlyphMetrics = { advances: horizontal[0] };
        const origins: VerticalOrigins | undefined = this.verticalOrigins(tables["VORG"]);
        if (vertical !== undefined) {
            metrics.verticalAdvances = vertical[0];
            metrics.topBearings = vertical[1];
        }
        if (origins !== undefined) {
            metrics.verticalOrigins = origins;
        }
        return metrics;
    }

    private metricsTable(table: Buffer, metricCount: number, glyphCount: number): [Uint16Array, Int16Array] {
        // OpenType hmtx and vmtx: glyphs past the last long metric repeat its advance.
        const advances: Uint16Array = new Uint16Array(glyphCount);
        const bearings: Int16Array = new Int16Array(glyphCount);
        const longCount: number = Math.min(metricCount, glyphCount, Math.floor(table.length / 4));
        if (longCount === 0) {
            throw new Error("The font has no glyph metrics");
        }
        for (let glyph: number = 0; glyph < longCount; glyph++) {
            advances[glyph] = table.readUInt16BE(glyph * 4);
            bearings[glyph] = table.readInt16BE(glyph * 4 + 2);
        }
        const lastAdvance: number = advances[longCount - 1];
        for (let glyph: number = longCount; glyph < glyphCount; glyph++) {
            const position: number = longCount * 4 + (glyph - longCount) * 2;
            advances[glyph] = lastAdvance;
            bearings[glyph] = position + 2 <= table.length ? table.readInt16BE(position) : 0;
        }
        return [advances, bearings];
    }

    private verticalOrigins(vorg?: Buffer): VerticalOrigins | undefined {
        if (vorg === undefined || vorg.length < 8 || vorg.readUInt16BE(0) !== 1) {
            return undefined;
        }
        const count: number = Math.min(vorg.readUInt16BE(6), Math.floor((vorg.length - 8) / 4));
        const glyphs: Uint16Array = new Uint16Array(count);
        const values: Int16Array = new Int16Array(count);
        for (let index: number = 0; index < count; index++) {
            glyphs[index] = vorg.readUInt16BE(8 + index * 4);
            values[index] = vorg.readInt16BE(10 + index * 4);
        }
        return { defaultY: vorg.readInt16BE(4), glyphs, values };
    }
}
