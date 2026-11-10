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

import type { OutlineBounds } from "../fonts/CompactOutlines.js";
import { CompactOutlines } from "../fonts/CompactOutlines.js";
import { GlyphOutlines } from "../fonts/GlyphOutlines.js";
import type { FaceMetrics, FontInstance, LineMetrics, Typeface, VerticalOrigins } from "../fonts/Typeface.js";
import type { FontResource, FontRun } from "./PdfFont.js";
import { CffSubsetter } from "./CffSubsetter.js";
import { GlyphInstancer } from "./GlyphInstancer.js";
import { PdfFont } from "./PdfFont.js";
import type { PdfFile } from "./PdfFile.js";
import { PdfSyntax } from "./PdfSyntax.js";
import { TrueTypeSubsetter } from "./TrueTypeSubsetter.js";

const UNITS: number = 1000;
const FIXED_PITCH: number = 1;
const SYMBOLIC: number = 4;
const ITALIC: number = 64;
const ITALIC_SELECTION: number = 0x0001;
const OBLIQUE_SELECTION: number = 0x0200;
const NAME_EXCLUDED: RegExp = /[^\x21-\x7E]|[()<>[\]{}/%]/g;

export class EmbeddedPdfFont extends PdfFont {

    private readonly file: PdfFile;
    private readonly instance: FontInstance;
    private readonly vertical: boolean;
    private readonly tag: string;
    private readonly resource: FontResource;
    private readonly syntax: PdfSyntax = new PdfSyntax();
    private readonly used: Set<number> = new Set<number>([0]);
    private readonly texts: Map<number, string> = new Map<number, string>();
    private readonly compact?: CompactOutlines;
    private readonly cids?: Uint32Array;

    constructor(file: PdfFile, instance: FontInstance, vertical: boolean, tag: string) {
        super();
        const tables: Readonly<Record<string, Buffer>> = instance.typeface.tables;
        // ISO 32000-2 §9.9.1, Table 124, embeds "CFF " but not CFF2, which needs code that turns it into what PDF embeds, so
        // until it exists the run stops instead of drawing wrong glyphs; a synthesized face is written from its own outlines.
        if (tables["glyf"] === undefined && tables["CFF "] === undefined && tables["CFF2"] !== undefined && instance.emboldening === undefined) {
            throw new Error("The font " + instance.typeface.names.postScriptName + " has CFF2 outlines, whose conversion for PDF is not implemented");
        }
        this.file = file;
        this.instance = instance;
        this.vertical = vertical;
        this.tag = tag;
        const object: number = file.reserve();
        this.resource = { key: "F" + object, object };
        if (tables["glyf"] === undefined && instance.emboldening === undefined) {
            const compact: CompactOutlines | undefined = CompactOutlines.of(tables, instance.coordinates);
            if (compact !== undefined) {
                this.compact = compact;
                const cids: Uint32Array | undefined = compact.cids();
                if (cids !== undefined) {
                    this.cids = cids;
                }
            }
        }
    }

    show(glyphs: ArrayLike<number>, start: number, end: number): Array<FontRun> {
        // ISO 32000-2 §9.7.5.2: with Identity-H and Identity-V each code is two bytes and is the CID itself; §9.7.4.2:
        // for TrueType outlines and for a CFF font without CIDs the CID is the glyph index.
        let codes: string = "";
        for (let index: number = start; index < end; index++) {
            const glyph: number = glyphs[index];
            this.used.add(glyph);
            codes += this.code(glyph).toString(16).toUpperCase().padStart(4, "0");
        }
        return codes.length === 0 ? [] : [[this.resource, "<" + codes + ">"]];
    }

    use(glyph: number, text: string): void {
        const known: string | undefined = this.texts.get(glyph);
        if (known === undefined || known.length === 0) {
            this.texts.set(glyph, text);
        }
    }

    width(glyph: number): number {
        return (this.instance.advances[glyph] ?? 0) * UNITS / this.instance.metrics.unitsPerEm;
    }

    write(): void {
        // §9.7.6: a Type 0 font whose one descendant is the CIDFont of §9.7.4, with the font program embedded as §9.9 says
        // and a ToUnicode CMap for the text of each glyph.
        const typeface: Typeface = this.instance.typeface;
        const tables: Readonly<Record<string, Buffer>> = typeface.tables;
        const name: string = this.tag + "+" + (typeface.names.postScriptName.replace(NAME_EXCLUDED, "") || "Font");
        let program: string;
        let subtype: string;
        const synthesized: boolean = this.instance.emboldening !== undefined && (tables["CFF "] !== undefined || tables["CFF2"] !== undefined);
        if (tables["glyf"] !== undefined || synthesized) {
            // A PDF font has no way to name a variation instance or a synthesized bold face, so the font program is the face itself,
            // in TrueType outlines whatever those of its source.
            const written: boolean = this.instance.emboldening !== undefined || this.instance.coordinates.some((value: number) => value !== 0);
            const data: Buffer = new TrueTypeSubsetter().subset(written ? new GlyphInstancer().tables(this.instance, this.used) : tables, this.used);
            program = "/FontFile2 " + this.syntax.reference(this.file.addStream("/Length1 " + data.length, data, true));
            subtype = "CIDFontType2";
        } else if (tables["CFF "] === undefined) {
            // §9.8, Table 120: the font program is optional, and a font whose glyphs are only bitmaps has none.
            program = "";
            subtype = "CIDFontType2";
        } else {
            // §9.9.1, Table 124: a CFF program for a CIDFontType0 font, whether or not its Top DICT has the CIDFont operators.
            const cff: Buffer = this.compact === undefined ? tables["CFF "] : new CffSubsetter().subset(tables["CFF "], this.used, this.compact);
            program = "/FontFile3 " + this.syntax.reference(this.file.addStream("/Subtype /CIDFontType0C", cff, true));
            subtype = "CIDFontType0";
        }
        const cmap: string = this.vertical ? "Identity-V" : "Identity-H";
        const descriptor: number = this.file.add(this.descriptor(name, program));
        const descendant: number = this.file.add("<< /Type /Font /Subtype /" + subtype + " /BaseFont " + this.syntax.name(name)
            + " /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor " + this.syntax.reference(descriptor)
            + " /DW " + this.syntax.number(this.width(0)) + " /W [" + this.widths() + "]" + (this.vertical ? " /W2 [" + this.verticalWidths() + "]" : "")
            + (subtype === "CIDFontType2" ? " /CIDToGIDMap /Identity" : "") + " >>");
        const unicode: Array<readonly [number, string]> = [...this.texts].map((entry: [number, string]): readonly [number, string] => [this.code(entry[0]), entry[1]]);
        const toUnicode: number = this.file.addStream("", this.unicodeMap(unicode, 2), true);
        // §9.7.6.1, Table 119: the name of the Type 0 font is that of a Type 2 CIDFont, and that of a Type 0 one with the CMap.
        const baseFont: string = subtype === "CIDFontType2" ? name : name + "-" + cmap;
        this.file.set(this.resource.object, "<< /Type /Font /Subtype /Type0 /BaseFont " + this.syntax.name(baseFont) + " /Encoding /" + cmap + " /DescendantFonts ["
            + this.syntax.reference(descendant) + "] /ToUnicode " + this.syntax.reference(toUnicode) + " >>");
    }

    private code(glyph: number): number {
        return this.cids === undefined ? glyph : (this.cids[glyph] ?? 0);
    }

    private widths(): string {
        // §9.7.4.3: c [w1 w2 ...] for consecutive CIDs, in glyph space units of 1000 to the em.
        const codes: Array<readonly [number, number]> = [...this.used].map((glyph: number): readonly [number, number] => [this.code(glyph), glyph]);
        codes.sort((first: readonly [number, number], second: readonly [number, number]) => first[0] - second[0]);
        const groups: Array<string> = [];
        for (let index: number = 0; index < codes.length;) {
            let end: number = index;
            while (end + 1 < codes.length && codes[end + 1][0] === codes[end][0] + 1) {
                end++;
            }
            const values: Array<number> = [];
            for (let item: number = index; item <= end; item++) {
                values.push(this.width(codes[item][1]));
            }
            groups.push(codes[index][0] + " [" + this.syntax.numbers(values) + "]");
            index = end + 1;
        }
        return groups.join(" ");
    }

    private verticalWidths(): string {
        // §9.7.4.3: c [w1y vx vy] for each CID, the vertical advance going down and the origin of vertical writing from the
        // origin of horizontal writing; "vhea" and "vmtx" are never read by a PDF processor (§9.9.1).
        const groups: Array<string> = [];
        for (const glyph of this.used) {
            const metrics: readonly [number, number, number] = this.verticalMetrics(glyph);
            groups.push(this.code(glyph) + " [" + this.syntax.numbers(metrics) + "]");
        }
        return groups.join(" ");
    }

    private verticalMetrics(glyph: number): readonly [number, number, number] {
        // OpenType vmtx and VORG: the vertical advance of the glyph, or the height of the line without vmtx; the vertical
        // origin from VORG, or else from the top side bearing over the top of the glyph, or else at the ascender.
        const scale: number = UNITS / this.instance.metrics.unitsPerEm;
        const lines: LineMetrics = this.lineMetrics();
        const advance: number = this.instance.verticalAdvances?.[glyph] ?? lines.ascender - lines.descender;
        const origins: VerticalOrigins | undefined = this.instance.typeface.glyphs.verticalOrigins;
        let origin: number = lines.ascender;
        if (origins !== undefined) {
            origin = this.verticalOrigin(origins, glyph);
        } else {
            const bearing: number | undefined = this.instance.typeface.glyphs.topBearings?.[glyph];
            const top: number | undefined = bearing === undefined ? undefined : this.top(glyph);
            origin = bearing !== undefined && top !== undefined ? top + bearing : origin;
        }
        return [-advance * scale, this.width(glyph) / 2, origin * scale];
    }

    private verticalOrigin(origins: VerticalOrigins, glyph: number): number {
        let low: number = 0;
        let high: number = origins.glyphs.length - 1;
        while (low <= high) {
            const middle: number = (low + high) >> 1;
            if (origins.glyphs[middle] === glyph) {
                return origins.values[middle];
            }
            if (origins.glyphs[middle] < glyph) {
                low = middle + 1;
            } else {
                high = middle - 1;
            }
        }
        return origins.defaultY;
    }

    private top(glyph: number): number | undefined {
        if (this.compact !== undefined) {
            const bounds: OutlineBounds | undefined = this.compact.bounds(glyph);
            return bounds?.yMax;
        }
        return new GlyphOutlines().bounds(this.instance, glyph)?.yMax;
    }

    private lineMetrics(): LineMetrics {
        const metrics: FaceMetrics = this.instance.metrics;
        return metrics.useTypographic && metrics.typographic !== undefined ? metrics.typographic : metrics.horizontal;
    }

    private descriptor(name: string, program: string): string {
        // §9.8, Table 120 and §9.8.2: a CIDFont is symbolic; the metrics are those of the instance, scaled to 1000 units,
        // and StemV is 0, "an unknown stem thickness", since OpenType has no such value.
        const metrics: FaceMetrics = this.instance.metrics;
        const scale: number = UNITS / metrics.unitsPerEm;
        const lines: LineMetrics = this.lineMetrics();
        const italic: boolean = metrics.italicAngle !== 0 || (metrics.selection & (ITALIC_SELECTION | OBLIQUE_SELECTION)) !== 0;
        const flags: number = (metrics.fixedPitch ? FIXED_PITCH : 0) | SYMBOLIC | (italic ? ITALIC : 0);
        // A synthesized bold face grows every glyph by half its thin stroke.
        const grown: number = (this.instance.emboldening ?? 0) / 2;
        const bounds: Array<number> = metrics.bounds.map((value: number, index: number) => (index < 2 ? value - grown : value + grown) * scale);
        return "<< /Type /FontDescriptor /FontName " + this.syntax.name(name) + " /FontFamily " + this.syntax.textString(this.instance.typeface.names.family)
            + " /FontWeight " + this.weight(metrics.weightClass) + " /Flags " + flags + " /FontBBox [" + this.syntax.numbers(bounds) + "] /ItalicAngle "
            + this.syntax.number(metrics.italicAngle) + " /Ascent " + this.syntax.number(lines.ascender * scale) + " /Descent " + this.syntax.number(this.descent(lines, metrics) * scale)
            + " /CapHeight " + this.syntax.number((metrics.capHeight ?? lines.ascender) * scale)
            + (metrics.xHeight === undefined ? "" : " /XHeight " + this.syntax.number(metrics.xHeight * scale)) + " /StemV 0 " + program + " >>";
    }

    private descent(lines: LineMetrics, metrics: FaceMetrics): number {
        // Table 120: "The value shall be a negative number", also for a font whose line metrics give no depth.
        return lines.descender < 0 ? lines.descender : Math.min(-1, metrics.bounds[1]);
    }

    private weight(weightClass: number): number {
        // Table 120: FontWeight is one of 100, 200, ... 900.
        return Math.min(900, Math.max(100, Math.round(weightClass / 100) * 100));
    }
}
