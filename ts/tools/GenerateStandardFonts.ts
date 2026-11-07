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

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";

interface AfmGlyph {
    name: string;
    width: number;
    box: ReadonlyArray<number>;
}

interface AfmFont {
    name: string;
    family: string;
    weight: string;
    italicAngle: number;
    fixedPitch: boolean;
    bounds: ReadonlyArray<number>;
    capHeight?: number;
    xHeight?: number;
    ascender?: number;
    descender?: number;
    underlinePosition: number;
    underlineThickness: number;
    stemV: number;
    glyphs: ReadonlyArray<AfmGlyph>;
    kerning: ReadonlyArray<readonly [string, string, number]>;
}

const STANDARD_FONTS: ReadonlyArray<string> = [
    "Helvetica", "Helvetica-Bold", "Helvetica-Oblique", "Helvetica-BoldOblique",
    "Times-Roman", "Times-Bold", "Times-Italic", "Times-BoldItalic",
    "Courier", "Courier-Bold", "Courier-Oblique", "Courier-BoldOblique",
    "Symbol", "ZapfDingbats"
];

const CHARACTER_LINE: RegExp = /^C\s+-?\d+\s*;\s*WX\s+(-?\d+)\s*;\s*N\s+(\S+)\s*;\s*B\s+(-?\d+)\s+(-?\d+)\s+(-?\d+)\s+(-?\d+)\s*;/;
const KERNING_LINE: RegExp = /^KPX\s+(\S+)\s+(\S+)\s+(-?\d+)/;
const GLYPH_LIST_LINE: RegExp = /^([^#;\s][^;]*);([0-9A-Fa-f]{4,6})$/;
const SYMBOL_GREEK: ReadonlyArray<readonly [string, number]> = [["Delta", 0x394], ["Omega", 0x3A9], ["mu", 0x3BC]];

class StandardFontGenerator {

    private readonly afmFolder: string;
    private readonly glyphListFolder: string;
    private readonly outputPath: string;

    constructor(afmFolder: string, glyphListFolder: string, outputPath: string) {
        this.afmFolder = afmFolder;
        this.glyphListFolder = glyphListFolder;
        this.outputPath = outputPath;
    }

    run(): void {
        const latin: Map<string, Array<number>> = this.glyphList(readFileSync(join(this.glyphListFolder, "glyphlist.txt"), "utf8"));
        const dingbats: Map<string, Array<number>> = this.glyphList(readFileSync(join(this.glyphListFolder, "zapfdingbats.txt"), "utf8"));
        // The glyph list gives these three names the signs U+2206, U+2126 and U+00B5, and the Greek letters other names; in Symbol,
        // whose other names are the Greek alphabet, they are the letters too.
        const symbol: Map<string, Array<number>> = new Map<string, Array<number>>(latin);
        for (const [name, code] of SYMBOL_GREEK) {
            symbol.set(name, [...(latin.get(name) ?? []), code]);
        }
        const fonts: Array<string> = [];
        for (const name of STANDARD_FONTS) {
            const font: AfmFont = this.parse(readFileSync(join(this.afmFolder, name + ".afm"), "latin1"));
            fonts.push(this.renderFont(font, name === "ZapfDingbats" ? dingbats : (name === "Symbol" ? symbol : latin)));
            console.log("Read " + name + ": " + font.glyphs.length + " glyphs, " + font.kerning.length + " kerning pairs");
        }
        mkdirSync(dirname(this.outputPath), { recursive: true });
        writeFileSync(this.outputPath, this.render(fonts), "utf8");
    }

    private glyphList(text: string): Map<string, Array<number>> {
        // The Adobe Glyph List names some glyphs twice, once for each code point they stand for.
        const names: Map<string, Array<number>> = new Map<string, Array<number>>();
        for (const line of text.split("\n")) {
            const match: RegExpExecArray | null = GLYPH_LIST_LINE.exec(line.trim());
            if (match === null) {
                continue;
            }
            const codes: Array<number> | undefined = names.get(match[1]);
            if (codes === undefined) {
                names.set(match[1], [Number.parseInt(match[2], 16)]);
            } else {
                codes.push(Number.parseInt(match[2], 16));
            }
        }
        return names;
    }

    private parse(text: string): AfmFont {
        const header: Map<string, string> = new Map<string, string>();
        const glyphs: Array<AfmGlyph> = [];
        const kerning: Array<readonly [string, string, number]> = [];
        for (const raw of text.split("\n")) {
            const line: string = raw.trim();
            const character: RegExpExecArray | null = CHARACTER_LINE.exec(line);
            if (character !== null) {
                // Adobe Technical Note 5004 §8: B gives the character bounding box, llx lly urx ury.
                glyphs.push({ name: character[2], width: Number(character[1]), box: character.slice(3, 7).map(Number) });
                continue;
            }
            const pair: RegExpExecArray | null = KERNING_LINE.exec(line);
            if (pair !== null) {
                kerning.push([pair[1], pair[2], Number(pair[3])]);
                continue;
            }
            const space: number = line.indexOf(" ");
            if (space > 0 && !header.has(line.substring(0, space))) {
                header.set(line.substring(0, space), line.substring(space + 1).trim());
            }
        }
        const number: (key: string) => number | undefined = (key: string): number | undefined => header.has(key) ? Number(header.get(key)) : undefined;
        const font: AfmFont = {
            name: header.get("FontName") ?? "",
            family: header.get("FamilyName") ?? "",
            weight: header.get("Weight") ?? "",
            italicAngle: number("ItalicAngle") ?? 0,
            fixedPitch: header.get("IsFixedPitch") === "true",
            bounds: (header.get("FontBBox") ?? "0 0 0 0").split(/\s+/).map(Number),
            underlinePosition: number("UnderlinePosition") ?? 0,
            underlineThickness: number("UnderlineThickness") ?? 0,
            stemV: number("StdVW") ?? 0,
            glyphs,
            kerning
        };
        const capHeight: number | undefined = number("CapHeight");
        const xHeight: number | undefined = number("XHeight");
        const ascender: number | undefined = number("Ascender");
        const descender: number | undefined = number("Descender");
        if (capHeight !== undefined) {
            font.capHeight = capHeight;
        }
        if (xHeight !== undefined) {
            font.xHeight = xHeight;
        }
        if (ascender !== undefined) {
            font.ascender = ascender;
        }
        if (descender !== undefined) {
            font.descender = descender;
        }
        return font;
    }

    private renderFont(font: AfmFont, names: Map<string, Array<number>>): string {
        const glyphIndex: Map<string, number> = new Map<string, number>();
        font.glyphs.forEach((glyph: AfmGlyph, index: number) => glyphIndex.set(glyph.name, index + 1));
        const codes: Array<string> = font.glyphs.map((glyph: AfmGlyph) => "[" + (names.get(glyph.name)?.map((code: number) => "0x" + code.toString(16).toUpperCase()).join(", ") ?? "") + "]");
        const pairs: Array<number> = [];
        for (const pair of font.kerning) {
            const left: number | undefined = glyphIndex.get(pair[0]);
            const right: number | undefined = glyphIndex.get(pair[1]);
            if (left !== undefined && right !== undefined) {
                pairs.push(left, right, pair[2]);
            }
        }
        const optional: (name: string, value?: number) => string = (name: string, value?: number): string =>
            value === undefined ? "" : "        " + name + ": " + value + ",\n";
        return "    {\n" +
            "        name: " + JSON.stringify(font.name) + ",\n" +
            "        family: " + JSON.stringify(font.family) + ",\n" +
            "        weight: " + JSON.stringify(font.weight) + ",\n" +
            "        italicAngle: " + font.italicAngle + ",\n" +
            "        fixedPitch: " + font.fixedPitch + ",\n" +
            "        bounds: [" + font.bounds.join(", ") + "],\n" +
            optional("capHeight", font.capHeight) +
            optional("xHeight", font.xHeight) +
            optional("ascender", font.ascender) +
            optional("descender", font.descender) +
            "        underlinePosition: " + font.underlinePosition + ",\n" +
            "        underlineThickness: " + font.underlineThickness + ",\n" +
            "        stemV: " + font.stemV + ",\n" +
            "        glyphNames: [" + font.glyphs.map((glyph: AfmGlyph) => JSON.stringify(glyph.name)).join(", ") + "],\n" +
            "        widths: [" + font.glyphs.map((glyph: AfmGlyph) => glyph.width).join(", ") + "],\n" +
            "        boxes: [" + font.glyphs.map((glyph: AfmGlyph) => glyph.box.join(", ")).join(", ") + "],\n" +
            "        codes: [" + codes.join(", ") + "],\n" +
            "        kerning: [" + pairs.join(", ") + "]\n" +
            "    }";
    }

    private render(fonts: ReadonlyArray<string>): string {
        const header: string =
            "/*******************************************************************************\n" +
            " * Copyright (c) 2026 Maxprograms. All rights reserved.\n" +
            " *\n" +
            " * Licensed under the Business Source License 1.1 (the \"License\");\n" +
            " * you may not use this file except in compliance with the License.\n" +
            " *\n" +
            " * Change Date: 2030-11-01\n" +
            " * Change License: Mozilla Public License, v. 2.0\n" +
            " *\n" +
            " * Additional Use Grant:\n" +
            " * You may make production use of the Licensed Work for personal use,\n" +
            " * educational use, and academic research. \"Personal use\" means use by an\n" +
            " * individual for their own purposes, and not on behalf of an employer, client\n" +
            " * or other organization. You may also make production use of the Licensed Work\n" +
            " * for trial purposes for a period of up to 30 days.\n" +
            " *\n" +
            " * You may obtain a copy of the License at https://spdx.org/licenses/BUSL-1.1.html\n" +
            " * or in the LICENSE file provided in the root of this repository.\n" +
            " *******************************************************************************/\n\n" +
            "import type { StandardFontData } from \"../Typeface.js\";\n\n";
        return header + "export const STANDARD_FONTS: ReadonlyArray<StandardFontData> = [\n" + fonts.join(",\n") + "\n];\n";
    }
}

const PACKAGE_ROOT: string = resolvePath(dirname(fileURLToPath(import.meta.url)), "..", "..");
try {
    new StandardFontGenerator(join(PACKAGE_ROOT, "adobe", "Core14_AFMs"), join(PACKAGE_ROOT, "adobe", "agl-aglfn"), join(PACKAGE_ROOT, "ts", "fonts", "generated", "StandardFonts.ts")).run();
    console.log("Generated ts/fonts/generated/StandardFonts.ts");
} catch (error) {
    console.error("Error generating the standard font data:", error);
    process.exitCode = 1;
}
