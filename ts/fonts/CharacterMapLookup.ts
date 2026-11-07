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

import type { CharacterMap, VariationSequences } from "./Typeface.js";

export class CharacterMapLookup {

    glyphOf(map: CharacterMap, code: number): number {
        const ends: Uint32Array = map.ends;
        let low: number = 0;
        let high: number = ends.length - 1;
        while (low <= high) {
            const middle: number = (low + high) >>> 1;
            if (ends[middle] < code) {
                low = middle + 1;
            } else {
                high = middle - 1;
            }
        }
        if (low >= ends.length || map.starts[low] > code) {
            return 0;
        }
        const mode: number = map.modes[low];
        if (mode === 0) {
            return map.bases[low] + (code - map.starts[low]);
        }
        if (mode === 1) {
            return map.bases[low];
        }
        return map.glyphs[map.bases[low] + (code - map.starts[low])];
    }

    variantOf(map: CharacterMap, code: number, selector: number): number | undefined {
        // OpenType cmap format 14: a sequence the font does not list is not supported by the font.
        const sequences: VariationSequences | undefined = map.variations.find((candidate: VariationSequences) => candidate.selector === selector);
        if (sequences === undefined) {
            return undefined;
        }
        const listed: number = this.search(sequences.codes, code);
        if (listed >= 0) {
            return sequences.glyphs[listed];
        }
        const ends: Uint32Array = sequences.defaultEnds;
        let low: number = 0;
        let high: number = ends.length - 1;
        while (low <= high) {
            const middle: number = (low + high) >>> 1;
            if (ends[middle] < code) {
                low = middle + 1;
            } else {
                high = middle - 1;
            }
        }
        if (low < ends.length && sequences.defaultStarts[low] <= code) {
            const glyph: number = this.glyphOf(map, code);
            return glyph === 0 ? undefined : glyph;
        }
        return undefined;
    }

    covers(map: CharacterMap, code: number): boolean {
        return this.glyphOf(map, code) !== 0;
    }

    private search(values: Uint32Array, value: number): number {
        let low: number = 0;
        let high: number = values.length - 1;
        while (low <= high) {
            const middle: number = (low + high) >>> 1;
            if (values[middle] < value) {
                low = middle + 1;
            } else if (values[middle] > value) {
                high = middle - 1;
            } else {
                return middle;
            }
        }
        return -1;
    }
}
