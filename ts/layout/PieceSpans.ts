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

import type { InlineText, TextRun } from "../pdf/BoxTree.js";
import { TextSpacingTrim } from "../pdf/TextSpacingTrim.js";
import type { TextPiece } from "./Fragment.js";

export class PieceSpans {

    of(text: InlineText, piece: TextPiece): Array<readonly [number, number]> {
        // Where the glyphs of each character of a piece are along its line, from the start of the piece, as they are placed: a
        // right-to-left run is placed from its last character, and a mark that was set half-width loses what has no ink.
        const run: TextRun = piece.run;
        const from: number = text.clusters[piece.from];
        const to: number = piece.to < run.glyphEnd ? text.clusters[piece.to] : run.end;
        const firsts: Array<number> = [];
        let glyph: number = piece.from;
        for (let position: number = from; position < to; position++) {
            firsts.push(glyph);
            while (glyph < piece.to && text.clusters[glyph] === position) {
                glyph++;
            }
        }
        firsts.push(piece.to);
        const reversed: boolean = (run.level & 1) === 1;
        const spans: Array<readonly [number, number]> = new Array<readonly [number, number]>(to - from);
        let pen: number = 0;
        for (let step: number = 0; step < to - from; step++) {
            const position: number = reversed ? to - 1 - step : from + step;
            const index: number = position - from;
            let natural: number = text.spacingBefore[position] + text.spacingAfter[position];
            let glyphs: number = 0;
            for (let current: number = firsts[index]; current < firsts[index + 1]; current++) {
                natural += text.advances[current];
                glyphs += text.advances[current];
            }
            const used: number = piece.advances === undefined ? natural : piece.advances[index];
            const type: number = text.punctuation[position];
            const trimmed: boolean = (type === TextSpacingTrim.OPENING && !reversed) || (type === TextSpacingTrim.CLOSING && reversed);
            const start: number = pen + (reversed ? text.spacingAfter[position] : text.spacingBefore[position]) - (trimmed ? natural - used : 0);
            spans[index] = [start, start + glyphs];
            pen += used;
        }
        return spans;
    }
}
