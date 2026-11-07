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

import type { FontInstance } from "../Typeface.js";
import { DiacriticShaper } from "./DiacriticShaper.js";
import type { ShapeRequest } from "./FeatureShaper.js";
import type { GlyphInfo } from "./GlyphInfo.js";

const SPLIT_VOWELS: ReadonlyMap<number, readonly [number, number]> = new Map<number, readonly [number, number]>([[0x0E33, [0x0E4D, 0x0E32]], [0x0EB3, [0x0ECD, 0x0EB2]]]);
const TONE_MARKS: ReadonlyArray<readonly [number, number]> = [[0x0E48, 0x0E4C], [0x0E4E, 0x0E4E], [0x0EC8, 0x0ECC]];

export class ThaiShaper extends DiacriticShaper {

    static readonly SCRIPTS: ReadonlySet<string> = new Set<string>(["thai", "lao "]);

    shape(codepoints: ReadonlyArray<number>, request: ShapeRequest, instance: FontInstance): Array<GlyphInfo> {
        // Thai and Lao shaping engines: the AM character "needs to be broken into two glyphs and some reordering might be
        // required so that the ring is the base glyph", so the ring goes before the tone marks that precede the AM.
        const codes: Array<number> = [];
        const origins: Array<number> = [];
        codepoints.forEach((code: number, index: number) => {
            const split: readonly [number, number] | undefined = SPLIT_VOWELS.get(code);
            let target: number = codes.length;
            while (split !== undefined && target > 0 && TONE_MARKS.some((range: readonly [number, number]) => codes[target - 1] >= range[0] && codes[target - 1] <= range[1])) {
                target--;
            }
            if (split !== undefined) {
                codes.splice(target, 0, split[0]);
                origins.splice(target, 0, index);
            }
            codes.push(split === undefined ? code : split[1]);
            origins.push(index);
        });
        const infos: Array<GlyphInfo> = super.shape(codes, request, instance);
        for (const info of infos) {
            info.cluster = origins[info.cluster];
        }
        return infos;
    }
}
