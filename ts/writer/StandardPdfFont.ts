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

import type { FontInstance, StandardFontData } from "../fonts/Typeface.js";
import type { FontResource, FontRun } from "./PdfFont.js";
import { PdfFont } from "./PdfFont.js";
import type { PdfFile } from "./PdfFile.js";
import { PdfSyntax } from "./PdfSyntax.js";
import { TrueTypeSubsetter } from "./TrueTypeSubsetter.js";

interface EncodingPart {
    resource: FontResource;
    glyphs: Array<number>;
    texts: Array<string>;
}

interface MissingPart {
    resource: FontResource;
    texts: Array<string>;
}

const CODES: number = 256;
const FIXED_PITCH: number = 1;
const SERIF: number = 2;
const SYMBOLIC: number = 4;
const NONSYMBOLIC: number = 32;
const ITALIC: number = 64;
const SYMBOLIC_FAMILIES: ReadonlySet<string> = new Set<string>(["Symbol", "ZapfDingbats"]);
const MISSING_NAME: string = "CSSMedia-Missing-";
const MISSING_GID: number = 1;
const MISSING_GLYPH_COUNT: number = 2;
const MISSING_GLYF_LENGTH: number = 56;
const LAST_CID: number = 0xFFFF;
const ON_CURVE: number = 1;
const SFNT_VERSION: number = 0x00010000;
const HEAD_MAGIC: number = 0x5F0F3CF5;

export class StandardPdfFont extends PdfFont {

    private readonly file: PdfFile;
    private readonly instance: FontInstance;
    private readonly data: StandardFontData;
    private readonly syntax: PdfSyntax = new PdfSyntax();
    private readonly parts: Array<EncodingPart> = [];
    private readonly placed: Map<number, readonly [number, number]> = new Map<number, readonly [number, number]>();
    private readonly variants: Map<string, readonly [number, number]> = new Map<string, readonly [number, number]>();
    private readonly missingParts: Array<MissingPart> = [];
    private readonly missingPlaced: Map<string, readonly [number, number]> = new Map<string, readonly [number, number]>();

    constructor(file: PdfFile, instance: FontInstance, data: StandardFontData) {
        super();
        this.file = file;
        this.instance = instance;
        this.data = data;
    }

    show(glyph: number, text: string): FontRun {
        // ISO 32000-2 §9.6.5.1: a simple font has one-byte codes, so the glyphs of a document are given codes in the order
        // they are first shown, and every 256 of them make another font dictionary with its own encoding.
        if (glyph === 0) {
            // §9.10.3: one square stands for every missing character, so each gets a code of its own for its text.
            let at: readonly [number, number] | undefined = this.missingPlaced.get(text);
            if (at === undefined) {
                at = this.appendMissing(text);
                this.missingPlaced.set(text, at);
            }
            return [this.missingParts[at[0]].resource, "<" + at[1].toString(16).toUpperCase().padStart(4, "0") + ">"];
        }
        const [where, code]: readonly [number, number] = this.place(glyph, text);
        return [this.parts[where].resource, "<" + code.toString(16).toUpperCase().padStart(2, "0") + ">"];
    }

    width(glyph: number): number {
        // The metrics of the standard fonts have 1000 units to the em, the unit of glyph space.
        return this.instance.advances[glyph] ?? 0;
    }

    write(): void {
        // §9.6.2.2, Table 109: in PDF 2.0 FirstChar, LastChar, Widths and FontDescriptor are required for the standard
        // fonts too; §9.6.5: the encoding gives each code its glyph by name, as Differences from the built-in encoding.
        if (this.missingParts.length > 0) {
            this.writeMissing();
        }
        if (this.parts.length === 0) {
            return;
        }
        const descriptor: number = this.file.add(this.descriptor(this.data.name, SYMBOLIC_FAMILIES.has(this.data.family), ""));
        for (const part of this.parts) {
            const names: Array<string> = part.glyphs.map((glyph: number) => this.syntax.name(this.data.glyphNames[glyph - 1]));
            const widths: Array<number> = part.glyphs.map((glyph: number) => this.width(glyph));
            const unicode: Array<readonly [number, string]> = part.texts.map((text: string, code: number): readonly [number, string] => [code, text]);
            const toUnicode: number = this.file.addStream("", this.unicodeMap(unicode, 1), true);
            this.file.set(part.resource.object, "<< /Type /Font /Subtype /Type1 /BaseFont " + this.syntax.name(this.data.name) + " /FirstChar 0 /LastChar "
                + (part.glyphs.length - 1) + " /Widths [" + this.syntax.numbers(widths) + "] /FontDescriptor " + this.syntax.reference(descriptor)
                + " /Encoding << /Type /Encoding /Differences [0 " + names.join(" ") + "] >> /ToUnicode " + this.syntax.reference(toUnicode) + " >>");
        }
    }

    private place(glyph: number, text: string): readonly [number, number] {
        // A glyph that more than one character uses, such as the space for the no-break space, has a code for each text, since
        // a ToUnicode CMap gives one text to a code; the encoding names the same glyph for all of them.
        const first: readonly [number, number] | undefined = this.placed.get(glyph);
        if (first === undefined) {
            const position: readonly [number, number] = this.append(glyph, text);
            this.placed.set(glyph, position);
            return position;
        }
        if (text.length === 0) {
            return first;
        }
        const known: string = this.parts[first[0]].texts[first[1]];
        if (known.length === 0) {
            this.parts[first[0]].texts[first[1]] = text;
            return first;
        }
        if (known === text) {
            return first;
        }
        const key: string = glyph + "|" + text;
        let variant: readonly [number, number] | undefined = this.variants.get(key);
        if (variant === undefined) {
            variant = this.append(glyph, text);
            this.variants.set(key, variant);
        }
        return variant;
    }

    private append(glyph: number, text: string): readonly [number, number] {
        let part: EncodingPart | undefined = this.parts[this.parts.length - 1];
        if (part === undefined || part.glyphs.length === CODES) {
            const object: number = this.file.reserve();
            part = { resource: { key: "F" + object, object }, glyphs: [], texts: [] };
            this.parts.push(part);
        }
        const position: readonly [number, number] = [this.parts.length - 1, part.glyphs.length];
        part.glyphs.push(glyph);
        part.texts.push(text);
        return position;
    }

    private appendMissing(text: string): readonly [number, number] {
        // The codes of a Type 0 font with Identity-H are two bytes, and code 0 is left to .notdef, so a font dictionary holds
        // 65535 characters and the next one goes to another dictionary, as the simple fonts do with their 256 codes.
        let part: MissingPart | undefined = this.missingParts[this.missingParts.length - 1];
        if (part === undefined || part.texts.length === LAST_CID) {
            const object: number = this.file.reserve();
            part = { resource: { key: "F" + object, object }, texts: this.missingParts.length === 0 ? [""] : [] };
            if (this.missingParts.length === 0) {
                this.missingPlaced.set("", [0, 1]);
            }
            this.missingParts.push(part);
        }
        const known: readonly [number, number] | undefined = this.missingPlaced.get(text);
        if (known !== undefined) {
            return known;
        }
        part.texts.push(text);
        return [this.missingParts.length - 1, part.texts.length];
    }

    private writeMissing(): void {
        // CSS Fonts 4 §5.2: "the user agent should indicate by some means that a character is not being displayed", and the
        // standard fonts have no glyph for that.
        const name: string = MISSING_NAME + this.data.name;
        const data: Buffer = this.missingProgram();
        const program: string = "/FontFile2 " + this.syntax.reference(this.file.addStream("/Length1 " + data.length, data, true));
        const descriptor: number = this.file.add(this.descriptor(name, true, program));
        for (const part of this.missingParts) {
            const map: Buffer = Buffer.alloc((part.texts.length + 1) * 2);
            for (let code: number = 1; code <= part.texts.length; code++) {
                map.writeUInt16BE(MISSING_GID, code * 2);
            }
            const descendant: number = this.file.add("<< /Type /Font /Subtype /CIDFontType2 /BaseFont " + this.syntax.name(name)
                + " /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor " + this.syntax.reference(descriptor)
                + " /DW " + this.syntax.number(this.width(0)) + " /CIDToGIDMap " + this.syntax.reference(this.file.addStream("", map, true)) + " >>");
            const unicode: Array<readonly [number, string]> = part.texts.map((text: string, index: number): readonly [number, string] => [index + 1, text]);
            const toUnicode: number = this.file.addStream("", this.unicodeMap(unicode, 2), true);
            this.file.set(part.resource.object, "<< /Type /Font /Subtype /Type0 /BaseFont " + this.syntax.name(name) + " /Encoding /Identity-H /DescendantFonts ["
                + this.syntax.reference(descendant) + "] /ToUnicode " + this.syntax.reference(toUnicode) + " >>");
        }
    }

    private missingProgram(): Buffer {
        // Glyphs fill by the nonzero rule, so the inner contour must run against the outer one to leave the box hollow.
        const [left, bottom, right, top]: ReadonlyArray<number> = Array.from((this.instance.typeface.glyphs.bounds as Int16Array).subarray(0, 4));
        const stem: number = this.data.stemV;
        const advance: number = this.instance.advances[0];
        const points: ReadonlyArray<readonly [number, number]> = [[left, bottom], [left, top], [right, top], [right, bottom],
            [left + stem, bottom + stem], [right - stem, bottom + stem], [right - stem, top - stem], [left + stem, top - stem]];
        const glyf: Buffer = Buffer.alloc(MISSING_GLYF_LENGTH);
        glyf.writeInt16BE(2, 0);
        glyf.writeInt16BE(left, 2);
        glyf.writeInt16BE(bottom, 4);
        glyf.writeInt16BE(right, 6);
        glyf.writeInt16BE(top, 8);
        glyf.writeUInt16BE(3, 10);
        glyf.writeUInt16BE(points.length - 1, 12);
        glyf.fill(ON_CURVE, 16, 16 + points.length);
        points.forEach((point: readonly [number, number], index: number) => {
            glyf.writeInt16BE(point[0] - (index === 0 ? 0 : points[index - 1][0]), 16 + points.length + index * 2);
            glyf.writeInt16BE(point[1] - (index === 0 ? 0 : points[index - 1][1]), 16 + points.length * 3 + index * 2);
        });
        const loca: Buffer = Buffer.alloc((MISSING_GLYPH_COUNT + 1) * 2);
        loca.writeUInt16BE(MISSING_GLYF_LENGTH / 2, MISSING_GLYPH_COUNT * 2);
        const head: Buffer = Buffer.alloc(54);
        head.writeUInt32BE(SFNT_VERSION, 0);
        head.writeUInt32BE(SFNT_VERSION, 4);
        head.writeUInt32BE(HEAD_MAGIC, 12);
        head.writeUInt16BE(this.instance.metrics.unitsPerEm, 18);
        head.writeInt16BE(left, 36);
        head.writeInt16BE(bottom, 38);
        head.writeInt16BE(right, 40);
        head.writeInt16BE(top, 42);
        const hhea: Buffer = Buffer.alloc(36);
        hhea.writeUInt32BE(SFNT_VERSION, 0);
        hhea.writeInt16BE(top, 4);
        hhea.writeInt16BE(bottom, 6);
        hhea.writeUInt16BE(advance, 10);
        hhea.writeInt16BE(left, 12);
        hhea.writeInt16BE(advance - right, 14);
        hhea.writeInt16BE(right, 16);
        hhea.writeInt16BE(1, 18);
        hhea.writeUInt16BE(MISSING_GLYPH_COUNT, 34);
        const hmtx: Buffer = Buffer.alloc(MISSING_GLYPH_COUNT * 4);
        hmtx.writeUInt16BE(advance, 0);
        hmtx.writeUInt16BE(advance, 4);
        hmtx.writeInt16BE(left, 6);
        const maxp: Buffer = Buffer.alloc(32);
        maxp.writeUInt32BE(SFNT_VERSION, 0);
        maxp.writeUInt16BE(MISSING_GLYPH_COUNT, 4);
        maxp.writeUInt16BE(points.length, 6);
        maxp.writeUInt16BE(2, 8);
        maxp.writeUInt16BE(1, 14);
        return new TrueTypeSubsetter().assemble(new Map<string, Buffer>([["glyf", glyf], ["head", head], ["hhea", hhea], ["hmtx", hmtx], ["loca", loca], ["maxp", maxp]]));
    }

    private descriptor(name: string, symbolic: boolean, program: string): string {
        // §9.8, Table 120 and §9.8.2: the metrics come from the AFM data of the font. The data names no serifs; Times is
        // the one family of the standard fonts that has them.
        const data: StandardFontData = this.data;
        const flags: number = (data.fixedPitch ? FIXED_PITCH : 0) | (data.family === "Times" ? SERIF : 0)
            | (symbolic ? SYMBOLIC : NONSYMBOLIC) | (data.italicAngle !== 0 ? ITALIC : 0);
        const ascent: number = data.ascender ?? data.bounds[3];
        return "<< /Type /FontDescriptor /FontName " + this.syntax.name(name) + " /FontFamily " + this.syntax.literal(data.family) + " /Flags " + flags
            + " /FontBBox [" + this.syntax.numbers(data.bounds) + "] /ItalicAngle " + this.syntax.number(data.italicAngle) + " /Ascent " + this.syntax.number(ascent)
            + " /Descent " + this.syntax.number(data.descender ?? data.bounds[1]) + " /CapHeight " + this.syntax.number(data.capHeight ?? ascent)
            + (data.xHeight === undefined ? "" : " /XHeight " + this.syntax.number(data.xHeight)) + " /StemV " + this.syntax.number(data.stemV)
            + (program.length === 0 ? "" : " " + program) + " >>";
    }
}
