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

export interface FontResource {
    key: string;
    object: number;
}

export type FontRun = readonly [FontResource, string];

const CMAP_BLOCK: number = 100;

export abstract class PdfFont {

    abstract show(glyphs: ArrayLike<number>, start: number, end: number): Array<FontRun>;

    abstract use(glyph: number, text: string): void;

    abstract width(glyph: number): number;

    abstract write(): void;

    protected unicodeMap(entries: ReadonlyArray<readonly [number, string]>, bytes: 1 | 2): Buffer {
        // ISO 32000-2 §9.10.3: a codespace as long as the codes of the font, one byte for a simple font, and bfchar
        // mappings to UTF-16BE; Adobe Technical Note 5014 allows at most 100 mappings in each block.
        const digits: number = bytes * 2;
        let body: string = "/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n"
            + "/CMapName /Adobe-Identity-UCS def\n/CMapType 2 def\n1 begincodespacerange\n<" + "0".repeat(digits) + "> <" + "F".repeat(digits) + ">\nendcodespacerange\n";
        const mapped: Array<readonly [number, string]> = entries.filter((entry: readonly [number, string]) => entry[1].length > 0);
        mapped.sort((first: readonly [number, string], second: readonly [number, string]) => first[0] - second[0]);
        for (let start: number = 0; start < mapped.length; start += CMAP_BLOCK) {
            const block: Array<readonly [number, string]> = mapped.slice(start, start + CMAP_BLOCK);
            body += block.length + " beginbfchar\n";
            for (const [code, text] of block) {
                body += "<" + code.toString(16).toUpperCase().padStart(digits, "0") + "> <" + Buffer.from(text, "utf16le").swap16().toString("hex").toUpperCase() + ">\n";
            }
            body += "endbfchar\n";
        }
        return Buffer.from(body + "endcmap\nCMapName currentdict /CMap defineresource pop\nend\nend\n", "latin1");
    }
}
