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

import type { CssValue, FunctionValue } from "../css/values/CssValue.js";
import type { FontInstance } from "../fonts/Typeface.js";
import type { SourceElement } from "../parse/SourceElement.js";
import type { ComputedStyle } from "./ComputedStyle.js";
import type { CounterSet } from "./CounterScopes.js";
import type { DisplayType } from "./DisplayTypes.js";

export type Placement = "in-flow" | "float" | "absolute" | "fixed" | "running" | "footnote" | "marker";

type RubyWhiteSpace = "inter-base" | "inter-annotation" | "inter-segment";

export type NamedString = [string, string];

export interface TextSequence {
    kind: "text";
    text: string;
    language?: string;
    namedStrings?: ReadonlyArray<NamedString>;
    collapsedSpaces?: ReadonlyArray<number>;
    leader?: boolean;
    target?: FunctionValue;
    style: ComputedStyle;
}

interface DeferredContent {
    kind: "deferred";
    value: CssValue;
    style: ComputedStyle;
}

export interface ElementBox {
    kind: "box";
    element?: SourceElement;
    pseudoElement?: string;
    style: ComputedStyle;
    display: DisplayType;
    placement: Placement;
    replaced: boolean;
    spans?: readonly [number, number];
    rubyWhiteSpace?: RubyWhiteSpace;
    alternativeText?: string;
    namedStrings?: ReadonlyArray<NamedString>;
    trailingStrings?: ReadonlyArray<NamedString>;
    runningName?: string;
    linkUri?: string;
    linkDestination?: string;
    queryContainer?: boolean;
    hasStartEdge: boolean;
    hasEndEdge: boolean;
    usedPage: string;
    startPage: string;
    endPage: string;
    counterStart?: CounterSet;
    counterState?: CounterSet;
    children: Array<BoxNode>;
    inline?: Array<InlineSequence>;
}

export type BoxNode = ElementBox | TextSequence | DeferredContent;

export interface InlineItem {
    kind: "text" | "open" | "close" | "object" | "out-of-flow";
    node: BoxNode;
}

export interface BidiRange {
    start: number;
    end: number;
    level: number;
}

export interface GlyphRun {
    font: FontInstance;
    size: number;
    glyphs: Uint16Array;
    advances: Float64Array;
    xOffsets: Float64Array;
    yOffsets: Float64Array;
}

export interface Hyphen {
    parts: Array<GlyphRun>;
    advance: number;
}

export interface TextRun {
    start: number;
    end: number;
    script: number;
    level: number;
    font: FontInstance;
    upright: boolean;
    capitals: boolean;
    combined: boolean;
    contextBefore: boolean;
    size: number;
    glyphStart: number;
    glyphEnd: number;
    hyphen?: Hyphen;
}

export interface ShapedRun extends TextRun {
    glyphs: Uint16Array;
    clusters: Uint32Array;
    advances: Float64Array;
    xOffsets: Float64Array;
    yOffsets: Float64Array;
}

export interface Combination {
    start: number;
    end: number;
    level: number;
    scale: number;
}

export interface InlineText {
    codepoints: Array<number>;
    starts: Array<number>;
    collapsedSpaces: Array<number>;
    combinations: Array<Combination>;
    scripts: Uint16Array;
    levels: Uint8Array;
    paragraphs: Array<BidiRange>;
    runs: Array<TextRun>;
    glyphs: Uint16Array;
    clusters: Uint32Array;
    advances: Float64Array;
    xOffsets?: Float64Array;
    yOffsets?: Float64Array;
    spacingBefore: Float64Array;
    spacingAfter: Float64Array;
    autospace: Uint8Array;
    punctuation: Uint8Array;
    punctuationTrim: Float64Array;
    breaks: Uint8Array;
    avoidance: Uint8Array;
}

export interface InlineSequence {
    style: ComputedStyle;
    items: Array<InlineItem>;
    firstLine?: InlineSequence;
    text?: InlineText;
}
