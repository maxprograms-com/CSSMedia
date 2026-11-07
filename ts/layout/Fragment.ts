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

import type { ElementBox, InlineSequence, TextRun } from "../pdf/BoxTree.js";

export type Sides = readonly [number, number, number, number];

export type Margins = readonly [number, number];

export type ObjectArea = readonly [number, number, number, number];

export type EdgeSource = readonly [ElementBox, number];

export interface CollapsedBorders {
    blockStart?: EdgeSource;
    inlineEnd?: EdgeSource;
    blockEnd?: EdgeSource;
    inlineStart?: EdgeSource;
    lastBlock?: boolean;
    lastInline?: boolean;
}

export interface BreakToken {
    box: ElementBox;
    consumed: number;
    child: number;
    sequence: number;
    line?: number;
    inner?: BreakToken;
    parallel?: Array<BreakToken>;
    area?: readonly [number, number, number, number];
    pushed?: boolean;
    forced?: string;
    appeal?: number;
}

export interface BoxFragment {
    kind: "box";
    box: ElementBox;
    inline: number;
    block: number;
    inlineSize: number;
    blockSize: number;
    border?: Sides;
    collapsed?: CollapsedBorders;
    padding?: Sides;
    marginBefore?: Margins;
    marginAfter?: Margins;
    collapsesThrough?: boolean;
    marginAbove?: Margins;
    firstBaseline?: number;
    baseline?: number;
    object?: ObjectArea;
    natural?: readonly [number, number];
    resumed?: boolean;
    token?: BreakToken;
    children?: Array<BoxFragment | LineFragment>;
}

export interface TextPiece {
    kind: "text";
    run: TextRun;
    from: number;
    to: number;
    inline: number;
    inlineSize: number;
    baseline: number;
    hyphenated?: boolean;
    advances?: Float64Array;
    leader?: boolean;
}

export interface LineFragment {
    kind: "line";
    sequence: InlineSequence;
    start: number;
    end: number;
    inline?: number;
    block: number;
    blockSize: number;
    baseline: number;
    pieces: Array<TextPiece | BoxFragment>;
}
